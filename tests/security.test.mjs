import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, open } from '../src/security.mjs';

test('encrypted session material is bound to its user and tenant', () => {
  const key = randomBytes(32);
  const encrypted = seal(key, 'session:user-a:tenant-a', { uid: 'private-suite-session' });
  assert.deepEqual(open(key, 'session:user-a:tenant-a', encrypted), { uid: 'private-suite-session' });
  assert.throws(() => open(key, 'session:user-b:tenant-a', encrypted));
  assert.throws(() => open(key, 'session:user-a:tenant-b', encrypted));
  assert.throws(() => open(key, 'login', encrypted));
});

test('ciphertext modification and a different session key fail authentication', () => {
  const key = randomBytes(32);
  const encrypted = seal(key, 'login', { verifier: 'private-pkce-value' });
  const bytes = Buffer.from(encrypted, 'base64url'); bytes[bytes.length - 1] ^= 1;
  assert.throws(() => open(key, 'login', bytes.toString('base64url')));
  assert.throws(() => open(randomBytes(32), 'login', encrypted));
  assert.ok(!encrypted.includes('private-pkce-value'));
});
