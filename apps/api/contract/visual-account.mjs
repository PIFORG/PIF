// Creates (or removes) the disposable accounts used for Angular browser journeys.
// Refuses any database whose name does not end with _test.
//
// Usage (repository root):
//   $env:DATABASE_URL = '<url of the *_test database>'
//   node apps/api/contract/visual-account.mjs create|delete
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  createPrisma,
  hashPassword,
  encryptMfaSecret,
} from '../../../tools/db-harness/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const harnessDir = join(repoRoot, 'tools', 'db-harness');
const require = createRequire(join(harnessDir, 'package.json'));
const { authenticator } = require('otplib');

// Own domain: differential-auth.mjs deletes every @spring-contract.test account when it starts and ends.
export const VISUAL_EMAIL = 'visual-check@spring-visual.test';
export const VISUAL_MFA_EMAIL = 'visual-mfa@spring-visual.test';
export const VISUAL_ADMIN_EMAIL = 'visual-admin@spring-visual.test';
export const VISUAL_UNKNOWN_EMAIL = 'nobody@spring-visual.test';
/** Holds one virtual portfolio whose orders are placed only through the Spring API (see visual-parity.mjs). */
export const VISUAL_TRADER_EMAIL = 'visual-trader@spring-visual.test';
/** Test-only credential for disposable accounts that exist only in a *_test database. */
export const VISUAL_PASSWORD = 'Visual-Check-Pass-1!';

/** The MFA key is read in-process from the Spring .env so fixtures match the servers; it is never printed. */
function envValue(name) {
  const candidates = [
    join(here, '../.env'),
    join(repoRoot, 'apps', 'api', '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith(name + '='));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

export async function connect() {
  const dbUrl = process.env.DATABASE_URL ?? '';
  const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error('Refusing: DATABASE_URL must point to a *_test database');
  return { prisma: createPrisma(dbUrl), dbName };
}

async function remove(prisma) {
  const users = await prisma.user.findMany({ where: { email: { in: [VISUAL_EMAIL, VISUAL_MFA_EMAIL, VISUAL_ADMIN_EMAIL, VISUAL_TRADER_EMAIL] } } });
  for (const user of users) {
    await prisma.auditEvent.deleteMany({ where: { OR: [{ subjectUserId: user.id }, { actorUserId: user.id }] } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  return users.length;
}

async function createUser(prisma, email, extra = {}) {
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      firstName: 'Visual',
      lastName: 'Check',
      passwordHash: await hashPassword(VISUAL_PASSWORD),
      emailVerified: true,
      emailVerifiedAt: now,
      status: 'ACTIVE',
      experienceLevel: 'INTERMEDIATE',
      ...extra,
    },
  });
  await prisma.userPreferences.create({
    data: { id: randomUUID(), userId: user.id, preferredCurrency: 'EUR', timezone: 'Africa/Tunis', updatedAt: now },
  });
}

export const encryptForAccount = (secret) => encryptMfaSecret(secret, process.env.MFA_ENCRYPTION_KEY ?? envValue('MFA_ENCRYPTION_KEY')).ciphertext;

/** Creates the trader account when it is missing; its portfolio is opened through the Spring API, not here. */
export async function ensureTrader(prisma) {
  const existing = await prisma.user.findUnique({ where: { email: VISUAL_TRADER_EMAIL } });
  if (!existing) await createUser(prisma, VISUAL_TRADER_EMAIL, { lastName: 'Trader' });
}

/** Recreates the accounts in their initial state; returns the MFA account's TOTP secret (keep it in memory). */
export async function create(prisma) {
  await remove(prisma);
  await createUser(prisma, VISUAL_EMAIL);
  await createUser(prisma, VISUAL_TRADER_EMAIL, { lastName: 'Trader' });
  await createUser(prisma, VISUAL_ADMIN_EMAIL, { role: 'ADMIN', lastName: 'Admin' });
  const secret = authenticator.generateSecret();
  await createUser(prisma, VISUAL_MFA_EMAIL, {
    mfaEnabled: true,
    mfaVerifiedAt: new Date(),
    mfaSecretEncrypted: encryptForAccount(secret),
    mfaSecretKeyVersion: 1,
  });
  return secret;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command !== 'create' && command !== 'delete') throw new Error('Usage: visual-account.mjs create|delete');
  const { prisma, dbName } = await connect();
  try {
    if (command === 'create') {
      await create(prisma);
      console.log(`Created ${VISUAL_EMAIL}, ${VISUAL_TRADER_EMAIL}, ${VISUAL_ADMIN_EMAIL} and ${VISUAL_MFA_EMAIL} in ${dbName}`);
    } else {
      console.log(`Deleted ${await remove(prisma)} visual account(s) from ${dbName}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
