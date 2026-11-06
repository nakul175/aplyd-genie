import assert from 'node:assert/strict';
const origin = 'https://staging.genie.aplyd.org';
const get = (path, options = {}) => fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...options });
assert.equal((await get('/health/live')).status, 200);
for (const path of ['/workspace', '/api/auth/session']) {
  const response = await get(path);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}
const start = await get('/auth/sign-in');
assert.equal(start.status, 303);
const authorization = new URL(start.headers.get('location'));
assert.equal(authorization.origin, 'https://accounts.aplyd.org');
assert.equal(authorization.searchParams.get('client_id'), 'aplyd-genie-staging');
assert.equal(authorization.searchParams.get('redirect_uri'), origin + '/auth/callback');
assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
const cookie = start.headers.getSetCookie().find(value => value.startsWith('__Host-genie_login='));
assert.ok(cookie);
for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(cookie.includes(attribute));
assert.equal((await get('/auth/sign-out')).status, 405);
for (const Origin of ['https://attacker.example', 'null']) {
  assert.equal((await get('/auth/sign-out', { method: 'POST', headers: { Origin } })).status, 403);
}
console.log(JSON.stringify({ tls: 'verified', anonymousProtected: 401, oidcRedirect: 'verified',
  secureLoginCookie: 'verified', crossOriginLogout: 403, nullOriginLogout: 403, getLogout: 405 }));
