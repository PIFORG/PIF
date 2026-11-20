import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, 'package.json'));
const pg = require('pg');
const root = path.resolve(__dirname, '../..');
const ALLOWED = 'PIF_spring_test';

export function projectRoot() {
  return root;
}

export function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
}

export function loadApiDatabaseUrl() {
  const envPath = path.join(root, 'apps', 'api', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL missing in apps/api/.env');
  let u = m[1].trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) u = u.slice(1, -1);
  return u.replace('?schema=public', '');
}

export async function connectAllowedDb() {
  const url = process.env.DATABASE_URL || loadApiDatabaseUrl();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
  if (db !== ALLOWED) {
    await client.end();
    throw new Error(`Refusing write on "${db}" — only ${ALLOWED}`);
  }
  return client;
}

export function fileSha256(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

/** Parse decimal TND/US price to millimes (×1000, rounded). */
export function toMillimes(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s === '-' || s === 'null') return null;
  s = s.replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000);
}

export function parseFrDate(s) {
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const mm = String(m[2]).padStart(2, '0');
  const dd = String(m[1]).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}