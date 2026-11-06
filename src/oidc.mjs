import * as oidc from 'openid-client';

export function createOidc(config, { fetch } = {}) {
  let pending;
  async function configuration() {
    if (!pending) pending = oidc.discovery(new URL(config.issuer), config.clientId,
      { id_token_signed_response_alg: 'RS256' }, oidc.ClientSecretBasic(config.clientSecret),
      { timeout: 5, ...(fetch ? { [oidc.customFetch]: fetch } : {}) }).then(client => {
      const metadata = client.serverMetadata();
      if (metadata.issuer !== config.issuer || !metadata.supportsPKCE()) throw Error('Unsupported issuer');
      for (const name of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        const endpoint = new URL(metadata[name]);
        if (endpoint.origin !== config.issuer || endpoint.username || endpoint.password || endpoint.hash) throw Error('Untrusted identity endpoint');
      }
      // Verify token signatures as well as TLS, issuer, audience, nonce and state.
      oidc.enableNonRepudiationChecks(client);
      return client;
    }).catch(error => { pending = undefined; throw error; });
    return pending;
  }
  return {
    async authorization(transaction) {
      return oidc.buildAuthorizationUrl(await configuration(), {
        response_type: 'code', redirect_uri: config.callback, scope: 'openid profile aplyd',
        state: transaction.state, nonce: transaction.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(transaction.verifier), code_challenge_method: 'S256',
        // Invitation acceptance must verify the account selected in the current
        // upstream login, rather than silently reuse a different central account.
        ...(transaction.inviteHash ? { prompt: 'login' } : {}),
      }).href;
    },
    async exchange(callback, transaction) {
      const tokens = await oidc.authorizationCodeGrant(await configuration(), callback, {
        pkceCodeVerifier: transaction.verifier, expectedState: transaction.state,
        expectedNonce: transaction.nonce, idTokenExpected: true,
      });
      const claims = tokens.claims();
      const now = Math.floor(Date.now() / 1000);
      if (!claims || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 200 ||
          typeof claims.aplyd_session_uid !== 'string' || !claims.aplyd_session_uid || claims.aplyd_session_uid.length > 200 ||
          !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
          claims.iat > now || claims.exp <= now || claims.exp <= claims.iat ||
          claims.exp - claims.iat > config.sessionSeconds || now - claims.iat > config.sessionSeconds ||
          (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now)) ||
          (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== config.clientId) ||
          (claims.azp !== undefined && claims.azp !== config.clientId)) throw Error('Invalid identity claims');
      return { subject: claims.sub, uid: claims.aplyd_session_uid, expires: claims.exp };
    },
  };
}
