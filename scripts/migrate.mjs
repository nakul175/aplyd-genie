import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
let connection;
try {
  connection = await pool.connect();
  await connection.query('BEGIN');
  await connection.query("SELECT pg_advisory_xact_lock(hashtext('aplyd-genie-migrations'))");
  await connection.query('CREATE TABLE IF NOT EXISTS genie_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of ['001_identity_sessions.sql', '002_shared_rate_limits.sql', '003_workspace_memberships.sql','004_audit_page_cursor.sql','005_resource_permissions.sql','006_permission_aware_memberships.sql','007_authorized_exports.sql']) {
  const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const existing = await connection.query('SELECT checksum FROM genie_migrations WHERE name=$1', [name]);
  if (existing.rows.length && existing.rows[0].checksum !== checksum) throw Error('Applied migration changed');
  if (!existing.rows.length) {
    await connection.query(sql);
    await connection.query('INSERT INTO genie_migrations(name,checksum) VALUES ($1,$2)', [name, checksum]);
  }
  }
  await connection.query('COMMIT');
  console.log('genie_migrations_complete');
} catch {
  if (connection) await connection.query('ROLLBACK').catch(() => {});
  console.error('genie_migration_failed');
  process.exitCode = 1;
} finally { connection?.release(); await pool.end(); }
