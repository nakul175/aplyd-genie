import pg from 'pg';
import { readConfig } from './config.mjs';
import { createApp } from './app.mjs';
import { IdentityStore } from './store.mjs';
import { createOidc } from './oidc.mjs';
import { createAccounts } from './accounts.mjs';
import { PostgresRateStore } from './rate-store.mjs';

let pool;
try {
  const config = readConfig(process.env);
  if (!process.env.DATABASE_URL) throw Error('Missing database');
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10,
    connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000, statement_timeout: 5000 });
  pool.on('error', () => console.error('genie_database_connection_failed'));
  await pool.query('SELECT 1');
  const app = createApp({ config, store: new IdentityStore(pool), oidc: createOidc(config), accounts: createAccounts(config), rateStore: new PostgresRateStore(pool) });
  // Private loopback listener; the reviewed HTTPS reverse proxy owns public ingress.
  const server = app.listen(port, '127.0.0.1', () => console.log('genie_started'));
  server.on('error', async () => {
    console.error('genie_listener_failed');
    process.exitCode = 1;
    await pool.end();
  });
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => { await pool.end(); clearTimeout(deadline); });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch {
  console.error('genie_startup_failed');
  process.exitCode = 1;
  await pool?.end();
}
