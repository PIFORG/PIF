// Shared harness for the NestJS-vs-Spring differential contract tests.
//
// Both APIs must run against the SAME isolated database whose name ends with _test; anything else is refused.
// Disposable accounts live under @spring-contract.test and are deleted by cleanup().
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  createPrisma,
  hashPassword,
  hashSecret,
  encryptMfaSecret,
} from '../../../tools/db-harness/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const harnessDir = join(repoRoot, 'tools', 'db-harness');
/** Spring Boot application root (`apps/api`). */
export const apiDir = resolve(here, '..');
const require = createRequire(join(harnessDir, 'package.json'));
export { hashPassword, hashSecret, encryptMfaSecret };
export const { authenticator } = require('otplib');

export const NEST = process.env.NEST_URL ?? 'http://localhost:3001';
export const SPRING = process.env.SPRING_URL ?? 'http://localhost:3002';
export const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:4200';
const UA = 'pif-differential-contract/1.0';

const dbUrl = process.env.DATABASE_URL ?? '';
export const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) throw new Error('Refusing: DATABASE_URL must point to a *_test database');
export const prisma = createPrisma(dbUrl);

/** Values are read in-process from the Spring .env so fixtures match the servers; they are never printed. */
export function envValue(name) {
  const candidates = [
    join(apiDir, '.env'),
    join(repoRoot, 'apps', 'api', '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith(name + '='));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}
export const MFA_KEY = process.env.MFA_ENCRYPTION_KEY ?? envValue('MFA_ENCRYPTION_KEY');

export const DOMAIN = '@spring-contract.test';
// Unique per run: the account throttler keeps 15-minute counters keyed by e-mail address.
export const RUN = Date.now().toString(36);
export const email = (local) => `${local}-${RUN}${DOMAIN}`;
export const PASSWORD = 'Contract-Pass-1!';

// ---------------------------------------------------------------- HTTP

const COMPARED_HEADERS = [
  'cache-control', 'pragma', 'content-security-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy',
  'origin-agent-cluster', 'referrer-policy', 'strict-transport-security', 'x-content-type-options',
  'x-dns-prefetch-control', 'x-download-options', 'x-frame-options', 'x-permitted-cross-domain-policies',
  'x-xss-protection', 'access-control-allow-origin', 'access-control-allow-credentials', 'vary',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-limit-account', 'x-ratelimit-remaining-account',
];
const TIMED_HEADERS = ['x-ratelimit-reset', 'x-ratelimit-reset-account', 'retry-after'];

/** Replaces values that legitimately differ per call (ids, timestamps, tokens); everything else is compared. */
export function normalize(value, key) {
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v, k);
    return out;
  }
  if (typeof value !== 'string') return value;
  if (key === 'correlationId') return '<correlation-id>';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return '<uuid>';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return '<iso-date>';
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return '<jwt>';
  if (/^[0-9a-f]{64}$/.test(value)) return '<hex64>';
  return value;
}

function normalizeCookie(header) {
  if (!header) return null;
  return header
    .replace(/^([^=]+)=([^;]+)/, '$1=<value>')
    .replace(/Expires=(?!Thu, 01 Jan 1970)[^;]+/, 'Expires=<future>');
}

/**
 * Both APIs key their per-IP rate limits on the socket address, and their counters outlive a run in a process
 * that keeps running. Each run therefore connects from its own loopback address (127.0.0.0/8 is all loopback),
 * so every per-IP window starts empty on both sides whatever ran before, and production limits stay unchanged.
 */
export const CLIENT_ADDRESS = process.env.DIFF_CLIENT_ADDRESS ?? `127.${randomInt(16, 250)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;

function send(url, method, headers, body) {
  return new Promise((resolveResponse, reject) => {
    const target = new URL(url);
    const req = httpRequest(
      {
        host: target.hostname === 'localhost' ? '127.0.0.1' : target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers: body !== undefined ? { ...headers, 'content-length': Buffer.byteLength(body) } : headers,
        localAddress: CLIENT_ADDRESS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = res.headers;
          resolveResponse({
            status: res.statusCode,
            text: Buffer.concat(chunks).toString('utf8'),
            headers: {
              get: (name) => {
                const v = raw[name.toLowerCase()];
                if (v === undefined) return null;
                return Array.isArray(v) ? v.join(', ') : String(v);
              },
            },
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function call(base, method, path, { body, headers = {}, rawBody } = {}) {
  const res = await send(
    base + path,
    method,
    { 'user-agent': UA, ...(body !== undefined || rawBody ? { 'content-type': 'application/json' } : {}), ...headers },
    rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  );
  const text = res.text;
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const h = {};
  for (const name of COMPARED_HEADERS) h[name] = res.headers.get(name);
  const timed = {};
  for (const name of TIMED_HEADERS) timed[name] = res.headers.get(name);
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim() || null;
  const cookie = res.headers.get('set-cookie');
  return {
    status: res.status,
    json,
    headers: h,
    timed,
    contentType,
    cookie: normalizeCookie(cookie),
    rawCookie: cookie,
    correlationId: res.headers.get('x-correlation-id'),
  };
}

export function cookieValue(raw) {
  const m = raw && /^mtrs_refresh=([^;]*)/.exec(raw);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- comparison

export const results = [];
export function record(name, ok, detail) {
  results.push({ name, ok, detail: ok ? undefined : detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + JSON.stringify(detail).slice(0, 1500)}`);
}

export function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diff(a[k], b[k], `${path}.${k}`));
  }
  return [{ path: path || '(root)', nest: a, spring: b }];
}

/**
 * Status, normalized body, compared headers, content type and cookie must all match.
 * Optional bodyDiff replaces exact JSON diff (actuarial domain-aware numeric policies).
 */
export function compare(name, nest, spring, { bodyNormalizer = (b) => b, bodyDiff = diff } = {}) {
  const nestBody = bodyNormalizer(normalize(nest.json));
  const springBody = bodyNormalizer(normalize(spring.json));
  const bodyDifferences = bodyDiff(nestBody, springBody, 'body');
  const differences = [
    ...diff(nest.status, spring.status, 'status'),
    ...bodyDifferences,
    ...diff(nest.headers, spring.headers, 'headers'),
    ...diff(nest.contentType, spring.contentType, 'content-type'),
    ...diff(nest.cookie, spring.cookie, 'set-cookie'),
  ];
  if (bodyDifferences.length === 0 && bodyDiff === diff && JSON.stringify(nestBody) !== JSON.stringify(springBody)) {
    differences.push({ path: 'body (property order)', nest: JSON.stringify(nestBody).slice(0, 400), spring: JSON.stringify(springBody).slice(0, 400) });
  }
  for (const h of TIMED_HEADERS) {
    const a = nest.timed[h];
    const b = spring.timed[h];
    if ((a === null) !== (b === null) || (a !== null && Math.abs(Number(a) - Number(b)) > 2)) {
      differences.push({ path: `headers.${h}`, nest: a, spring: b });
    }
  }
  if (!nest.correlationId !== !spring.correlationId) {
    differences.push({ path: 'headers.x-correlation-id', nest: nest.correlationId, spring: spring.correlationId });
  }
  record(name, differences.length === 0, differences);
  return { nest, spring };
}

export async function both(name, method, path, opts = {}, compareOpts) {
  const nest = await call(NEST, method, path, typeof opts === 'function' ? opts('nest') : opts);
  const spring = await call(SPRING, method, path, typeof opts === 'function' ? opts('spring') : opts);
  return compare(name, nest, spring, compareOpts);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fixtures

// Only this run's accounts plus stale leftovers: suites may run concurrently and share DOMAIN.
export async function cleanup() {
  const stale = new Date(Date.now() - 60 * 60 * 1000);
  const users = await prisma.user.findMany({
    where: { OR: [{ email: { endsWith: `-${RUN}${DOMAIN}` } }, { email: { endsWith: DOMAIN }, createdAt: { lt: stale } }] },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await prisma.auditEvent.deleteMany({ where: { OR: [{ subjectUserId: { in: ids } }, { actorUserId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

export async function createUser(local, overrides = {}) {
  const now = new Date();
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: email(local),
      firstName: 'Contract',
      lastName: local.charAt(0).toUpperCase() + local.slice(1),
      passwordHash: await hashPassword(PASSWORD),
      emailVerified: true,
      emailVerifiedAt: now,
      status: 'ACTIVE',
      ...overrides,
    },
  });
}

export async function resetUser(id) {
  await prisma.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null, mfaLastAcceptedStep: null } });
}

export async function latestAudit(userId, n, eventType) {
  const rows = await prisma.auditEvent.findMany({
    where: { subjectUserId: userId, ...(eventType ? { eventType } : {}) },
    orderBy: { createdAt: 'desc' },
    take: n,
  });
  return rows.map((r) => ({ eventType: r.eventType, outcome: r.outcome, actor: r.actorUserId ? '<uuid>' : null, context: normalize(r.context), correlation: !!r.correlationId }));
}

export async function finish(reportName) {
  await cleanup();
  await prisma.$disconnect();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  const report = resolve(here, `../target/${reportName}.json`);
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, JSON.stringify({ ranAt: new Date().toISOString(), database: dbName, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

export function run(main) {
  main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(2);
  });
}
