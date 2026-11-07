import {open,HttpError} from './security.mjs';
const unauthorized=()=>new HttpError(401,'authentication_required');
/** Shared by normal requests and jobs; never caches Accounts or local authority. */
export function createSessionAuthenticator({config,store,accounts}){
 return async function authenticateSession(hash){
  if(typeof hash!=='string'||! /^[a-f0-9]{64}$/.test(hash))throw unauthorized();
    const before = await store.getSession(hash);
    if (!before || before.issuer !== config.issuer) {
      await store.deleteSession(hash);
      throw unauthorized();
    }
    let upstream;
    try { upstream = open(config.key, `session:${before.user_id}:${before.tenant_id}`, before.sealed_upstream); }
    catch { await store.deleteSession(hash); throw unauthorized(); }
    try { await accounts.requireSession(before.subject, upstream.uid, before.user_id); }
    catch (error) {
      if (error instanceof HttpError && error.status === 401) await store.deleteSession(hash);
      throw error;
    }
    // Never retain a positive authority result across requests or across membership changes.
    const after = await store.getSession(hash);
    if (!after || after.user_id !== before.user_id || after.subject !== before.subject ||
        after.issuer !== before.issuer || after.tenant_id !== before.tenant_id ||
        after.sealed_upstream !== before.sealed_upstream) {
      await store.deleteSession(hash);
      throw unauthorized();
    }
    return { userId: after.user_id, tenantId: after.tenant_id, role: after.role,
      sessionHash: hash, issuer: after.issuer, subject: after.subject };
 };
}
