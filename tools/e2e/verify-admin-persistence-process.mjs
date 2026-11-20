/**
 * Process-level admin persistence check on isolated *_test DB only.
 * Writes durable admin news via live API, restarts Spring Boot, verifies restore.
 * Never touches database named PIF.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const require = createRequire(path.resolve(__dirname, '../db-harness/package.json'));
const { Client } = require('pg');

const CREDS = path.join(ROOT, 'apps/web/e2e/.auth/credentials.local.json');
const API_DIR = path.join(ROOT, 'apps/api');
const TITLE = `Persistance process ${Date.now()}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(url, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(2000);
  }
  return false;
}

function findListenerPid(port) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)"`,
      { encoding: 'utf8' },
    ).trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

if (!fs.existsSync(CREDS)) {
  console.error('Missing E2E credentials — run npm run e2e:provision first');
  process.exit(1);
}
const creds = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
if (!String(creds.database || '').endsWith('_test')) {
  console.error('Refusing persistence process check on non-test DB');
  process.exit(1);
}

const apiBase = creds.apiBaseUrl || 'http://localhost:3002/api';
const healthUrl = apiBase.replace(/\/api$/, '') + '/api/health';
const token = creds.admin?.accessToken;
if (!token) {
  console.error('Missing admin accessToken in credentials');
  process.exit(1);
}

const auth = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

console.log('1) Write durable news on', creds.database);
const put = await fetch(`${apiBase}/admin/platform/news`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    title: TITLE,
    summary: 'Actualite durable pour redemarrage Spring Boot E2E.',
    symbol: 'E2E',
    sector: 'TEST',
  }),
});
if (!put.ok) {
  const t = await put.text();
  console.error('POST news failed', put.status, t.slice(0, 400));
  process.exit(1);
}
const created = await put.json();
const newsId = created.id || created.item?.id;
console.log('   created', newsId || '(id in body)');

const before = await fetch(`${apiBase}/admin/platform/news`, { headers: auth });
if (!before.ok) {
  console.error('GET news before restart failed', before.status);
  process.exit(1);
}
const beforeJson = await before.json();
if (!JSON.stringify(beforeJson).includes(TITLE)) {
  console.error('News not visible before restart — abort');
  process.exit(1);
}
console.log('   news present before restart');

console.log('2) Restart Spring Boot process (port 3002)');
const oldPid = findListenerPid(3002);
if (oldPid) {
  try {
    process.kill(oldPid);
  } catch {
    /* ignore */
  }
  await sleep(4000);
}

const javaHome = process.env.JAVA_HOME || 'C:\\Program Files\\Microsoft\\jdk-25.0.5.21-hotspot';
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  Path: `${javaHome}\\bin;${process.env.Path || process.env.PATH || ''}`,
};
const child = spawn(process.platform === 'win32' ? 'mvnw.cmd' : './mvnw', ['-q', 'spring-boot:run'], {
  cwd: API_DIR,
  env,
  detached: true,
  stdio: 'ignore',
  shell: true,
});
child.unref();

const up = await waitHealth(healthUrl, 90);
if (!up) {
  console.error('API did not become healthy after restart');
  process.exit(1);
}
console.log('   API healthy after restart');

console.log('3) Verify news restored from PostgreSQL');
const after = await fetch(`${apiBase}/admin/platform/news`, { headers: auth });
if (!after.ok) {
  console.error('GET news after restart failed', after.status);
  process.exit(1);
}
const afterJson = await after.json();
const restored = JSON.stringify(afterJson).includes(TITLE);

const client = new Client({
  connectionString: (
    process.env.E2E_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://nasma:root@localhost:5432/PIF_spring_test'
  ).replace('?schema=public', ''),
});
await client.connect();
const dbName = (await client.query('SELECT current_database() AS d')).rows[0].d;
if (!dbName.endsWith('_test')) {
  await client.end();
  throw new Error('Safety abort: connected to ' + dbName);
}
const row = newsId
  ? await client.query('SELECT id, title FROM platform_news_items WHERE id = $1', [newsId])
  : await client.query('SELECT id, title FROM platform_news_items WHERE title = $1', [TITLE]);
if (newsId) {
  await client.query('DELETE FROM platform_news_items WHERE id = $1', [newsId]);
} else {
  await client.query('DELETE FROM platform_news_items WHERE title = $1', [TITLE]);
}
await client.end();

if (!restored && row.rows.length === 0) {
  console.error('INCOMPLET — news neither in API nor DB after restart');
  process.exit(1);
}

console.log('OK process persistence');
console.log('  database:', dbName);
console.log('  apiRestored:', restored);
console.log('  dbRow:', row.rows.length > 0);
console.log('  cleaned news after verification');
