/** Accepts a pg Pool or another PostgreSQL query client. No email/name binding. */
export class IdentityStore {
  constructor(database) { this.database = database; }

  async putLogin({ stateHash, browserHash, sealed, expires }) {
    await this.database.query(
      'INSERT INTO genie_login_transactions (state_hash,browser_hash,sealed_transaction,expires_at) VALUES ($1,$2,$3,$4)',
      [stateHash, browserHash, sealed, expires]);
  }

  async takeLogin(stateHash, browserHash) {
    // A single atomic DELETE makes concurrent callback replays single-use.
    const result = await this.database.query(
      'DELETE FROM genie_login_transactions WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING sealed_transaction',
      [stateHash, browserHash]);
    return result.rows[0]?.sealed_transaction;
  }

  async peekLogin(stateHash, browserHash) {
    return (await this.database.query(
      'SELECT sealed_transaction FROM genie_login_transactions WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now()',
      [stateHash,browserHash])).rows[0]?.sealed_transaction;
  }

  async listWorkspaces(userId, after=null) {
    const result=await this.database.query(`SELECT t.id AS "tenantId",t.display_name AS name
      FROM genie_memberships m JOIN genie_tenants t ON t.id=m.tenant_id JOIN genie_users u ON u.id=m.user_id
      WHERE m.user_id=$1 AND m.status='active' AND t.enabled AND u.enabled AND ($2::uuid IS NULL OR t.id>$2)
      ORDER BY t.id LIMIT 51`,[userId,after]);
    const items=result.rows.slice(0,50);
    return {items,nextCursor:result.rows.length>50?items.at(-1).tenantId:null};
  }

  async hasWorkspace(userId, tenantId) {
    return (await this.database.query(`SELECT EXISTS(SELECT 1 FROM genie_memberships m
      JOIN genie_tenants t ON t.id=m.tenant_id JOIN genie_users u ON u.id=m.user_id
      WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.status='active' AND t.enabled AND u.enabled) AS allowed`,[userId,tenantId])).rows[0].allowed;
  }

  async switchWorkspace(sourceHash,nextHash,targetTenant,sealed) {
    return (await this.database.query('SELECT genie_switch_workspace($1,$2,$3,$4) AS result',
      [sourceHash,nextHash,targetTenant,sealed])).rows[0].result;
  }

  async signOutFamily(tokenHash) {
    await this.database.query('SELECT genie_sign_out_family($1)',[tokenHash]);
  }

  async findMembership(issuer, subject) {
    const result = await this.database.query(`
      SELECT u.id AS user_id, u.subject, u.issuer, m.tenant_id
      FROM genie_users u JOIN genie_memberships m ON m.user_id=u.id
      JOIN genie_tenants t ON t.id=m.tenant_id
      WHERE u.issuer=$1 AND u.subject=$2 AND u.enabled=true AND t.enabled=true AND m.status='active'
      ORDER BY m.tenant_id LIMIT 2`, [issuer, subject]);
    // Two rows suffice to distinguish a single destination from explicit selection.
    return result.rows;
  }

  async putSession({ tokenHash, userId, tenantId, issuer, subject, sealed, expires }) {
    await this.database.query(`
      INSERT INTO genie_sessions (token_hash,user_id,tenant_id,sealed_upstream,expires_at)
      SELECT $1,u.id,t.id,$4,$5 FROM genie_users u
      JOIN genie_memberships m ON m.user_id=u.id JOIN genie_tenants t ON t.id=m.tenant_id
      WHERE u.id=$2 AND t.id=$3 AND u.issuer=$6 AND u.subject=$7
        AND u.enabled=true AND t.enabled=true AND m.status='active'
      RETURNING token_hash`, [tokenHash, userId, tenantId, sealed, expires, issuer, subject]).then(result => {
        if (result.rows.length !== 1) throw Error('Membership changed');
      });
  }

  async getSession(tokenHash) {
    const result = await this.database.query(`
      SELECT u.id AS user_id,u.issuer,u.subject,s.tenant_id,s.sealed_upstream,s.browser_active,t.display_name AS workspace_name,
        coalesce(to_jsonb(m)->>'role','member') AS role
      FROM genie_sessions s JOIN genie_users u ON u.id=s.user_id
      JOIN genie_tenants t ON t.id=s.tenant_id
      JOIN genie_memberships m ON m.user_id=u.id AND m.tenant_id=t.id
      WHERE s.token_hash=$1 AND s.expires_at>now()
        AND u.enabled=true AND t.enabled=true AND m.status='active'`, [tokenHash]);
    return result.rows[0];
  }

  async deleteSession(tokenHash) {
    await this.database.query('DELETE FROM genie_sessions WHERE token_hash=$1', [tokenHash]);
  }
}
