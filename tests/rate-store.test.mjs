import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PostgresRateStore } from '../src/rate-store.mjs';

test('independent service instances share atomic windows without storing raw client addresses', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../migrations/002_shared_rate_limits.sql', import.meta.url), 'utf8'));
    const a = new PostgresRateStore(db), b = new PostgresRateStore(db);
    a.init({ windowMs: 60000 }); b.init({ windowMs: 60000 });
    const hits = await Promise.all(Array.from({ length: 35 }, (_, i) => (i % 2 ? a : b).increment('203.0.113.10')));
    assert.deepEqual(hits.map(x => x.totalHits).sort((a,b) => a-b), Array.from({length:35},(_,i)=>i+1));
    assert.equal((await a.increment('203.0.113.11')).totalHits, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM genie_rate_limits WHERE key_hash LIKE '%203.0.113%'")).rows[0].n, 0);
    await db.exec("UPDATE genie_rate_limits SET reset_at=now()-interval '1 second'");
    assert.equal((await b.increment('203.0.113.10')).totalHits, 1);
    await b.decrement('203.0.113.10');
    assert.equal((await a.increment('203.0.113.10')).totalHits, 1);
    await a.resetKey('203.0.113.10');
    assert.equal((await b.increment('203.0.113.10')).totalHits, 1);
  } finally { await db.close(); }
});
