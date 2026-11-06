import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createOidc } from '../src/oidc.mjs';
import { readConfig } from '../src/config.mjs';
import { randomToken } from '../src/security.mjs';

const config = readConfig({ GENIE_ORIGIN: 'https://genie.example.test',
  GENIE_IDENTITY_ISSUER: 'https://accounts.example.test', GENIE_OIDC_CLIENT_ID: 'aplyd-genie',
  GENIE_OIDC_CLIENT_SECRET: 'synthetic-test-secret-'.repeat(3), GENIE_SESSION_KEY: Buffer.alloc(32, 1).toString('base64') });
const pair = await generateKeyPair('RS256');
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'fixture-key', use: 'sig', alg: 'RS256' };

async function fixture(overrides = {}, options = {}) {
  const tx = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
  const calls = [];
  const metadata = { issuer: config.issuer, authorization_endpoint: `${config.issuer}/auth`,
    token_endpoint: `${config.issuer}/token`, jwks_uri: `${config.issuer}/jwks`,
    response_types_supported: ['code'], subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'], ...options.metadata };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: config.issuer, aud: config.clientId, sub: 'central-subject',
    nonce: tx.nonce, iat: now, exp: now + 300, aplyd_session_uid: 'private-uid', ...overrides };
  let signed = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' }).sign(pair.privateKey);
  if (options.tamper) signed = signed.slice(0, signed.lastIndexOf('.') + 1) + 'invalid-signature';
  const oidc = createOidc(config, { fetch: async (input, init) => {
    const url = String(input); calls.push(url);
    if (url === `${config.issuer}/.well-known/openid-configuration`) return Response.json(metadata);
    if (url === `${config.issuer}/jwks`) return Response.json({ keys: [publicKey] });
    if (url === `${config.issuer}/token`) {
      const headers = new Headers(init.headers);
      assert.match(headers.get('authorization'), /^Basic /);
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('redirect_uri'), config.callback);
      assert.equal(body.get('code_verifier'), tx.verifier);
      assert.equal(body.get('grant_type'), 'authorization_code');
      return Response.json({ access_token: 'fixture-access-token', token_type: 'Bearer', id_token: signed });
    }
    throw Error('Unexpected identity destination');
  } });
  const callback = new URL(config.callback);
  callback.searchParams.set('code', 'fixture-code'); callback.searchParams.set('state', tx.state);
  return { oidc, tx, calls, callback };
}

test('real OIDC adapter verifies signed tokens and sends PKCE with a confidential token exchange', async () => {
  const f = await fixture();
  const url = new URL(await f.oidc.authorization(f.tx));
  assert.equal(url.origin, config.issuer);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('nonce'), f.tx.nonce);
  assert.ok(!url.href.includes(config.clientSecret));
  const identity = await f.oidc.exchange(f.callback, f.tx);
  assert.equal(identity.subject, 'central-subject');
  assert.equal(identity.uid, 'private-uid');
  assert.ok(identity.expires > Math.floor(Date.now() / 1000));
  assert.ok(f.calls.includes(`${config.issuer}/jwks`));
});

for (const [name, claims, options] of [
  ['wrong issuer', { iss: 'https://attacker.example' }],
  ['wrong audience', { aud: 'other-client' }],
  ['wrong nonce', { nonce: 'different' }],
  ['expired token', { exp: 1 }],
  ['future issue time', { iat: Math.floor(Date.now() / 1000) + 120 }],
  ['excessive lifetime', { exp: Math.floor(Date.now() / 1000) + 7200 }],
  ['missing session binding', { aplyd_session_uid: null }],
  ['wrong authorized party', { azp: 'another-client' }],
  ['multiple audiences without authorized party', { aud: [config.clientId, 'other-client'] }],
  ['future not-before time', { nbf: Math.floor(Date.now() / 1000) + 5 }],
  ['invalid signature', {}, { tamper: true }],
]) {
  test(`real OIDC adapter rejects ${name}`, async () => {
    const f = await fixture(claims, options);
    await assert.rejects(f.oidc.exchange(f.callback, f.tx));
  });
}

test('OIDC state mismatch is rejected before the token endpoint is called', async () => {
  const f = await fixture(); f.callback.searchParams.set('state', 'wrong');
  await assert.rejects(f.oidc.exchange(f.callback, f.tx));
  assert.ok(!f.calls.includes(`${config.issuer}/token`));
});

test('discovery cannot redirect credentials or signing-key lookups to another origin', async () => {
  for (const name of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    const f = await fixture({}, { metadata: { [name]: 'https://attacker.example/collect' } });
    await assert.rejects(f.oidc.authorization(f.tx));
    assert.ok(!f.calls.some(url => url.includes('attacker')));
  }
});
