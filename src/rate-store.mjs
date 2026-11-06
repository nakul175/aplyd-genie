import { digest } from './security.mjs';

/** Atomic shared fixed windows; raw IP addresses are never persisted. */
export class PostgresRateStore {
  localKeys = false;
  constructor(db) { this.db = db; }
  init({ windowMs }) { this.windowMs = windowMs; }
  async increment(key) {
    const { rows } = await this.db.query(`INSERT INTO genie_rate_limits(key_hash,hits,reset_at)
      VALUES ($1,1,now()+($2 * interval '1 millisecond'))
      ON CONFLICT(key_hash) DO UPDATE SET
        hits=CASE WHEN genie_rate_limits.reset_at<=now() THEN 1 ELSE genie_rate_limits.hits+1 END,
        reset_at=CASE WHEN genie_rate_limits.reset_at<=now() THEN excluded.reset_at ELSE genie_rate_limits.reset_at END
      RETURNING hits,reset_at`, [digest(key), this.windowMs]);
    return { totalHits: rows[0].hits, resetTime: new Date(rows[0].reset_at) };
  }
  async decrement(key) {
    await this.db.query('UPDATE genie_rate_limits SET hits=greatest(0,hits-1) WHERE key_hash=$1', [digest(key)]);
  }
  async resetKey(key) { await this.db.query('DELETE FROM genie_rate_limits WHERE key_hash=$1', [digest(key)]); }
}
