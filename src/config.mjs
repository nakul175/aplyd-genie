function httpsOrigin(value, name) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw Error();
    return url.origin;
  } catch { throw new Error(`Invalid ${name}`); }
}

export function readConfig(env) {
  const origin = httpsOrigin(env.GENIE_ORIGIN, 'GENIE_ORIGIN');
  const issuer = httpsOrigin(env.GENIE_IDENTITY_ISSUER, 'GENIE_IDENTITY_ISSUER');
  const clientId = env.GENIE_OIDC_CLIENT_ID;
  const clientSecret = env.GENIE_OIDC_CLIENT_SECRET;
  const key = Buffer.from(env.GENIE_SESSION_KEY ?? '', 'base64');
  if (env.GENIE_TRUST_PROXY && env.GENIE_TRUST_PROXY !== 'loopback') throw Error('Invalid trusted ingress');
  if (!['aplyd-genie', 'aplyd-genie-staging'].includes(clientId) ||
      typeof clientSecret !== 'string' || clientSecret.length < 32 || clientSecret.length > 1024 ||
      key.length !== 32 || key.toString('base64') !== env.GENIE_SESSION_KEY) {
    throw new Error('Invalid Genie authentication configuration');
  }
  return Object.freeze({ origin, issuer, clientId, clientSecret, key, trustProxy: env.GENIE_TRUST_PROXY === 'loopback',
    callback: `${origin}/auth/callback`, sessionSeconds: 3600, loginSeconds: 300 });
}
