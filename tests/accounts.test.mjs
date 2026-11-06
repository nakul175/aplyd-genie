import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../src/accounts.mjs';
import { readConfig } from '../src/config.mjs';

const env = { GENIE_ORIGIN: 'https://genie.example.test', GENIE_IDENTITY_ISSUER: 'https://accounts.example.test',
  GENIE_OIDC_CLIENT_ID: 'aplyd-genie', GENIE_OIDC_CLIENT_SECRET: 'test-only-secret-'.repeat(3),
  GENIE_SESSION_KEY: Buffer.alloc(32, 2).toString('base64') };
const config = readConfig(env);

for (const body of [{ active: true }, { active: 'true' }, { active: true, sub: 'other', local_id: 'native' },
  { active: true, sub: 'subject', local_id: 'other' }, {}]) {
  test(`Accounts rejects malformed or mismatched proof ${JSON.stringify(body)}`, async () => {
    const adapter = createAccounts(config, { fetch: async () => Response.json(body) });
    await assert.rejects(adapter.requireSession('subject', 'uid', 'native'), { status: 503 });
  });
}

test('Accounts bounds response size and rejects redirects or HTTP failures', async () => {
  for (const response of [new Response('x'.repeat(4097)), new Response('', { status: 302 }), new Response('', { status: 500 })]) {
    const adapter = createAccounts(config, { fetch: async () => response });
    await assert.rejects(adapter.requireSession('subject', 'uid', 'native'), { status: 503 });
  }
});

test('unsafe issuer and app origins or missing secrets fail configuration', () => {
  for (const bad of [{ GENIE_ORIGIN: 'http://genie.example.test' }, { GENIE_IDENTITY_ISSUER: 'https://user:pass@accounts.example.test' },
    { GENIE_IDENTITY_ISSUER: 'https://accounts.example.test?redirect=other' }, { GENIE_OIDC_CLIENT_SECRET: '' },
    { GENIE_SESSION_KEY: 'invalid' }, { GENIE_OIDC_CLIENT_ID: 'holy-sheet' }]) assert.throws(() => readConfig({ ...env, ...bad }));
});
