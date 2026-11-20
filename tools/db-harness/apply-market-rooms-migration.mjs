import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED = 'PIF_spring_test';

function loadUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.replace('?schema=public', '');
  const envPath = path.join(__dirname, '../../apps/api/.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL missing');
  let u = m[1].trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) u = u.slice(1, -1);
  return u.replace('?schema=public', '');
}

const client = new Client({ connectionString: loadUrl() });
await client.connect();
const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
if (db !== ALLOWED) {
  await client.end();
  throw new Error(`Refusing to migrate database "${db}" — only ${ALLOWED}`);
}

const name = '20261120180000_market_rooms';
const sqlPath = path.join(__dirname, 'prisma/migrations', name, 'migration.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
await client.query(sql);
try {
  await client.query(
    `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (gen_random_uuid()::text, 'manual-apply-isolated', NOW(), $1, NULL, NULL, NOW(), 1)
     ON CONFLICT DO NOTHING`,
    [name],
  );
} catch (e) {
  console.log('migration history note:', e.message);
}

const tables = await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'market_room%' ORDER BY 1`,
);
console.log(JSON.stringify({ db, tables: tables.rows.map((r) => r.tablename) }, null, 2));
await client.end();
