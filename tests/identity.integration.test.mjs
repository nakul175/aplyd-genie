import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.mjs';
import { IdentityStore } from '../src/store.mjs';
import { createAccounts } from '../src/accounts.mjs';
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
  await database.exec(await readFile(new URL('../migrations/001_identity_sessions.sql', import.meta.url), 'utf8'));
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
  const authority = { active: true, localId: user, subject: 'central-subject', ...options.authority };
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
    assert.equal(sent.sub, 'central-subject');
    assert.equal(sent.uid, 'private-upstream-uid');
    if (options.onProof) await options.onProof(calls.proof);
    if (authority.unavailable) throw Error(config.clientSecret);
    return Response.json(authority.active ? { active: true, sub: authority.subject, local_id: authority.localId } : { active: false });
  } });
  const app = createApp({ config, store, oidc, accounts });
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
