import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.mjs';
import { IdentityStore } from '../src/store.mjs';
import { createAccounts } from '../src/accounts.mjs';
import { Memberships } from '../src/memberships.mjs';
import {MemberExports,runMemberExport} from '../src/exports.mjs';
import {createSessionAuthenticator} from '../src/authentication.mjs';
import {Permissions} from '../src/permissions.mjs';
import { readConfig } from '../src/config.mjs';
import { sessionCookie, loginCookie, digest } from '../src/security.mjs';

const user = '00000000-0000-4000-8000-000000000001';
const tenant = '00000000-0000-4000-8000-000000000002';
const otherTenant = '00000000-0000-4000-8000-000000000003';
const config = readConfig({ GENIE_ORIGIN: 'https://genie.example.test',
  GENIE_IDENTITY_ISSUER: 'https://accounts.example.test', GENIE_OIDC_CLIENT_ID: 'aplyd-genie',
  GENIE_OIDC_CLIENT_SECRET: 'fixture-only-secret-'.repeat(3), GENIE_SESSION_KEY: Buffer.alloc(32, 9).toString('base64') });
let database;
before(async () => {
  database = new PGlite();
  for (const name of ['001_identity_sessions.sql','002_shared_rate_limits.sql','003_workspace_memberships.sql','004_audit_page_cursor.sql','005_resource_permissions.sql','006_permission_aware_memberships.sql','007_authorized_exports.sql'])
    await database.exec(await readFile(new URL('../migrations/'+name, import.meta.url), 'utf8'));
});
after(async () => { await database.close(); });
beforeEach(async () => {
  await database.exec('TRUNCATE genie_sessions,genie_login_transactions,genie_memberships,genie_tenants,genie_users CASCADE');
  await database.query('INSERT INTO genie_users(id,issuer,subject,enabled) VALUES ($1,$2,$3,true)', [user, config.issuer, 'central-subject']);
  await database.query('INSERT INTO genie_tenants(id,enabled) VALUES ($1,true)', [tenant]);
  await database.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference) VALUES ($1,$2,'active','synthetic-reviewed-fixture')", [user, tenant]);
});

function cookie(response, name) {
  return response.headers.getSetCookie().find(c => c.startsWith(`${name}=`))?.split(';')[0];
}
async function fixture(t, options = {}) {
  const calls = { exchange: 0, proof: 0 };
  const authority = { active: true, localId: options.userId??user, subject: options.proofSubject??'central-subject', ...options.authority };
  const store = new IdentityStore(database);
  const oidc = {
    async authorization(tx) { return `${config.issuer}/auth?state=${tx.state}`; },
    async exchange() {
      calls.exchange++;
      if (options.badExchange) throw Error('confidential provider failure');
      return { subject: options.subject ?? 'central-subject', uid: 'private-upstream-uid', expires: Math.floor(Date.now() / 1000) + 600 };
    },
  };
  const accounts = createAccounts(config, { fetch: async (url, request) => {
    calls.proof++;
    assert.equal(url.href, `${config.issuer}/internal/session/status`);
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
    const sent = JSON.parse(request.body);
    assert.equal(sent.client_id, config.clientId);
    assert.equal(sent.client_secret, config.clientSecret);
    assert.equal(sent.sub, options.proofSubject??'central-subject');
    assert.equal(sent.uid, 'private-upstream-uid');
    if (options.onProof) await options.onProof(calls.proof);
    if (authority.unavailable) throw Error(config.clientSecret);
    return Response.json(authority.active ? { active: true, sub: authority.subject, local_id: authority.localId } : { active: false });
  } });
  const app = createApp({ config, store, oidc, accounts, memberships: new Memberships(database),permissions:new Permissions(database),memberExports:new MemberExports(database) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) => fetch(base + path, { ...init, redirect: 'manual' });
  async function begin() {
    const response = await request('/auth/sign-in?next=https://attacker.example');
    assert.equal(response.status, 303);
    const state = new URL(response.headers.get('location')).searchParams.get('state');
    return { state, browser: cookie(response, loginCookie), response };
  }
  async function finish(login) {
    return request(`/auth/callback?code=fixture-code&state=${login.state}`, { headers: { Cookie: login.browser } });
  }
  async function signIn() {
    const response = await finish(await begin());
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/workspace');
    return { response, session: cookie(response, sessionCookie) };
  }
  return { request, begin, finish, signIn, authority, calls, store };
}

test('GENIE-2 AC1: identity and tenant come from reviewed records, not browser claims', async t => {
  const f = await fixture(t);
  const { session, response } = await f.signIn();
  const result = await f.request(`/api/auth/session?userId=attacker&tenantId=${otherTenant}`, {
    headers: { Cookie: session, 'X-User-Id': 'attacker', 'X-Tenant-Id': otherTenant } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { authenticated: true, userId: user, tenantId: tenant });
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(result.headers.get('etag'), null);
  assert.match(response.headers.getSetCookie().find(c => c.startsWith(sessionCookie)), /Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.ok(!response.headers.getSetCookie().some(c => /Domain=/i.test(c)));
  const stored = (await database.query('SELECT * FROM genie_sessions')).rows[0];
  assert.equal(stored.token_hash, digest(session.split('=')[1]));
  assert.ok(!JSON.stringify(stored).includes('private-upstream-uid'));
  assert.ok(!session.includes('central-subject'));
});

test('anonymous requests and unrecognized opaque cookies cannot open protected views', async t => {
  const f = await fixture(t);
  for (const path of ['/workspace', '/api/auth/session']) {
    assert.equal((await f.request(path)).status, 401);
    assert.equal((await f.request(path, { headers: { Cookie: `${sessionCookie}=${'A'.repeat(43)}` } })).status, 401);
  }
});

test('GENIE-2 AC2: disabling membership denies reads and destroys the presented session', async t => {
  const f = await fixture(t); const { session } = await f.signIn();
  await database.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1", [user]);
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: session } })).status, 401);
  await database.query("UPDATE genie_memberships SET status='active' WHERE user_id=$1", [user]);
  assert.equal((await f.request('/workspace', { headers: { Cookie: session } })).status, 401);
  assert.equal((await database.query('SELECT * FROM genie_sessions')).rows.length, 0);
});

for (const table of ['genie_users', 'genie_tenants']) {
  test(`disabling ${table} blocks the existing session`, async t => {
    const f = await fixture(t); const { session } = await f.signIn();
    await database.query(`UPDATE ${table} SET enabled=false`);
    assert.equal((await f.request('/workspace', { headers: { Cookie: session } })).status, 401);
  });
}

test('membership revocation during central verification is caught by the second database read', async t => {
  const f = await fixture(t, { onProof: async count => {
    if (count === 2) await database.query("UPDATE genie_memberships SET status='disabled'");
  } });
  const { session } = await f.signIn();
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: session } })).status, 401);
});

test('central revocation is checked on every request without positive caching', async t => {
  const f = await fixture(t); const { session } = await f.signIn();
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: session } })).status, 200);
  f.authority.active = false;
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: session } })).status, 401);
  assert.equal(f.calls.proof, 3);
});

test('authority outage fails closed and does not disclose secrets', async t => {
  const f = await fixture(t); const { session } = await f.signIn();
  f.authority.unavailable = true;
  const response = await f.request('/api/auth/session', { headers: { Cookie: session } });
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '{"error":"identity_unavailable"}');
});

test('mismatched central local-user mapping cannot issue a session', async t => {
  const f = await fixture(t, { authority: { localId: 'another-native-user' } });
  assert.equal((await f.finish(await f.begin())).status, 503);
  assert.equal((await database.query('SELECT * FROM genie_sessions')).rows.length, 0);
});

test('unknown identities never provision accounts from claims', async t => {
  const f = await fixture(t, { subject: "unknown' OR 1=1 --" });
  assert.equal((await f.finish(await f.begin())).status, 403);
  assert.equal((await database.query('SELECT * FROM genie_users')).rows.length, 1);
  assert.equal((await database.query('SELECT * FROM genie_sessions')).rows.length, 0);
});

test('multiple active tenants require explicit future workspace selection, not arbitrary choice', async t => {
  const f = await fixture(t);
  await database.query('INSERT INTO genie_tenants(id,enabled) VALUES ($1,true)', [otherTenant]);
  await database.query("INSERT INTO genie_memberships VALUES ($1,$2,'active','reviewed-fixture')", [user, otherTenant]);
  const response = await f.finish(await f.begin());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'workspace_selection_required');
});

test('GENIE-2 AC3: local sign-out revokes the server session and blocks replay of the old cookie', async t => {
  const f = await fixture(t); const { session } = await f.signIn();
  const workspace = await f.request('/workspace', { headers: { Cookie: session } });
  assert.equal(workspace.status, 200);
  assert.equal(workspace.headers.get('referrer-policy'), 'same-origin', 'native form POST must retain same-origin provenance');
  f.authority.unavailable = true; // Local sign-out must remain available during upstream outages.
  const response = await f.request('/auth/sign-out', { method: 'POST', headers: { Origin: config.origin, Cookie: session } });
  assert.equal(response.status, 303);
  assert.match(response.headers.getSetCookie().find(c => c.startsWith(sessionCookie)), /Max-Age=0/);
  assert.equal((await database.query('SELECT * FROM genie_sessions')).rows.length, 0);
  for (const path of ['/api/auth/session', '/workspace']) {
    assert.equal((await f.request(path, { headers: { Cookie: session } })).status, 401);
  }
});

test('cross-origin and GET sign-out do not mutate a valid session', async t => {
  const f = await fixture(t); const { session } = await f.signIn();
  assert.equal((await f.request('/auth/sign-out', { headers: { Cookie: session } })).status, 405);
  for (const origin of ['https://attacker.example', 'null', undefined]) {
    assert.equal((await f.request('/auth/sign-out', { method: 'POST', headers: { Cookie: session, ...(origin ? { Origin: origin } : {}) } })).status, 403);
  }
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: session } })).status, 200);
});

test('single-use login transactions reject browser mismatches and concurrent callback replay', async t => {
  const f = await fixture(t); const login = await f.begin();
  const wrongBrowser = { ...login, browser: `${loginCookie}=${'x'.repeat(43)}` };
  assert.equal((await f.finish(wrongBrowser)).status, 400);
  const responses = await Promise.all([f.finish(login), f.finish(login)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [303, 400]);
  assert.equal(f.calls.exchange, 1);
  assert.equal((await database.query('SELECT * FROM genie_sessions')).rows.length, 1);
});

test('expired login transactions and duplicate callback parameters cannot issue sessions', async t => {
  const f = await fixture(t); const login = await f.begin();
  const duplicate = await f.request(`/auth/callback?code=ok&state=${login.state}&state=${login.state}`, { headers: { Cookie: login.browser } });
  assert.equal(duplicate.status, 400);
  await database.query("UPDATE genie_login_transactions SET expires_at=now()-interval '1 second'");
  assert.equal((await f.finish(login)).status, 400);
  assert.equal(f.calls.exchange, 0);
});

test('expired sessions and duplicate session cookies fail closed', async t => {
  const f = await fixture(t); const { session } = await f.signIn();
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: `${session}; ${session}` } })).status, 401);
  await database.query("UPDATE genie_sessions SET expires_at=now()-interval '1 second'");
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: session } })).status, 401);
});

test('restarting the application preserves a valid PostgreSQL-backed session', async t => {
  const first = await fixture(t); const { session } = await first.signIn();
  const second = await fixture(t);
  assert.equal((await second.request('/api/auth/session', { headers: { Cookie: session } })).status, 200);
});

test('callback errors never reflect provider details and transient browser state is cleared', async t => {
  const f = await fixture(t, { badExchange: true });
  const response = await f.finish(await f.begin());
  assert.equal(response.status, 400);
  assert.equal(await response.text(), '{"error":"invalid_callback"}');
  assert.match(response.headers.getSetCookie().find(c => c.startsWith(loginCookie)), /Max-Age=0/);
});

test('disablement during callback verification prevents session insertion', async t => {
  const f = await fixture(t, { onProof: async () => {
    await database.query("UPDATE genie_memberships SET status='disabled'");
  } });
  assert.equal((await f.finish(await f.begin())).status, 503);
  assert.equal((await database.query('SELECT * FROM genie_sessions')).rows.length, 0);
});

test('identity relinking during verification invalidates the old session', async t => {
  const f = await fixture(t, { onProof: async count => {
    if (count === 2) await database.query("UPDATE genie_users SET subject='another-subject'");
  } });
  const { session } = await f.signIn();
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: session } })).status, 401);
});

test('tampered encrypted upstream state cannot authenticate or reach Accounts', async t => {
  const f = await fixture(t); const { session } = await f.signIn();
  await database.query("UPDATE genie_sessions SET sealed_upstream='tampered'");
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: session } })).status, 401);
  assert.equal(f.calls.proof, 1);
});

test('bearer headers cannot substitute for the opaque browser session', async t => {
  const f = await fixture(t); const { session } = await f.signIn();
  assert.equal((await f.request('/api/auth/session', { headers: { Authorization: `Bearer ${session.split('=')[1]}` } })).status, 401);
});

test('authentication admission is rate-limited before unbounded login rows accumulate', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 30; i++) assert.equal((await f.request('/auth/sign-in')).status, 303);
  const response = await f.request('/auth/sign-in');
  assert.equal(response.status, 429);
  assert.equal((await database.query('SELECT * FROM genie_login_transactions')).rows.length, 30);
});

const adminUser='00000000-0000-4000-8000-000000000004';
async function adminFixture(t) {
  await database.query('INSERT INTO genie_users(id,issuer,subject,enabled) VALUES ($1,$2,$3,true)',[adminUser,config.issuer,'admin-subject']);
  await database.query("INSERT INTO genie_memberships(user_id,tenant_id,status,role,review_reference) VALUES ($1,$2,'active','admin','synthetic-admin-review')",[adminUser,tenant]);
  for (const [id,name] of [[adminUser,'Acceptance administrator'],[user,'Acceptance member']])
    await database.query("INSERT INTO genie_workspace_people VALUES ($1,$2,$3,'synthetic-directory-review')",[tenant,id,name]);
  const f=await fixture(t,{userId:adminUser,subject:'admin-subject',proofSubject:'admin-subject'});
  return {...f,...await f.signIn()};
}
function jsonPost(session,body,origin=config.origin) {
  return {method:'POST',headers:{Origin:origin,Cookie:session,'Content-Type':'application/json'},body:JSON.stringify(body)};
}
async function inviteLogin(f,token) {
  const response=await f.request('/auth/invitation-sign-in',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('location'),null,'a form submission must not redirect outside the same-origin form policy');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.match(response.headers.get('content-security-policy'),/form-action 'self'/);
  const html=await response.text();
  assert.match(html,/Continue to Aplyd Accounts/);
  const state=/state=([A-Za-z0-9_-]{43})/.exec(html)?.[1];
  assert.ok(state);
  return {response,state,browser:cookie(response,loginCookie)};
}

test('GENIE-3 HTTP: ordinary members cannot read admin data or mutate using forged actor and tenant values',async t=>{
  const admin=await adminFixture(t),f=await fixture(t),{session}=await f.signIn();
  assert.equal((await f.request('/api/workspace/members',{headers:{Cookie:session}})).status,403);
  const response=await f.request('/api/workspace/members/change',jsonPost(session,{target:adminUser,status:'disabled',role:'member',version:'1',actor:adminUser,tenantId:otherTenant}));
  assert.equal(response.status,403);
  assert.equal((await database.query('SELECT * FROM genie_membership_audit')).rows.length,0);
  assert.equal((await admin.request('/api/workspace/members',{headers:{Cookie:admin.session}})).status,200);
});
test('GENIE-3 UI: reviewed labels are escaped and administrator forms retain same-origin provenance',async t=>{
  const a=await adminFixture(t);
  await database.query('UPDATE genie_workspace_people SET display_name=$1 WHERE user_id=$2',[`<img src=x onerror="alert(1)">`,user]);
  const page=await a.request('/workspace/members',{headers:{Cookie:a.session}}),html=await page.text();
  assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'same-origin');
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('private-upstream-uid'));
});
test('GENIE-3 HTTP: deactivation blocks subsequent protected reads and membership mutations',async t=>{
  const a=await adminFixture(t),f=await fixture(t),{session}=await f.signIn();
  assert.equal((await a.request('/api/workspace/members/change',jsonPost(a.session,{target:user,status:'disabled',role:'member',version:'1'}))).status,200);
  assert.equal((await f.request('/api/auth/session',{headers:{Cookie:session}})).status,401);
  assert.equal((await f.request('/api/workspace/members/change',jsonPost(session,{target:adminUser,status:'disabled',role:'member',version:'1'}))).status,401);
  const events=(await database.query('SELECT * FROM genie_membership_audit')).rows;
  assert.equal(events.length,1);assert.equal(events[0].actor_id,adminUser);assert.equal(events[0].target_id,user);
});
test('GENIE-3 HTTP: cross-origin writes and malformed payloads cannot mutate memberships',async t=>{
  const a=await adminFixture(t),body={target:user,status:'disabled',role:'member',version:'1'};
  for(const origin of ['null','https://attacker.example'])assert.equal((await a.request('/api/workspace/members/change',jsonPost(a.session,body,origin))).status,403);
  for(const bad of [{...body,target:"' OR 1=1 --"},{...body,role:'super_admin'},{...body,version:'0'},[]])assert.equal((await a.request('/api/workspace/members/change',jsonPost(a.session,bad))).status,400);
  assert.equal((await database.query('SELECT * FROM genie_membership_audit')).rows.length,0);
});
test('GENIE-3 OIDC: an explicit same-origin invitation acceptance binds the exact reviewed recipient',async t=>{
  const a=await adminFixture(t);
  await database.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1",[user]);
  const created=await a.request('/api/workspace/members/invite',jsonPost(a.session,{target:user,role:'member'}));
  assert.equal(created.status,201);const invitation=await created.json();
  assert.equal(invitation.token.length,43);
  const stored=(await database.query('SELECT * FROM genie_membership_invites')).rows[0];
  assert.equal(stored.token_hash,digest(invitation.token));assert.ok(!JSON.stringify(stored).includes(invitation.token));
  const f=await fixture(t),login=await inviteLogin(f,invitation.token),finished=await f.finish(login);
  assert.equal(finished.status,303);
  const session=cookie(finished,sessionCookie);
  assert.equal((await f.request('/api/auth/session',{headers:{Cookie:session}})).status,200);
  assert.equal((await database.query('SELECT state FROM genie_membership_invites')).rows[0].state,'accepted');
  assert.equal((await f.finish(login)).status,400);
  assert.deepEqual((await database.query('SELECT action FROM genie_membership_audit ORDER BY id')).rows.map(r=>r.action),['invited','invitation_accepted']);
});
test('GENIE-3 OIDC: wrong identity and forged GET invitation context cannot activate membership',async t=>{
  const a=await adminFixture(t);
  await database.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1",[user]);
  const created=await a.request('/api/workspace/members/invite',jsonPost(a.session,{target:user,role:'member'}));const invitation=await created.json();
  const f=await fixture(t);
  const get=await f.request('/auth/sign-in?invite='+invitation.token);
  assert.equal((await f.finish({state:new URL(get.headers.get('location')).searchParams.get('state'),browser:cookie(get,loginCookie)})).status,403);
  const wrong=await fixture(t,{userId:adminUser,subject:'admin-subject',proofSubject:'admin-subject'});
  assert.equal((await wrong.finish(await inviteLogin(wrong,invitation.token))).status,404);
  assert.equal((await database.query('SELECT state FROM genie_membership_invites')).rows[0].state,'pending');
});
test('GENIE-3 OIDC: authority outage cannot consume an invitation or activate membership',async t=>{
  const a=await adminFixture(t);await database.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1",[user]);
  const invitation=await (await a.request('/api/workspace/members/invite',jsonPost(a.session,{target:user,role:'member'}))).json();
  const f=await fixture(t);f.authority.unavailable=true;
  assert.equal((await f.finish(await inviteLogin(f,invitation.token))).status,503);
  assert.equal((await database.query('SELECT state FROM genie_membership_invites')).rows[0].state,'pending');
  assert.equal((await database.query('SELECT status FROM genie_memberships WHERE user_id=$1',[user])).rows[0].status,'disabled');
});
test('GENIE-3 OIDC: inviter revocation during fresh Accounts proof prevents acceptance',async t=>{
  const a=await adminFixture(t);await database.query("UPDATE genie_memberships SET status='disabled' WHERE user_id=$1",[user]);
  const invitation=await (await a.request('/api/workspace/members/invite',jsonPost(a.session,{target:user,role:'member'}))).json();
  const f=await fixture(t,{onProof:async()=>{await database.query("UPDATE genie_memberships SET role='member' WHERE user_id=$1",[adminUser])}});
  assert.equal((await f.finish(await inviteLogin(f,invitation.token))).status,404);
  assert.equal((await database.query('SELECT state FROM genie_membership_invites')).rows[0].state,'pending');
});

const policyMember='00000000-0000-4000-8000-000000000090';
async function policyFixture(t){
 await database.query("UPDATE genie_memberships SET role='admin' WHERE user_id=$1",[user]);
 await database.query('INSERT INTO genie_users VALUES($1,$2,$3,true)',[policyMember,config.issuer,'policy-member-subject']);
 await database.query("INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference) VALUES($1,$2,'active','synthetic-policy-review')",[policyMember,tenant]);
 for(const [u,name] of [[user,'Fixture owner'],[policyMember,'Fixture member']])await database.query("INSERT INTO genie_workspace_people VALUES($1,$2,$3,'synthetic-policy-review')",[tenant,u,name]);
 const owner=await fixture(t),member=await fixture(t,{userId:policyMember,subject:'policy-member-subject',proofSubject:'policy-member-subject'});
 const ownerSession=(await owner.signIn()).session,memberSession=(await member.signIn()).session;
 const headers=cookie=>({Cookie:cookie,Origin:config.origin,'Content-Type':'application/json'});
 const post=(actor,cookie,path,body)=>actor.request(path,{method:'POST',headers:headers(cookie),body:JSON.stringify(body)});
 async function role(name,grants){const r=await post(owner,ownerSession,'/api/workspace/roles/save',{name,grants});assert.equal(r.status,200);return r.json();}
 async function assign(roleId,assigned=true){const v=(await database.query('SELECT version::text FROM genie_memberships WHERE user_id=$1',[policyMember])).rows[0].version;
  const r=await post(owner,ownerSession,'/api/workspace/roles/assign',{target:policyMember,roleId,assigned,version:v});assert.equal(r.status,200);return r.json();}
 return{owner,member,ownerSession,memberSession,post,role,assign};
}

test('GENIE-4 AC1 HTTP: reader UI, API and registered tools allow reads and reject mutations',async t=>{
 const f=await policyFixture(t);const role=await f.role('Member reader',[{resource:'workspace.members',action:'read'}]);await f.assign(role.id);
 const h={Cookie:f.memberSession};
 const page=await f.member.request('/workspace/members',{headers:h});assert.equal(page.status,200);const html=await page.text();assert.match(html,/Fixture member/);assert.doesNotMatch(html,/Save membership/);
 const api=await f.member.request('/api/workspace/members',{headers:h});assert.equal(api.status,200);const data=await api.json();assert.deepEqual(Object.keys(data).sort(),['kind','page']);assert.equal(data.page.items.length,2);assert.ok(!JSON.stringify(data).includes('sessionHash'));
 assert.equal((await f.post(f.member,f.memberSession,'/api/tools/members.list',{})).status,200);
 const change={target:policyMember,status:'disabled',role:'member',version:'2',userId:user,tenantId:otherTenant};
 assert.equal((await f.post(f.member,f.memberSession,'/api/workspace/members/change',change)).status,403);
 assert.equal((await f.post(f.member,f.memberSession,'/api/tools/members.change',change)).status,403);
 assert.equal((await f.post(f.member,f.memberSession,'/api/tools/arbitrary.sql',{query:'select *'})).status,404);
});
test('GENIE-4 AC2 HTTP/tool: unassignment updates an existing session without cached authority',async t=>{
 const f=await policyFixture(t);const role=await f.role('Member reader',[{resource:'workspace.members',action:'read'}]);await f.assign(role.id);
 let workspace=await f.member.request('/workspace',{headers:{Cookie:f.memberSession}});assert.match(await workspace.text(),/href="\/workspace\/members"/);
 assert.equal((await f.post(f.member,f.memberSession,'/api/tools/members.list',{})).status,200);
 await f.assign(role.id,false);
 workspace=await f.member.request('/workspace',{headers:{Cookie:f.memberSession}});assert.equal(workspace.status,200);assert.doesNotMatch(await workspace.text(),/href="\/workspace\/members"/);
 assert.equal((await f.member.request('/api/workspace/members',{headers:{Cookie:f.memberSession}})).status,403);
 assert.equal((await f.post(f.member,f.memberSession,'/api/tools/members.list',{})).status,403);
 const identity=await f.member.request('/api/auth/session',{headers:{Cookie:f.memberSession}});assert.equal(identity.status,200);assert.deepEqual(await identity.json(),{authenticated:true,userId:policyMember,tenantId:tenant});
});
test('GENIE-4 AC3 HTTP: scoped managers cannot grant or assign a stronger role using browser claims',async t=>{
 const f=await policyFixture(t);const limited=await f.role('Scoped manager',[{resource:'workspace.roles',action:'read'},{resource:'workspace.roles',action:'manage'},{resource:'workspace.roles',action:'assign'},{resource:'workspace.members',action:'read'}]);await f.assign(limited.id);
 const excess=[{resource:'workspace.members',action:'manage'}];
 const denied=await f.post(f.member,f.memberSession,'/api/workspace/roles/save',{name:'Escalation',grants:excess,userId:user,tenantId:tenant,role:'admin'});assert.equal(denied.status,403);
 const strong=await f.role('Membership manager',excess);
 const assignment=await f.post(f.member,f.memberSession,'/api/workspace/roles/assign',{target:policyMember,roleId:strong.id,assigned:true,version:'2',actorId:user});assert.equal(assignment.status,403);
 const caps=await f.member.request('/api/workspace/capabilities',{headers:{Cookie:f.memberSession}});assert.equal(caps.status,200);assert.ok(!(await caps.json()).capabilities.some(x=>x.resource==='workspace.members'&&x.action==='manage'));
});
test('role-management native forms preserve origin checks and escape stored role names',async t=>{
 const f=await policyFixture(t);const role=await f.role('<script>synthetic</script>',[{resource:'workspace.members',action:'read'}]);
 const page=await f.owner.request('/workspace/roles',{headers:{Cookie:f.ownerSession}});assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'same-origin');const html=await page.text();assert.match(html,/&lt;script&gt;synthetic&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
 for(const Origin of ['null','https://attacker.example'])assert.equal((await f.owner.request('/workspace/roles/save',{method:'POST',headers:{Cookie:f.ownerSession,Origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({roleId:role.id,version:'1',name:'Changed'}).toString()})).status,403);
 const saved=await f.owner.request('/workspace/roles/save',{method:'POST',headers:{Cookie:f.ownerSession,Origin:config.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({roleId:role.id,version:'1',name:'Cleared reader'}).toString()});assert.equal(saved.status,303);
 const rows=await database.query('SELECT * FROM genie_role_permissions WHERE role_id=$1',[role.id]);assert.equal(rows.rows.length,0);
});

test('GENIE-4 HTTP background flow checks current authority and keeps job principals private',async t=>{
 const f=await policyFixture(t),role=await f.role('Export reader',[{resource:'workspace.members',action:'read'}]);await f.assign(role.id);
 const queued=await f.post(f.member,f.memberSession,'/api/workspace/member-exports',{userId:user,tenantId:otherTenant});assert.equal(queued.status,202);
 const job=await queued.json();assert.deepEqual(Object.keys(job).sort(),['id','status']);
 assert.equal((await f.member.request('/workspace/member-exports?id='+job.id,{headers:{Cookie:f.memberSession}})).status,200);
 assert.equal((await f.owner.request('/api/workspace/member-exports/'+job.id,{headers:{Cookie:f.ownerSession}})).status,404);
 await f.assign(role.id,false);
 const stored=(await database.query('SELECT session_hash FROM genie_member_exports WHERE id=$1',[job.id])).rows[0];
 const actor=await new IdentityStore(database).getSession(stored.session_hash);
 assert.equal(actor.user_id,policyMember);assert.equal(actor.tenant_id,tenant);
 const result=await runMemberExport({exports:new MemberExports(database),permissions:new Permissions(database),
  authenticateSession:createSessionAuthenticator({config,store:new IdentityStore(database),accounts:createAccounts(config,{fetch:async()=>new Response(JSON.stringify({active:true,sub:'policy-member-subject',local_id:policyMember}),{status:200})})})});
 assert.equal(result.status,'denied');
 assert.equal((await f.member.request('/api/workspace/member-exports/'+job.id,{headers:{Cookie:f.memberSession}})).status,403);
 await f.assign(role.id);
 const read=await f.member.request('/api/workspace/member-exports/'+job.id,{headers:{Cookie:f.memberSession}});assert.equal(read.status,200);
 const body=await read.json();assert.equal(body.status,'denied');assert.equal(body.result,null);assert.ok(!JSON.stringify(body).includes(stored.session_hash));
});
test('export creation requires origin and native forms redirect to scoped status',async t=>{
 const f=await policyFixture(t);await f.assign((await f.role('Reader',[{resource:'workspace.members',action:'read'}])).id);
 assert.equal((await f.member.request('/api/workspace/member-exports',{method:'POST',headers:{Cookie:f.memberSession}})).status,403);
 const response=await f.member.request('/workspace/member-exports',{method:'POST',headers:{Cookie:f.memberSession,Origin:config.origin,'Content-Type':'application/x-www-form-urlencoded'},body:''});
 assert.equal(response.status,303);assert.match(response.headers.get('location'),/^\/workspace\/member-exports\?id=/);
});
