import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { digest, randomToken, seal, open, readCookie, setCookie,
  sessionCookie, loginCookie, secureHeaders, HttpError } from './security.mjs';

const unauthorized = () => new HttpError(401, 'authentication_required');
const document = body => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aplyd Genie</title><main>${body}</main></html>`;

/** Dependencies are injected for contract tests; production supplies the real adapters. */
export function createApp({ config, store, oidc, accounts, rateStore }) {
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
    return { userId: after.user_id, tenantId: after.tenant_id };
  }

  app.get('/health/live', (_request, response) => response.json({ status: 'live' }));
  app.get('/', (_request, response) => response.type('html').send(document(
    '<h1>Aplyd Genie</h1><p>Your AI concierge across Aplyd.</p><a href="/auth/sign-in">Sign in with Aplyd</a>')));

  app.get('/auth/sign-in', async (request, response) => {
    if (request.originalUrl.length > 2048) throw new HttpError(400, 'invalid_request');
    const transaction = { state: randomToken(), nonce: randomToken(), verifier: randomToken(), next: '/workspace' };
    const browser = randomToken();
    const destination = await oidc.authorization(transaction);
    await store.putLogin({ stateHash: digest(transaction.state), browserHash: digest(browser),
      sealed: seal(config.key, 'login', transaction), expires: new Date(Date.now() + config.loginSeconds * 1000) });
    setCookie(response, loginCookie, browser, config.loginSeconds);
    response.redirect(303, destination);
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
    const memberships = await store.findMembership(config.issuer, identity.subject);
    if (memberships.length === 0) throw new HttpError(403, 'membership_required');
    if (memberships.length !== 1) throw new HttpError(409, 'workspace_selection_required');
    const member = memberships[0];
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
    response.json({ authenticated: true, ...await authenticate(request) });
  });

  app.get('/workspace', async (request, response) => {
    await authenticate(request);
    response.type('html').send(document('<h1>Aplyd Genie workspace</h1><p>You are signed in.</p>' +
      '<form method="post" action="/auth/sign-out"><button type="submit">Sign out of Genie</button></form>'));
  });

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
  app.use((error, _request, response, _next) => {
    const safe = error instanceof HttpError ? error : new HttpError(503, 'service_unavailable');
    if (safe.status === 401) setCookie(response, sessionCookie, '', 0);
    response.status(safe.status).json({ error: safe.code });
  });
  return app;
}
