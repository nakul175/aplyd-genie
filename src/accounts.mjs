import { HttpError } from './security.mjs';

/** Existing Accounts /internal/session/status contract, never the HS-only tenant endpoint. */
export function createAccounts(config, { fetch: request = globalThis.fetch } = {}) {
  return {
    async requireSession(subject, uid, localId) {
      if (typeof subject !== 'string' || !subject || subject.length > 200 ||
          typeof uid !== 'string' || !uid || uid.length > 200) {
        throw new HttpError(401, 'authentication_required');
      }
      let active;
      try {
        const response = await request(new URL('/internal/session/status', config.issuer), {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(3000),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, sub: subject, uid }),
        });
        if (!response.ok) throw Error();
        // Bound streamed responses, including bodies without Content-Length.
        const chunks = []; let length = 0;
        for await (const chunk of response.body ?? []) {
          length += chunk.byteLength;
          if (length > 4096) { await response.body.cancel().catch(() => {}); throw Error(); }
          chunks.push(chunk);
        }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (result?.active === false) active = false;
        else if (result?.active === true && result.sub === subject && result.local_id === localId) active = true;
        else throw Error();
      } catch { throw new HttpError(503, 'identity_unavailable'); }
      if (!active) throw new HttpError(401, 'authentication_required');
    },
  };
}
