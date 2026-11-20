import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED = 'PIF_spring_test';
const url = (process.env.DATABASE_URL || 'postgresql://nasma:root@localhost:5432/PIF_spring_test')
  .replace('?schema=public', '');

const client = new Client({ connectionString: url });
await client.connect();
const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
if (db !== ALLOWED) {
  await client.end();
  throw new Error('Refusing to migrate database "' + db + '" — only ' + ALLOWED + ' is allowed');
}

const sqlPath = path.join(__dirname, 'prisma/migrations/20261119220000_platform_admin_content/migration.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
await client.query(sql);

try {
  await client.query(
    "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'manual-apply-isolated', NOW(), '20261119220000_platform_admin_content', NULL, NULL, NOW(), 1) ON CONFLICT DO NOTHING"
  );
} catch (e) {
  console.log('migration history note:', e.message);
}

const tables = await client.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'platform_%' ORDER BY 1"
);
console.log('OK DB=', db, 'tables=', tables.rows.map((r) => r.tablename));
await client.end();