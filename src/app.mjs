import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { digest, randomToken, seal, open, readCookie, setCookie,
  sessionCookie, loginCookie, secureHeaders, HttpError } from './security.mjs';
import { escapeHtml, memberView, invitationCreated } from './member-views.mjs';

const unauthorized = () => new HttpError(401, 'authentication_required');
const document = body => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aplyd Genie</title><main>${body}</main></html>`;

/** Dependencies are injected for contract tests; production supplies the real adapters. */
export function createApp({ config, store, oidc, accounts, rateStore, memberships }) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  if (config.trustProxy) app.set('trust proxy', 'loopback');
  app.use(secureHeaders);
  app.use('/auth', rateLimit({ windowMs: 60_000, limit: 30,
    ...(rateStore ? { store: rateStore } : {}),
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'too_many_authentication_requests' } }));

  async function authenticate(request) {
    const token = readCookie(request, sessionCookie);
    if (!token) throw unauthorized();
    const hash = digest(token);
    const before = await store.getSession(hash);
    if (!before || before.issuer !== config.issuer) {
      await store.deleteSession(hash);
      throw unauthorized();
    }
    let upstream;
    try { upstream = open(config.key, `session:${before.user_id}:${before.tenant_id}`, before.sealed_upstream); }
    catch { await store.deleteSession(hash); throw unauthorized(); }
    try { await accounts.requireSession(before.subject, upstream.uid, before.user_id); }
    catch (error) {
      if (error instanceof HttpError && error.status === 401) await store.deleteSession(hash);
      throw error;
    }
    // Never retain a positive authority result across requests or across membership changes.
    const after = await store.getSession(hash);
    if (!after || after.user_id !== before.user_id || after.subject !== before.subject ||
        after.issuer !== before.issuer || after.tenant_id !== before.tenant_id ||
        after.sealed_upstream !== before.sealed_upstream) {
      await store.deleteSession(hash);
      throw unauthorized();
    }
    return { userId: after.user_id, tenantId: after.tenant_id, role: after.role,
      sessionHash: hash, issuer: after.issuer, subject: after.subject };
  }

  app.get('/health/live', (_request, response) => response.json({ status: 'live' }));
  app.get('/', (_request, response) => response.type('html').send(document(
    '<h1>Aplyd Genie</h1><p>Your AI concierge across Aplyd.</p><a href="/auth/sign-in">Sign in with Aplyd</a>')));

  async function startLogin(request, response, inviteHash) {
    if (request.originalUrl.length > 2048) throw new HttpError(400, 'invalid_request');
    const transaction = { state: randomToken(), nonce: randomToken(), verifier: randomToken(), next: '/workspace' };
    if (inviteHash) transaction.inviteHash = inviteHash;
    const browser = randomToken();
    const destination = await oidc.authorization(transaction);
    await store.putLogin({ stateHash: digest(transaction.state), browserHash: digest(browser),
      sealed: seal(config.key, 'login', transaction), expires: new Date(Date.now() + config.loginSeconds * 1000) });
    setCookie(response, loginCookie, browser, config.loginSeconds);
    response.redirect(303, destination);
  }
  app.get('/auth/sign-in', (request,response) => startLogin(request,response));
  const parseForm = express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 10 });
  function sameOrigin(request) {
    if (request.get('origin') !== config.origin) throw new HttpError(403, 'origin_denied');
  }
  app.get('/invitations/:token', (request,response) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) throw new HttpError(404,'invitation_unavailable');
    response.set('Referrer-Policy','same-origin').type('html').send(document('<h1>Accept a workspace invitation</h1>' +
      '<p>Sign in with the account this invitation was created for.</p><form method="post" action="/auth/invitation-sign-in">' +
      `<input type="hidden" name="token" value="${escapeHtml(request.params.token)}"><button>Accept invitation with Aplyd</button></form>`));
  });
  app.post('/auth/invitation-sign-in', parseForm, (request,response) => {
    sameOrigin(request);
    if (!memberships || typeof request.body?.token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(request.body.token)) throw new HttpError(400,'invalid_invitation');
    return startLogin(request,response,digest(request.body.token));
  });

  app.get('/auth/callback', async (request, response) => {
    // Clear transient state on every callback outcome, including malformed callbacks.
    setCookie(response, loginCookie, '', 0);
    if (request.originalUrl.length > 8192) throw new HttpError(400, 'invalid_callback');
    const callback = new URL(config.callback);
    callback.search = new URL(request.originalUrl, config.origin).search;
    const values = callback.searchParams;
    const state = values.get('state');
    if (values.getAll('state').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(state ?? '') ||
        values.getAll('code').length !== 1 || !values.get('code') || values.get('code').length > 2048 ||
        values.has('error') || values.getAll('iss').length > 1 ||
        (values.has('iss') && values.get('iss') !== config.issuer)) throw new HttpError(400, 'invalid_callback');
    const browser = readCookie(request, loginCookie);
    if (!browser) throw new HttpError(400, 'invalid_callback');
    const sealed = await store.takeLogin(digest(state), digest(browser));
    if (!sealed) throw new HttpError(400, 'invalid_callback');
    let transaction, identity;
    try {
      transaction = open(config.key, 'login', sealed);
      if (transaction.state !== state) throw Error();
      identity = await oidc.exchange(callback, transaction);
    } catch { throw new HttpError(400, 'invalid_callback'); }
    let accepted;
    if (transaction.inviteHash) {
      if (!memberships) throw new HttpError(503,'service_unavailable');
      const recipient = await memberships.recipient(transaction.inviteHash,config.issuer,identity.subject);
      if (!recipient) throw new HttpError(404,'invitation_unavailable');
      await accounts.requireSession(identity.subject,identity.uid,recipient.user_id);
      accepted = await memberships.accept(transaction.inviteHash,config.issuer,identity.subject);
    }
    const choices = await store.findMembership(config.issuer, identity.subject);
    if (choices.length === 0) throw new HttpError(403, 'membership_required');
    if (!accepted && choices.length !== 1) throw new HttpError(409, 'workspace_selection_required');
    // The invitation is an explicit workspace choice, stored in browser-bound encrypted state.
    const member = accepted ? { user_id: accepted.userId, tenant_id: accepted.tenantId } : choices[0];
    const previous = readCookie(request, sessionCookie);
    await accounts.requireSession(identity.subject, identity.uid, member.user_id);
    const token = randomToken();
    const remaining = Math.min(config.sessionSeconds, identity.expires - Math.floor(Date.now() / 1000));
    if (!Number.isSafeInteger(remaining) || remaining <= 0) throw new HttpError(400, 'invalid_callback');
    await store.putSession({ tokenHash: digest(token), userId: member.user_id, tenantId: member.tenant_id,
      issuer: config.issuer, subject: identity.subject,
      sealed: seal(config.key, `session:${member.user_id}:${member.tenant_id}`, { uid: identity.uid }),
      expires: new Date(Date.now() + remaining * 1000) });
    if (previous) await store.deleteSession(digest(previous));
    setCookie(response, sessionCookie, token, remaining);
    response.redirect(303, '/workspace');
  });

  app.get('/api/auth/session', async (request, response) => {
    const { userId,tenantId } = await authenticate(request);
    response.json({ authenticated: true, userId,tenantId });
  });

  app.get('/workspace', async (request, response) => {
    const actor = await authenticate(request);
    // no-referrer makes native form POSTs send Origin:null in browsers. Keep
    // same-origin form provenance while withholding cross-origin referrers.
    response.set('Referrer-Policy', 'same-origin');
    response.type('html').send(document('<h1>Aplyd Genie workspace</h1><p>You are signed in.</p>' +
      (memberships && actor.role==='admin' ? '<p><a href="/workspace/members">Manage workspace members</a></p>' : '') +
      '<form method="post" action="/auth/sign-out"><button type="submit">Sign out of Genie</button></form>'));
  });

  async function memberPage(request) {
    if (!memberships) throw new HttpError(503,'service_unavailable');
    const actor = await authenticate(request);
    const kind = request.query.view ?? 'members';
    const page = await memberships.page(actor.sessionHash,kind,request.query.after,request.query.search ?? '');
    return { kind,page };
  }
  app.get('/api/workspace/members', async (request,response) => response.json(await memberPage(request)));
  app.get('/workspace/members', async (request,response) => {
    const { kind,page } = await memberPage(request);
    response.set('Referrer-Policy','same-origin').type('html').send(document(memberView(kind,page,{search:request.query.search??''})));
  });
  async function membershipAction(request,action) {
    sameOrigin(request);
    if (!memberships) throw new HttpError(503,'service_unavailable');
    const actor = await authenticate(request);
    const body=request.body??{};
    if (action==='change') return memberships.change(actor.sessionHash,body.target,body.status,body.role,body.version);
    if (action==='invite') return memberships.invite(actor.sessionHash,body.target,body.role);
    return memberships.revoke(actor.sessionHash,body.invitationId);
  }
  for (const action of ['change','invite','revoke']) {
    app.post(`/api/workspace/members/${action}`,express.json({strict:true,limit:'8kb'}),async(request,response) => {
      const result=await membershipAction(request,action);
      response.status(action==='invite'?201:200).json(action==='invite'?{...result,url:config.origin+'/invitations/'+result.token}:result);
    });
    app.post(`/workspace/members/${action}`,parseForm,async(request,response) => {
      const result=await membershipAction(request,action);
      if(action==='invite')return response.type('html').send(document(invitationCreated(config.origin,result)));
      response.redirect(303,action==='revoke'?'/workspace/members?view=invitations':'/workspace/members');
    });
  }

  app.post('/auth/sign-out', async (request, response) => {
    if (request.get('origin') !== config.origin) throw new HttpError(403, 'origin_denied');
    const token = readCookie(request, sessionCookie);
    if (token) await store.deleteSession(digest(token));
    setCookie(response, sessionCookie, '', 0);
    setCookie(response, loginCookie, '', 0);
    response.redirect(303, '/');
  });
  app.get('/auth/sign-out', (_request, response) => response.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed' }));

  app.use((_request, response) => response.status(404).json({ error: 'not_found' }));
  app.use((error, request, response, _next) => {
    const safe = error instanceof HttpError ? error :
      error.type==='entity.parse.failed'?new HttpError(400,'invalid_request'):
      error.type==='entity.too.large'?new HttpError(413,'request_too_large'):new HttpError(503, 'service_unavailable');
    if (safe.status === 401) setCookie(response, sessionCookie, '', 0);
    if(request.path.startsWith('/workspace/members')) {
      const message={administrator_required:'Only workspace administrators can manage members.',last_administrator_required:'Keep at least one active administrator.',membership_conflict:'This person is already a member or has a pending invitation.',membership_changed_refresh_required:'This membership changed. Refresh the page before trying again.',reviewed_membership_or_invitation_unavailable:'The reviewed person or invitation is unavailable.',authentication_required:'Please sign in again.',origin_denied:'This request could not be verified. Return to your workspace and try again.'}[safe.code]??'The request could not be completed. Please return to your workspace and try again.';
      return response.status(safe.status).type('html').send(document(`<h1>Membership request</h1><p>${message}</p><a href="/workspace/members">Back to members</a> · <a href="/auth/sign-in">Sign in</a>`));
    }
    response.status(safe.status).json({ error: safe.code });
  });
  return app;
}
