import {allows} from './capabilities.mjs';
import {roleView} from './role-views.mjs';
import {createMemberTools} from './member-tools.mjs';
import {createSessionAuthenticator} from './authentication.mjs';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { digest, randomToken, seal, open, readCookie, setCookie,
  sessionCookie, loginCookie, secureHeaders, HttpError } from './security.mjs';
import { escapeHtml, memberView, invitationCreated } from './member-views.mjs';

const unauthorized = () => new HttpError(401, 'authentication_required');
const document = body => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aplyd Genie</title><main>${body}</main></html>`;

/** Dependencies are injected for contract tests; production supplies the real adapters. */
export function createApp({ config, store, oidc, accounts, rateStore, memberships, permissions, memberExports }) {
  const memberTools=permissions&&memberships?createMemberTools({permissions,memberships}):null;
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  if (config.trustProxy) app.set('trust proxy', 'loopback');
  app.use(secureHeaders);
  app.use('/auth', rateLimit({ windowMs: 60_000, limit: 30,
    ...(rateStore ? { store: rateStore } : {}),
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'too_many_authentication_requests' } }));

  const authenticateSession=createSessionAuthenticator({config,store,accounts});
  async function authenticate(request) {
    const token=readCookie(request,sessionCookie);
    if(!token)throw unauthorized();
    return authenticateSession(digest(token));
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
    if (inviteHash) {
      // A form-action 'self' policy can block cross-origin POST redirect chains.
      // Commit a normal page first; its explicit GET link keeps that policy intact.
      // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action
      return response.type('html').send(document('<h1>Continue with Aplyd Accounts</h1>' +
        '<p>Verify the account this invitation was created for.</p>' +
        `<a href="${escapeHtml(destination)}">Continue to Aplyd Accounts</a>`));
    }
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

  app.get('/api/workspace/capabilities',async(request,response)=>{
    const actor=await authenticate(request);
    if(!permissions)throw new HttpError(503,'service_unavailable');
    response.json({capabilities:await permissions.capabilities(actor.sessionHash)});
  });
  app.get('/workspace', async (request, response) => {
    const actor = await authenticate(request);
    const caps=permissions?await permissions.capabilities(actor.sessionHash):undefined;
    const readMembers=caps===undefined?actor.role==='admin':allows(caps,'workspace.members','read');
    let links=readMembers?`<p><a href="/workspace/members">${actor.role==='admin'?'Manage workspace members':'Workspace members'}</a></p>`:'';
    if(allows(caps,'workspace.roles','read'))links+='<p><a href="/workspace/roles">Workspace roles</a></p>';
    if(allows(caps,'workspace.roles','assign')&&allows(caps,'workspace.members','read'))links+='<p><a href="/workspace/roles?view=assignments">Role assignments</a></p>';
    if(allows(caps,'workspace.audit','read'))links+='<p><a href="/workspace/roles?view=audit">Role activity</a></p>';
    response.set('Referrer-Policy', 'same-origin');
    response.type('html').send(document('<h1>Aplyd Genie workspace</h1><p>You are signed in.</p>' +links+
      '<form method="post" action="/auth/sign-out"><button type="submit">Sign out of Genie</button></form>'));
  });

  async function memberPage(request) {
    if (!memberships) throw new HttpError(503,'service_unavailable');
    const actor = await authenticate(request);
    const kind = request.query.view ?? 'members';
    const page = await memberships.page(actor.sessionHash,kind,request.query.after,request.query.search ?? '');
    return {kind,page,builtinRole:actor.role,capabilities:permissions?await permissions.capabilities(actor.sessionHash):undefined};
  }
  app.get('/api/workspace/members', async (request,response) => {const {kind,page}=await memberPage(request);response.json({kind,page});});
  app.get('/workspace/members', async (request,response) => {
    const {kind,page,builtinRole,capabilities}=await memberPage(request);
    response.set('Referrer-Policy','same-origin').type('html').send(document(memberView(kind,page,{search:request.query.search??'',builtinRole,capabilities})));
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

  async function rolePage(request){
    const actor=await authenticate(request);
    if(!permissions)throw new HttpError(503,'service_unavailable');
    const kind=request.query.view??'roles';
    return {kind,page:await permissions.page(actor.sessionHash,kind,request.query.after,request.query.search??''),
      capabilities:await permissions.capabilities(actor.sessionHash)};
  }
  app.get('/api/workspace/roles',async(request,response)=>{const {kind,page}=await rolePage(request);response.json({kind,page});});
  app.get('/workspace/roles',async(request,response)=>{
    const {kind,page,capabilities}=await rolePage(request);
    response.set('Referrer-Policy','same-origin').type('html').send(document(roleView(kind,page,{capabilities,search:request.query.search??''})));
  });
  const roleForm=express.urlencoded({extended:false,limit:'16kb',parameterLimit:64});
  async function roleAction(request,action,fromForm=false){
    sameOrigin(request);const actor=await authenticate(request);
    if(!permissions)throw new HttpError(503,'service_unavailable');
    const body=request.body??{};
    if(action==='save'){
      let grants=body.grants;
      if(fromForm){
        grants=grants===undefined?[]:Array.isArray(grants)?grants:[grants];
        grants=grants.map(value=>{
          if(typeof value!=='string'||value.split(':').length!==2)throw new HttpError(400,'invalid_role_request');
          const [resource,action]=value.split(':');return {resource,action};
        });
      }
      return permissions.save(actor.sessionHash,{roleId:fromForm?(body.roleId||null):(body.roleId??null),name:body.name,grants,version:body.version});
    }
    let assigned=body.assigned;
    if(fromForm){if(!['true','false'].includes(assigned))throw new HttpError(400,'invalid_role_request');assigned=assigned==='true';}
    return permissions.assign(actor.sessionHash,{target:body.target,roleId:body.roleId,assigned,version:body.version});
  }
  for(const action of ['save','assign']){
    app.post(`/api/workspace/roles/${action}`,express.json({strict:true,limit:'16kb'}),async(request,response)=>response.json(await roleAction(request,action)));
    app.post(`/workspace/roles/${action}`,roleForm,async(request,response)=>{
      await roleAction(request,action,true);response.redirect(303,action==='assign'?'/workspace/roles?view=assignments':'/workspace/roles');
    });
  }
  app.post('/api/tools/:name',express.json({strict:true,limit:'8kb'}),async(request,response)=>{
    sameOrigin(request);const actor=await authenticate(request);
    if(!memberTools)throw new HttpError(503,'service_unavailable');
    response.json(await memberTools.execute(request.params.name,actor,request.body??{}));
  });

  app.get('/workspace/member-exports',async(request,response)=>{
    const actor=await authenticate(request);
    if(!memberExports||!permissions)throw new HttpError(503,'service_unavailable');
    await permissions.require(actor.sessionHash,'workspace.members','read');
    const job=request.query.id?await memberExports.get(actor.sessionHash,request.query.id):null;
    const labels={queued:'Waiting to prepare your export.',running:'Preparing your export.',completed:'Your export is ready.',denied:'Access changed. This export was stopped.',failed:'This export could not be completed. You can try again.'};
    const status=job?`<p>${labels[job.status]}</p>${job.status==='completed'?`<p><a href="/api/workspace/member-exports/${escapeHtml(job.id)}">View export JSON</a></p>`:''}<p><a href="/workspace/member-exports?id=${escapeHtml(job.id)}">Refresh status</a></p>`:'';
    response.type('html').send(document(`<h1>Export workspace members</h1><p>Exports contain up to 1,000 member names, roles and membership statuses. Your access is checked again when the export runs and when you open it.</p>${status}<form method="post" action="/workspace/member-exports"><button>Prepare export</button></form><p><a href="/workspace/members">Back to members</a></p>`));
  });
  app.post('/workspace/member-exports',parseForm,async(request,response)=>{
    sameOrigin(request);const actor=await authenticate(request);
    if(!memberExports)throw new HttpError(503,'service_unavailable');
    const job=await memberExports.enqueue(actor.sessionHash);
    response.redirect(303,'/workspace/member-exports?id='+encodeURIComponent(job.id));
  });
  app.post('/api/workspace/member-exports',express.json({strict:true,limit:'1kb'}),async(request,response)=>{
    sameOrigin(request);const actor=await authenticate(request);
    if(!memberExports)throw new HttpError(503,'service_unavailable');
    response.status(202).json(await memberExports.enqueue(actor.sessionHash));
  });
  app.get('/api/workspace/member-exports/:id',async(request,response)=>{
    const actor=await authenticate(request);
    if(!memberExports)throw new HttpError(503,'service_unavailable');
    response.json(await memberExports.get(actor.sessionHash,request.params.id));
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
  app.use((error, request, response, _next) => {
    const safe = error instanceof HttpError ? error :
      error.type==='entity.parse.failed'?new HttpError(400,'invalid_request'):
      error.type==='entity.too.large'?new HttpError(413,'request_too_large'):new HttpError(503, 'service_unavailable');
    if (safe.status === 401) setCookie(response, sessionCookie, '', 0);
    if(request.path.startsWith('/workspace/member-exports')){
      const message={permission_required:'Your role does not allow member exports.',export_queue_full:'You already have exports waiting. Please try again later.',export_unavailable:'This export is unavailable.',authentication_required:'Please sign in again.'}[safe.code]??'The export request could not be completed.';
      return response.status(safe.status).type('html').send(document(`<h1>Member export</h1><p>${message}</p><a href="/workspace">Back to workspace</a>`));
    }
    if(request.path.startsWith('/workspace/roles')){
      const message={permission_required:'Your role does not allow this action.',role_name_conflict:'A role with this name already exists.',role_or_membership_changed_refresh_required:'This role or membership changed. Refresh before trying again.',role_or_member_unavailable:'The role or member is unavailable.',role_or_assignment_limit:'The workspace role or assignment limit has been reached.',invalid_role_request:'Check the role name, permissions and assignment details.',authentication_required:'Please sign in again.',origin_denied:'This request could not be verified. Return to your workspace and try again.'}[safe.code]??'The request could not be completed. Please return to your workspace and try again.';
      return response.status(safe.status).type('html').send(document(`<h1>Role request</h1><p>${message}</p><a href="/workspace/roles">Back to roles</a> · <a href="/workspace">Workspace</a>`));
    }
    if(request.path.startsWith('/workspace/members')) {
      const message={administrator_required:'Only workspace administrators can manage members.',last_administrator_required:'Keep at least one active administrator.',membership_conflict:'This person is already a member or has a pending invitation.',membership_changed_refresh_required:'This membership changed. Refresh the page before trying again.',reviewed_membership_or_invitation_unavailable:'The reviewed person or invitation is unavailable.',authentication_required:'Please sign in again.',origin_denied:'This request could not be verified. Return to your workspace and try again.'}[safe.code]??'The request could not be completed. Please return to your workspace and try again.';
      return response.status(safe.status).type('html').send(document(`<h1>Membership request</h1><p>${message}</p><a href="/workspace/members">Back to members</a> · <a href="/auth/sign-in">Sign in</a>`));
    }
    response.status(safe.status).json({ error: safe.code });
  });
  return app;
}
