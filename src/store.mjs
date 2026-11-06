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

  async findMembership(issuer, subject) {
    const result = await this.database.query(`
      SELECT u.id AS user_id, u.subject, u.issuer, m.tenant_id
      FROM genie_users u JOIN genie_memberships m ON m.user_id=u.id
      JOIN genie_tenants t ON t.id=m.tenant_id
      WHERE u.issuer=$1 AND u.subject=$2 AND u.enabled=true AND t.enabled=true AND m.status='active'
      ORDER BY m.tenant_id LIMIT 2`, [issuer, subject]);
    // Multi-tenant selection is a separate story; never silently choose a tenant.
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
      SELECT u.id AS user_id,u.issuer,u.subject,s.tenant_id,s.sealed_upstream
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
