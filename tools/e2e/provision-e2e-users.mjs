/**
 * Provision INVESTOR_E2E + ADMIN_E2E on an isolated *_test PostgreSQL database.
 * Also mints Playwright access tokens (gitignored) so E2E avoids /auth/login rate limits.
 * Refuses any database whose name does not end with _test (never touches PIF).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, '../db-harness/package.json'));
const { Client } = require('pg');
const argon2 = require('argon2');

const ROOT = path.resolve(__dirname, '../..');
const AUTH_DIR = path.join(ROOT, 'apps/web/e2e/.auth');
const CREDS_PATH = path.join(AUTH_DIR, 'credentials.local.json');
const INVESTOR_EMAIL = 'investor.e2e@pif-spring-test.local';
const ADMIN_EMAIL = 'admin.e2e@pif-spring-test.local';

function dbNameFromUrl(url) {
  try {
    const u = new URL(url.replace(/^postgresql:/, 'http:'));
    return (u.pathname || '/').replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signAccessToken({ secret, userId, sessionId, securityVersion, issuer, audience, ttlSeconds }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      sid: sessionId,
      sv: securityVersion,
      iat: now,
      exp: now + ttlSeconds,
      iss: issuer,
      aud: audience,
    }),
  );
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
}

async function upsertUser(client, { email, role, firstName, lastName, passwordHash }) {
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  const now = new Date();
  if (existing.rows.length) {
    const id = existing.rows[0].id;
    await client.query(
      `UPDATE users SET password_hash = $2, role = $3::"UserRole", status = 'ACTIVE'::"UserStatus",
        email_verified = true, email_verified_at = $4, mfa_enabled = false, mfa_secret_encrypted = NULL,
        failed_login_count = 0, locked_until = NULL, deleted_at = NULL, updated_at = $4
       WHERE id = $1`,
      [id, passwordHash, role, now],
    );
    return id;
  }
  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO users (
       id, email, first_name, last_name, password_hash, role, experience_level,
       email_verified, email_verified_at, status, failed_login_count, mfa_enabled,
       security_version, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6::"UserRole", 'BEGINNER'::"ExperienceLevel",
       true, $7, 'ACTIVE'::"UserStatus", 0, false,
       0, $7, $7
     )`,
    [id, email, firstName, lastName, passwordHash, role, now],
  );
  try {
    await client.query(
      `INSERT INTO user_preferences (id, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), id, now],
    );
  } catch {
    /* optional */
  }
  return id;
}

async function fetchMe(apiBaseUrl, accessToken) {
  const res = await fetch(`${apiBaseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('auth/me ' + res.status);
  return res.json();
}

async function ensureSession(client, userId) {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  await client.query(
    `INSERT INTO auth_sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, device_label)
     VALUES ($1, $2, $3, $3, $4, $5, $6)`,
    [sessionId, userId, now, expires, 'playwright-e2e', 'E2E'],
  );
  const sv = (await client.query('SELECT security_version FROM users WHERE id = $1', [userId])).rows[0]
    .security_version;
  return { sessionId, securityVersion: Number(sv) || 0 };
}

const rawUrl = (
  process.env.E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://nasma:root@localhost:5432/PIF_spring_test?schema=public'
).replace('?schema=public', '');
const db = dbNameFromUrl(rawUrl);
if (!db.endsWith('_test')) {
  console.error('Refusing to provision E2E users on database "' + db + '" — only *_test is allowed.');
  process.exit(1);
}

fs.mkdirSync(AUTH_DIR, { recursive: true });

let password = process.env.E2E_PASSWORD;
if (!password && fs.existsSync(CREDS_PATH)) {
  try {
    password = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')).password;
  } catch {
    password = null;
  }
}
if (!password) {
  password = 'E2e-' + crypto.randomBytes(12).toString('base64url') + '!1a';
}

const passwordHash = await hashPassword(password);
const client = new Client({ connectionString: rawUrl });
await client.connect();
const current = (await client.query('SELECT current_database() AS d')).rows[0].d;
if (!current.endsWith('_test')) {
  await client.end();
  throw new Error('Safety abort: connected to ' + current);
}

const investorId = await upsertUser(client, {
  email: INVESTOR_EMAIL,
  role: 'INVESTOR',
  firstName: 'Investor',
  lastName: 'E2E',
  passwordHash,
});
const adminId = await upsertUser(client, {
  email: ADMIN_EMAIL,
  role: 'ADMIN',
  firstName: 'Admin',
  lastName: 'E2E',
  passwordHash,
});

const envApi = loadEnvFile(path.join(ROOT, 'apps/api/.env'));
const jwtSecret = envApi.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  await client.end();
  throw new Error('JWT_ACCESS_SECRET missing/too short in apps/api/.env');
}
const issuer = envApi.JWT_ISSUER || 'mtrs-api';
const audience = envApi.JWT_AUDIENCE || 'mtrs-web';

await client.query(
  `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'e2e-reprovision'
   WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL AND user_agent = 'playwright-e2e'`,
  [[investorId, adminId]],
);

const invSession = await ensureSession(client, investorId);
const admSession = await ensureSession(client, adminId);
const investorAccessToken = signAccessToken({
  secret: jwtSecret,
  userId: investorId,
  sessionId: invSession.sessionId,
  securityVersion: invSession.securityVersion,
  issuer,
  audience,
  ttlSeconds: 2 * 3600,
});
const adminAccessToken = signAccessToken({
  secret: jwtSecret,
  userId: adminId,
  sessionId: admSession.sessionId,
  securityVersion: admSession.securityVersion,
  issuer,
  audience,
  ttlSeconds: 2 * 3600,
});

await client.end();

const apiBaseUrl = process.env.E2E_API_URL || 'http://localhost:3002/api';
const investorUser = await fetchMe(apiBaseUrl, investorAccessToken);
const adminUser = await fetchMe(apiBaseUrl, adminAccessToken);

const creds = {
  database: current,
  provisionedAt: new Date().toISOString(),
  password,
  investor: {
    email: INVESTOR_EMAIL,
    id: investorId,
    role: 'INVESTOR',
    accessToken: investorAccessToken,
    user: investorUser,
  },
  admin: {
    email: ADMIN_EMAIL,
    id: adminId,
    role: 'ADMIN',
    accessToken: adminAccessToken,
    user: adminUser,
  },
  apiBaseUrl,
  webBaseUrl: process.env.E2E_BASE_URL || 'http://localhost:4200',
};
fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
fs.writeFileSync(
  path.join(AUTH_DIR, 'env.local'),
  [
    'E2E_INVESTOR_EMAIL=' + INVESTOR_EMAIL,
    'E2E_ADMIN_EMAIL=' + ADMIN_EMAIL,
    'E2E_DATABASE=' + current,
    'E2E_BASE_URL=' + creds.webBaseUrl,
    'E2E_API_URL=' + creds.apiBaseUrl,
    '',
  ].join('\n'),
  { mode: 0o600 },
);

console.log('E2E users ready on ' + current);
console.log('  INVESTOR: ' + INVESTOR_EMAIL);
console.log('  ADMIN:    ' + ADMIN_EMAIL);
console.log('  minted access tokens (2h) written to apps/web/e2e/.auth/ (gitignored)');
