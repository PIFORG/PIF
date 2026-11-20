import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, 'package.json'));
const { Client } = require('pg');

const ALLOWED = 'PIF_spring_test';
const root = path.resolve(__dirname, '../..');

function loadApiDatabaseUrl() {
  const envPath = path.join(root, 'apps', 'api', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL missing in apps/api/.env');
  let u = m[1].trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) u = u.slice(1, -1);
  return u.replace('?schema=public', '');
}

const url = process.env.DATABASE_URL || loadApiDatabaseUrl();
const client = new Client({ connectionString: url });
await client.connect();
const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
if (db !== ALLOWED) {
  await client.end();
  throw new Error(`Refusing schema apply on "${db}" — only ${ALLOWED}`);
}

const sqlPath = path.join(
  root,
  'tools/db-harness/prisma/migrations/20261120120000_market_data_warehouse/migration.sql',
);
await client.query(fs.readFileSync(sqlPath, 'utf8'));
console.log(JSON.stringify({ ok: true, db, migration: '20261120120000_market_data_warehouse' }));
await client.end();