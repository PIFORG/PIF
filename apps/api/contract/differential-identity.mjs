// Differential contract test, phase 2: account e-mail workflows, sessions, MFA management, dashboard context and
// administration, NestJS (reference) vs Spring Boot.
//
// Both APIs must run against the same *_test database AND with MAIL_TRANSPORT=preview, each with its own
// MAIL_PREVIEW_DIR (passed below), so every e-mail is captured to disk and never delivered. State-changing scenarios
// use a pair of identical disposable accounts (one per API) and compare responses, captured e-mails, database side
// effects and audit rows. Cross-backend scenarios use tokens/links issued by one API on the other.
//
// Usage (repository root):
//   $env:DATABASE_URL = '<url of the *_test database>'
//   $env:NEST_MAIL_DIR = '<nest MAIL_PREVIEW_DIR>'; $env:SPRING_MAIL_DIR = '<spring MAIL_PREVIEW_DIR>'
//   node apps/api-spring/contract/differential-identity.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  NEST, SPRING, ORIGIN, prisma, PASSWORD, RUN, email, authenticator, hashSecret, encryptMfaSecret, MFA_KEY,
  call, cookieValue, record, compare, sleep, cleanup, createUser, finish, run, normalize, diff,
} from './differential-lib.mjs';

const MAIL_DIR = { nest: process.env.NEST_MAIL_DIR, spring: process.env.SPRING_MAIL_DIR };
if (!MAIL_DIR.nest || !MAIL_DIR.spring || !existsSync(MAIL_DIR.nest) || !existsSync(MAIL_DIR.spring)) {
  throw new Error('NEST_MAIL_DIR and SPRING_MAIL_DIR must point at the preview folders of the running APIs');
}
const BASE = { nest: NEST, spring: SPRING };
const SIDES = ['nest', 'spring'];
const json = { Origin: ORIGIN };

// ---------------------------------------------------------------- rate-limit budget

// Per-IP limits per route (NestJS ThrottlerGuard keys on class + handler); one budget per API.
const ROUTE_LIMITS = [
  [/^POST \/api\/auth\/login$/, 10],
  [/^POST \/api\/auth\/register$/, 10],
  [/^POST \/api\/auth\/(resend-verification|forgot-password|mfa\/verify-login)$/, 5],
];
const windows = new Map();
async function limited(side, method, path, opts) {
  const route = `${method} ${path.split('?')[0].replace(/\/(sessions|users)\/[^/]+/g, '/$1/:id')}`;
  const limit = (ROUTE_LIMITS.find(([re]) => re.test(route))?.[1] ?? 20) - 1;
  const key = `${side} ${route}`;
  const stamps = (windows.get(key) ?? []).filter((t) => Date.now() - t < 61_000);
  if (stamps.length >= limit) {
    const wait = 61_000 - (Date.now() - stamps[0]) + 200;
    console.log(`… waiting ${Math.ceil(wait / 1000)} s for the ${route} rate limit on ${side}`);
    await sleep(wait);
    stamps.splice(0, stamps.length, ...stamps.filter((t) => Date.now() - t < 61_000));
  }
  stamps.push(Date.now());
  windows.set(key, stamps);
  return call(BASE[side], method, path, opts);
}

/** Same request on both APIs (same route budget rules); opts may be a function of the side. */
async function both(name, method, path, opts = {}, compareOpts) {
  const nest = await limited('nest', method, path, typeof opts === 'function' ? opts('nest') : opts);
  const spring = await limited('spring', method, path, typeof opts === 'function' ? opts('spring') : opts);
  return compare(name, nest, spring, compareOpts);
}

// ---------------------------------------------------------------- paired accounts

const pairs = [];
async function pair(base, overrides = {}) {
  const lastName = base.charAt(0).toUpperCase() + base.slice(1);
  const nest = await createUser(`${base}-n`, { lastName, ...overrides });
  const spring = await createUser(`${base}-s`, { lastName, ...overrides });
  const p = { nest, spring, address: { nest: nest.email, spring: spring.email } };
  pairs.push(p);
  return p;
}

function selfNormalized(res, address) {
  if (res.json == null || typeof res.json !== 'object') return res;
  const masked = JSON.stringify(res.json).split(address).join('<self>').split(encodeURIComponent(address)).join('<self>');
  return { ...res, json: JSON.parse(masked) };
}

/** Runs fn(side) for each API on its own account of the pair and compares with the pair's address masked. */
async function paired(name, p, fn, compareOpts) {
  const nest = await fn('nest');
  const spring = await fn('spring');
  compare(name, selfNormalized(nest, p.address.nest), selfNormalized(spring, p.address.spring), compareOpts);
  return { nest, spring };
}

const bearer = (token) => ({ Authorization: 'Bearer ' + token });

async function login(side, address, password = PASSWORD) {
  const res = await limited(side, 'POST', '/api/auth/login', { headers: json, body: { email: address, password } });
  if (res.status !== 200 || !res.json?.accessToken) throw new Error(`login failed on ${side}: ${res.status} ${JSON.stringify(res.json)}`);
  return { token: res.json.accessToken, cookie: cookieValue(res.rawCookie), sessionId: null };
}

async function loginPair(p) {
  return { nest: await login('nest', p.address.nest), spring: await login('spring', p.address.spring) };
}

// ---------------------------------------------------------------- captured mail

function captured(side, address, since) {
  const dir = MAIL_DIR[side];
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const meta = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (meta.to?.toLowerCase() !== address.toLowerCase() || Date.parse(meta.createdAt) < since) continue;
    const id = file.slice(0, -'.json'.length);
    out.push({ ...meta, text: readFileSync(join(dir, id + '.txt'), 'utf8'), html: readFileSync(join(dir, id + '.html'), 'utf8') });
  }
  return out;
}

function tokenOf(message) {
  const m = /[?&]token=([^\s"&<]+)/.exec(message.text);
  return m ? decodeURIComponent(m[1]) : null;
}

const mailNormal = (m, address) => ({
  template: m.template,
  subject: m.subject,
  text: m.text.split(address).join('<self>').replace(/token=[^\s"&<]+/g, 'token=<token>'),
  html: m.html.split(address).join('<self>').replace(/token=[^\s"&<]+/g, 'token=<token>'),
});

/**
 * Waits briefly (delivery is asynchronous on both APIs) and compares the e-mails each account received. With
 * `crossed`, the nest account's request was handled by Spring and vice versa, so each API's folder is swapped.
 */
async function compareMail(name, p, since, expectedTemplates, { crossed = false } = {}) {
  const dirOf = { nest: crossed ? 'spring' : 'nest', spring: crossed ? 'nest' : 'spring' };
  const read = () => [captured(dirOf.nest, p.address.nest, since), captured(dirOf.spring, p.address.spring, since)];
  let [n, s] = read();
  for (let i = 0; i < 20 && (n.length < expectedTemplates.length || s.length < expectedTemplates.length); i++) {
    await sleep(250);
    [n, s] = read();
  }
  await sleep(300);
  [n, s] = read();
  const nn = n.map((m) => mailNormal(m, p.address.nest));
  const sn = s.map((m) => mailNormal(m, p.address.spring));
  const differences = diff(nn, sn, 'mail');
  const templates = n.map((m) => m.template);
  if (JSON.stringify(templates) !== JSON.stringify(expectedTemplates)) {
    differences.push({ path: 'mail.templates', expected: expectedTemplates, nest: templates, spring: s.map((m) => m.template) });
  }
  record(`mail: ${name}`, differences.length === 0, differences);
  return { nest: n, spring: s };
}

// ---------------------------------------------------------------- database helpers

const USER_FIELDS = ['status', 'role', 'emailVerified', 'mfaEnabled', 'failedLoginCount', 'securityVersion'];
async function compareUsers(name, p, extra = []) {
  const rows = await Promise.all(SIDES.map((side) => prisma.user.findUnique({ where: { id: p[side].id } })));
  const pick = (u) => Object.fromEntries([...USER_FIELDS, ...extra].map((f) => [f, u?.[f] instanceof Date ? '<date>' : (u?.[f] ?? null)]));
  const differences = diff(pick(rows[0]), pick(rows[1]), 'user');
  record(`db: ${name}`, differences.length === 0, differences);
  return rows;
}

async function auditFor(userId, since) {
  const rows = await prisma.auditEvent.findMany({
    where: { OR: [{ subjectUserId: userId }, { actorUserId: userId }], createdAt: { gte: new Date(since) } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    eventType: r.eventType,
    outcome: r.outcome,
    actor: r.actorUserId === userId ? '<self>' : r.actorUserId ? '<other>' : null,
    subject: r.subjectUserId === userId ? '<self>' : r.subjectUserId ? '<other>' : null,
    context: normalize(r.context),
    correlation: !!r.correlationId,
  }));
}

async function compareAudit(name, p, since) {
  const n = await auditFor(p.nest.id, since);
  const s = await auditFor(p.spring.id, since);
  const differences = diff(n, s, 'audit');
  if (n.length === 0) differences.push({ path: 'audit', problem: 'no audit rows were written' });
  record(`audit: ${name}`, differences.length === 0, differences);
}

async function sessionStates(userId) {
  const rows = await prisma.authSession.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => (r.revokedAt ? `revoked:${r.revokedReason}` : 'active'));
}

async function compareSessions(name, p) {
  const n = await sessionStates(p.nest.id);
  const s = await sessionStates(p.spring.id);
  record(`db: ${name}`, JSON.stringify(n) === JSON.stringify(s), { nest: n, spring: s });
  return { nest: n, spring: s };
}

// Normalizers for values that are random by design.
const mfaSetupBody = (b) => b && typeof b === 'object' && typeof b.secret === 'string'
  ? { ...b, secret: /^[A-Z2-7]{16}$/.test(b.secret) ? '<base32-16>' : b.secret, otpauth: b.otpauth?.split(b.secret).join('<secret>') }
  : b;
const recoveryBody = (b) => b && Array.isArray(b.recoveryCodes)
  ? { ...b, recoveryCodes: b.recoveryCodes.map((c) => (/^[0-9A-F]{10}$/.test(c) ? '<code>' : c)) }
  : b;

// ---------------------------------------------------------------- scenarios

async function main() {
  await cleanup();
  const t0 = Date.now();

  // ---- 1. Validation, unauthenticated access and CSRF on every new route (no state).
  const noAuth = [
    ['GET', '/api/auth/sessions'], ['DELETE', '/api/auth/sessions/' + randomUUID()], ['POST', '/api/auth/logout-all'],
    ['DELETE', '/api/auth/sessions'], ['POST', '/api/auth/mfa/setup'], ['POST', '/api/auth/mfa/enable'],
    ['POST', '/api/auth/mfa/disable'], ['POST', '/api/auth/mfa/recovery-codes/regenerate'], ['GET', '/api/auth/mfa/status'],
    ['POST', '/api/auth/change-password'], ['POST', '/api/auth/change-email/request'], ['POST', '/api/auth/me/deactivate'],
    ['DELETE', '/api/auth/me'], ['GET', '/api/users/me/dashboard-context'], ['GET', '/api/admin/overview'],
    ['GET', '/api/admin/users'], ['GET', '/api/admin/users/' + randomUUID()], ['PATCH', `/api/admin/users/${randomUUID()}/status`],
    ['PATCH', `/api/admin/users/${randomUUID()}/role`], ['GET', '/api/admin/audit-events'],
  ];
  for (const [method, path] of noAuth) {
    await both(`no token: ${method} ${path.replace(/[0-9a-f-]{36}/, ':id')}`, method, path, { headers: json });
  }
  await both('register: validation errors', 'POST', '/api/auth/register', { headers: json, body: { firstName: ' ', email: `nope-${RUN}`, password: 'short', extra: 1 } });
  await both('register: password confirmation mismatch', 'POST', '/api/auth/register', { headers: json, body: { firstName: 'A', lastName: 'B', email: email('mismatch'), password: 'Valid-Pass-123!', passwordConfirmation: 'Valid-Pass-124!' } });
  await both('register: weak password (policy)', 'POST', '/api/auth/register', { headers: json, body: { firstName: 'A', lastName: 'B', email: email('weak'), password: 'alllowercase' } });
  await both('register: CSRF foreign origin', 'POST', '/api/auth/register', { headers: { Origin: 'http://evil.example' }, body: { firstName: 'A', lastName: 'B', email: email('csrf'), password: 'Valid-Pass-123!' } });
  await both('verify-email: short token', 'POST', '/api/auth/verify-email', { headers: json, body: { token: 'abc' } });
  await both('verify-email: unknown token', 'POST', '/api/auth/verify-email', { headers: json, body: { token: 'a'.repeat(64) } });
  await both('resend-verification: invalid email', 'POST', '/api/auth/resend-verification', { headers: json, body: { email: `x${RUN}` } });
  await both('resend-verification: unknown address', 'POST', '/api/auth/resend-verification', { headers: json, body: { email: email('ghost1') } });
  await both('forgot-password: invalid email', 'POST', '/api/auth/forgot-password', { headers: json, body: { email: 42 } });
  await both('forgot-password: unknown address', 'POST', '/api/auth/forgot-password', { headers: json, body: { email: email('ghost2') } });
  await both('reset-password: validation', 'POST', '/api/auth/reset-password', { headers: json, body: { token: 'x', password: 'a' } });
  await both('reset-password: unknown token', 'POST', '/api/auth/reset-password', { headers: json, body: { token: 'b'.repeat(64), password: 'Valid-Pass-123!', passwordConfirmation: 'Valid-Pass-123!' } });
  await both('reset-password: confirmation mismatch', 'POST', '/api/auth/reset-password', { headers: json, body: { token: 'b'.repeat(64), password: 'Valid-Pass-123!', passwordConfirmation: 'Other-Pass-123!' } });
  await both('change-email/confirm: short token', 'POST', '/api/auth/change-email/confirm', { headers: json, body: { token: 'short' } });
  await both('change-email/confirm: unknown token', 'POST', '/api/auth/change-email/confirm', { headers: json, body: { token: 'c'.repeat(64) } });

  // ---- 2. Registration → verification (paired fresh addresses; never real recipients).
  {
    const since = Date.now();
    const addr = { nest: email('reg-n'), spring: email('reg-s') };
    const body = (side) => ({ firstName: ' Regina ', lastName: 'Test', email: addr[side].toUpperCase(), password: 'Register-Pass-1!', passwordConfirmation: 'Register-Pass-1!' });
    const nest = await limited('nest', 'POST', '/api/auth/register', { headers: json, body: body('nest') });
    const spring = await limited('spring', 'POST', '/api/auth/register', { headers: json, body: body('spring') });
    compare('register: new account → 201 generic message', nest, spring);
    const users = { nest: await prisma.user.findUnique({ where: { email: addr.nest } }), spring: await prisma.user.findUnique({ where: { email: addr.spring } }) };
    const p = { nest: users.nest, spring: users.spring, address: addr };
    pairs.push(p);
    await compareUsers('register creates a pending account', p, ['firstName', 'lastName', 'emailVerifiedAt']);
    const prefs = await Promise.all(SIDES.map((side) => prisma.userPreferences.count({ where: { userId: p[side].id } })));
    record('db: register creates default preferences', prefs[0] === 1 && prefs[1] === 1, prefs);
    const mails = await compareMail('register sends one verification link', p, since, ['verify-email']);
    const tokens = { nest: tokenOf(mails.nest[0]), spring: tokenOf(mails.spring[0]) };
    record('mail: verification token is 64 hex and stored only as a hash', SIDES.every((s) => /^[0-9a-f]{64}$/.test(tokens[s] ?? '')), tokens.nest?.length);
    const stored = await prisma.authToken.findMany({ where: { userId: { in: [p.nest.id, p.spring.id] }, type: 'EMAIL_VERIFICATION' } });
    record('db: raw verification tokens never stored', stored.length === 2 && stored.every((t) => t.tokenHash !== tokens.nest && t.tokenHash !== tokens.spring), stored.length);

    const again = Date.now();
    await paired('register: same pending address again → same answer', p, (side) => limited(side, 'POST', '/api/auth/register', { headers: json, body: body(side) }));
    await compareMail('register again inside the cooldown sends nothing', p, again, []);
    await paired('login before verification', p, (side) => limited(side, 'POST', '/api/auth/login', { headers: json, body: { email: addr[side], password: 'Register-Pass-1!' } }));

    // Cross-backend: each API verifies the link issued by the other.
    const verifyAt = Date.now();
    const vN = await limited('nest', 'POST', '/api/auth/verify-email', { headers: json, body: { token: tokens.spring } });
    const vS = await limited('spring', 'POST', '/api/auth/verify-email', { headers: json, body: { token: tokens.nest } });
    compare('verify-email: link issued by the other API', vN, vS);
    await compareUsers('verification activates the account', p, ['emailVerifiedAt']);
    await compareMail('verification sends a welcome message', p, verifyAt, ['welcome'], { crossed: true });
    await both('verify-email: link reuse → TOKEN_INVALID', 'POST', '/api/auth/verify-email', (side) => ({ headers: json, body: { token: tokens[side] } }));
    await compareAudit('registration and verification', p, since);

    const existsAt = Date.now();
    await paired('register: verified address → same generic answer', p, (side) => limited(side, 'POST', '/api/auth/register', { headers: json, body: body(side) }));
    await compareMail('register on a verified address sends an account-exists notice (no link)', p, existsAt, ['account-exists']);
  }

  // ---- 3. Resend verification and password recovery.
  {
    const pend = await pair('pend', { emailVerified: false, emailVerifiedAt: null, status: 'PENDING_VERIFICATION' });
    let since = Date.now();
    await paired('resend-verification: pending account', pend, (side) => limited(side, 'POST', '/api/auth/resend-verification', { headers: json, body: { email: pend.address[side] } }));
    await compareMail('resend sends a fresh verification link', pend, since, ['verify-email']);
    since = Date.now();
    await paired('resend-verification: inside cooldown', pend, (side) => limited(side, 'POST', '/api/auth/resend-verification', { headers: json, body: { email: pend.address[side] } }));
    await compareMail('resend inside the cooldown sends nothing', pend, since, []);

    const rec = await pair('rec');
    await loginPair(rec);
    since = Date.now();
    await paired('forgot-password: active account', rec, (side) => limited(side, 'POST', '/api/auth/forgot-password', { headers: json, body: { email: ' ' + rec.address[side].toUpperCase() } }));
    const resetMail = await compareMail('forgot-password sends one reset link', rec, since, ['reset-password']);
    const resetTokens = { nest: tokenOf(resetMail.nest[0]), spring: tokenOf(resetMail.spring[0]) };
    await paired('forgot-password: inside cooldown', rec, (side) => limited(side, 'POST', '/api/auth/forgot-password', { headers: json, body: { email: rec.address[side] } }));
    await both('reset-password: weak password with a valid link', 'POST', '/api/auth/reset-password', (side) => ({ headers: json, body: { token: resetTokens[side], password: 'weakpassword', passwordConfirmation: 'weakpassword' } }));
    const resetAt = Date.now();
    const rN = await limited('nest', 'POST', '/api/auth/reset-password', { headers: json, body: { token: resetTokens.spring, password: 'Reset-Pass-2@x', passwordConfirmation: 'Reset-Pass-2@x' } });
    const rS = await limited('spring', 'POST', '/api/auth/reset-password', { headers: json, body: { token: resetTokens.nest, password: 'Reset-Pass-2@x', passwordConfirmation: 'Reset-Pass-2@x' } });
    compare('reset-password: link issued by the other API', rN, rS);
    await compareUsers('reset changes the password and bumps the security version', rec);
    await compareSessions('reset revokes every session', rec);
    await compareMail('reset sends a password-changed notice', rec, resetAt, ['password-changed'], { crossed: true });
    await both('reset-password: link reuse → TOKEN_INVALID', 'POST', '/api/auth/reset-password', (side) => ({ headers: json, body: { token: resetTokens[side], password: 'Reset-Pass-3@x', passwordConfirmation: 'Reset-Pass-3@x' } }));
    await compareAudit('forgot and reset password', rec, since);
    const loginNew = await Promise.all(SIDES.map((side) => login(side, rec.address[side], 'Reset-Pass-2@x').then(() => true, () => false)));
    record('reset: new password signs in on both APIs', loginNew.every(Boolean), loginNew);
  }

  // ---- 4. Sessions, dashboard context and change password.
  {
    const ses = await pair('sess');
    const first = await loginPair(ses);
    const second = await loginPair(ses);
    const third = await loginPair(ses);
    await paired('dashboard-context: investor', ses, (side) => limited(side, 'GET', '/api/users/me/dashboard-context', { headers: bearer(first[side].token) }));
    await paired('sessions: list (current flag, order, fields)', ses, (side) => limited(side, 'GET', '/api/auth/sessions', { headers: bearer(first[side].token) }));
    await paired('sessions: revoke with an invalid id → 400', ses, (side) => limited(side, 'DELETE', '/api/auth/sessions/not-a-uuid', { headers: bearer(first[side].token) }));
    await paired('sessions: revoke an unknown id → 404', ses, (side) => limited(side, 'DELETE', '/api/auth/sessions/' + randomUUID(), { headers: bearer(first[side].token) }));
    const other = await pair('stranger');
    const strangerLogin = await loginPair(other);
    const sessionIds = {};
    for (const side of SIDES) {
      const list = await limited(side, 'GET', '/api/auth/sessions', { headers: bearer(first[side].token) });
      sessionIds[side] = list.json.filter((s) => !s.current).map((s) => s.id);
    }
    await paired("sessions: another user's session → 404 (no ownership leak)", ses, (side) => limited(side, 'DELETE', '/api/auth/sessions/' + sessionIds[side][0], { headers: bearer(strangerLogin[side].token) }));
    const revokeAt = Date.now();
    await paired('sessions: revoke one of your sessions', ses, (side) => limited(side, 'DELETE', '/api/auth/sessions/' + sessionIds[side][0], { headers: bearer(first[side].token) }));
    await compareSessions('one session revoked with USER_REVOKE', ses);
    for (const side of SIDES) {
      const n = await prisma.authSession.count({ where: { userId: ses[side].id, revokedReason: 'USER_REVOKE' } });
      record(`db: ${side} revoked exactly one session`, n === 1, n);
    }
    await paired('sessions: revoke others with a wrong password → 403', ses, (side) => limited(side, 'DELETE', '/api/auth/sessions', { headers: bearer(first[side].token), body: { password: 'Wrong-Pass-9!' } }));
    await paired('sessions: revoke others', ses, (side) => limited(side, 'DELETE', '/api/auth/sessions', { headers: bearer(first[side].token), body: { password: PASSWORD } }));
    await compareSessions('only the current session remains', ses);
    await paired('me: token of a revoked session → SESSION_REVOKED', ses, (side) => limited(side, 'GET', '/api/auth/me', { headers: bearer(third[side].token) }));
    await compareMail('revoke others sends a sessions-revoked notice', ses, revokeAt, ['sessions-revoked']);
    await compareAudit('session revocation', ses, revokeAt);

    await paired('change-password: validation', ses, (side) => limited(side, 'POST', '/api/auth/change-password', { headers: { ...json, ...bearer(first[side].token) }, body: { currentPassword: '', newPassword: 'x' } }));
    await paired('change-password: same as current', ses, (side) => limited(side, 'POST', '/api/auth/change-password', { headers: { ...json, ...bearer(first[side].token) }, body: { currentPassword: PASSWORD, newPassword: PASSWORD, newPasswordConfirmation: PASSWORD } }));
    await paired('change-password: wrong current password → 403', ses, (side) => limited(side, 'POST', '/api/auth/change-password', { headers: { ...json, ...bearer(first[side].token) }, body: { currentPassword: 'Wrong-Pass-9!', newPassword: 'Changed-Pass-5%', newPasswordConfirmation: 'Changed-Pass-5%' } }));
    const changeAt = Date.now();
    const changed = await paired('change-password: success (new session cookie, no-store)', ses, (side) => limited(side, 'POST', '/api/auth/change-password', { headers: { ...json, ...bearer(first[side].token) }, body: { currentPassword: PASSWORD, newPassword: 'Changed-Pass-5%', newPasswordConfirmation: 'Changed-Pass-5%' } }));
    await compareSessions('change-password keeps only the new session', ses);
    await compareMail('change-password sends a notice', ses, changeAt, ['password-changed']);
    await paired('me: old token after change-password → rejected', ses, (side) => limited(side, 'GET', '/api/auth/me', { headers: bearer(first[side].token) }));
    // Cross-backend: the new refresh cookie from one API rotates on the other.
    const rotN = await limited('nest', 'POST', '/api/auth/refresh', { headers: { ...json, Cookie: 'mtrs_refresh=' + cookieValue(changed.spring.rawCookie) } });
    const rotS = await limited('spring', 'POST', '/api/auth/refresh', { headers: { ...json, Cookie: 'mtrs_refresh=' + cookieValue(changed.nest.rawCookie) } });
    compare('refresh: cookie issued by change-password on the other API', selfNormalized(rotN, ses.address.spring), selfNormalized(rotS, ses.address.nest));
    const logoutAt = Date.now();
    await paired('logout-all (clears the cookie)', ses, (side) => limited(side, 'POST', '/api/auth/logout-all', { headers: { ...json, ...bearer((side === 'nest' ? rotS : rotN).json.accessToken) } }));
    await compareSessions('logout-all revokes every session', ses);
    const liveRefresh = await Promise.all(SIDES.map((side) => prisma.authToken.count({ where: { userId: ses[side].id, type: 'REFRESH_TOKEN', revokedAt: null, usedAt: null } })));
    record('db: logout-all leaves no usable refresh token', liveRefresh.every((n) => n === 0), liveRefresh);
    await compareMail('logout-all sends a sessions-revoked notice', ses, logoutAt, ['sessions-revoked']);
    await compareAudit('logout-all', ses, logoutAt);
  }

  // ---- 5. E-mail change.
  {
    const mv = await pair('mover');
    const auth = await loginPair(mv);
    const target = { nest: email('moved-n'), spring: email('moved-s') };
    const taken = await pair('taken');
    await paired('change-email: same address → 400', mv, (side) => limited(side, 'POST', '/api/auth/change-email/request', { headers: { ...json, ...bearer(auth[side].token) }, body: { password: PASSWORD, newEmail: mv.address[side] } }));
    await paired('change-email: wrong password → 403', mv, (side) => limited(side, 'POST', '/api/auth/change-email/request', { headers: { ...json, ...bearer(auth[side].token) }, body: { password: 'Wrong-Pass-9!', newEmail: target[side] } }));
    let since = Date.now();
    await paired('change-email: address owned by someone else → same answer', mv, (side) => limited(side, 'POST', '/api/auth/change-email/request', { headers: { ...json, ...bearer(auth[side].token) }, body: { password: PASSWORD, newEmail: taken.address[side] } }));
    await compareMail('owned target: only the current address is told', mv, since, ['email-change-requested']);
    const takenMail = await Promise.all(SIDES.map((side) => captured(side, taken.address[side], since).length));
    record('mail: no confirmation link sent to an address owned by another account', takenMail.every((n) => n === 0), takenMail);
    await paired('change-email: second request inside the cooldown → 429', mv, (side) => limited(side, 'POST', '/api/auth/change-email/request', { headers: { ...json, ...bearer(auth[side].token) }, body: { password: PASSWORD, newEmail: target[side] } }));
    console.log('… waiting 61 s for the e-mail change cooldown');
    await sleep(61_000);
    since = Date.now();
    await paired('change-email: request', mv, (side) => limited(side, 'POST', '/api/auth/change-email/request', { headers: { ...json, ...bearer(auth[side].token) }, body: { password: PASSWORD, newEmail: target[side] } }));
    await compareMail('request notifies the current address', mv, since, ['email-change-requested']);
    const targetPair = { address: target };
    const confirmMail = await compareMail('request sends the confirmation link to the new address', targetPair, since, ['email-change-confirm']);
    const confirmTokens = { nest: tokenOf(confirmMail.nest[0]), spring: tokenOf(confirmMail.spring[0]) };
    const confirmAt = Date.now();
    const cN = await limited('nest', 'POST', '/api/auth/change-email/confirm', { headers: json, body: { token: confirmTokens.spring } });
    const cS = await limited('spring', 'POST', '/api/auth/change-email/confirm', { headers: json, body: { token: confirmTokens.nest } });
    compare('change-email/confirm: link issued by the other API', cN, cS);
    const moved = await Promise.all(SIDES.map((side) => prisma.user.findUnique({ where: { id: mv[side].id } })));
    record('db: ownership moved to the new address on both', moved[0].email === target.nest && moved[1].email === target.spring, moved.map((u) => u.email === target.nest || u.email === target.spring));
    await compareSessions('confirm revokes every session', mv);
    await compareMail('confirm notifies the old address', mv, confirmAt, ['email-changed-old'], { crossed: true });
    await compareMail('confirm welcomes the new address', targetPair, confirmAt, ['email-changed-new'], { crossed: true });
    await both('change-email/confirm: link reuse', 'POST', '/api/auth/change-email/confirm', (side) => ({ headers: json, body: { token: confirmTokens[side] } }));
    mv.address = target;
    pairs.push(mv);
  }

  // ---- 6. Two-step verification management.
  {
    const m = await pair('mfa2');
    const auth = await loginPair(m);
    const other = await loginPair(m);
    const h = (side) => ({ ...json, ...bearer(auth[side].token) });
    await paired('mfa/status: disabled', m, (side) => limited(side, 'GET', '/api/auth/mfa/status', { headers: h(side) }));
    await paired('mfa/setup: wrong password → 403', m, (side) => limited(side, 'POST', '/api/auth/mfa/setup', { headers: h(side), body: { password: 'Wrong-Pass-9!' } }));
    await paired('mfa/enable: no setup in progress', m, (side) => limited(side, 'POST', '/api/auth/mfa/enable', { headers: h(side), body: { totpCode: '123456' } }));
    await paired('mfa/disable: not enabled', m, (side) => limited(side, 'POST', '/api/auth/mfa/disable', { headers: h(side), body: { password: PASSWORD, totpCode: '123456' } }));
    const setup = await paired('mfa/setup: secret + otpauth URI', m, (side) => limited(side, 'POST', '/api/auth/mfa/setup', { headers: h(side), body: { password: PASSWORD } }), { bodyNormalizer: mfaSetupBody });
    const secrets = { nest: setup.nest.json.secret, spring: setup.spring.json.secret };
    const pending = await Promise.all(SIDES.map((side) => prisma.user.findUnique({ where: { id: m[side].id } })));
    record('db: pending secret stored only encrypted (v1 envelope)', pending.every((u, i) => u.mfaPendingSecretEncrypted?.startsWith('v1:') && !u.mfaPendingSecretEncrypted.includes(secrets[SIDES[i]]) && u.mfaSecretKeyVersion === 1), pending.map((u) => u.mfaSecretKeyVersion));
    await paired('mfa/enable: invalid code', m, (side) => limited(side, 'POST', '/api/auth/mfa/enable', { headers: h(side), body: { totpCode: authenticator.generate(secrets[side]) === '000000' ? '111111' : '000000' } }));
    let since = Date.now();
    const enabled = await paired('mfa/enable: recovery codes returned once', m, (side) => limited(side, 'POST', '/api/auth/mfa/enable', { headers: h(side), body: { totpCode: authenticator.generate(secrets[side]) } }), { bodyNormalizer: recoveryBody });
    await compareUsers('MFA enabled', m, ['mfaVerifiedAt', 'mfaSecretKeyVersion']);
    const hashes = await prisma.mfaRecoveryCode.findMany({ where: { userId: m.nest.id } });
    record('db: recovery codes stored as Argon2id hashes only', hashes.length === 10 && hashes.every((r) => r.codeHash.startsWith('$argon2id$') && !enabled.nest.json.recoveryCodes.includes(r.codeHash)), hashes.length);
    await compareMail('enable sends an MFA-enabled notice', m, since, ['mfa-enabled']);
    await paired('mfa/status: enabled', m, (side) => limited(side, 'GET', '/api/auth/mfa/status', { headers: h(side) }));
    // Cross-backend: a secret enrolled through one API signs in through the other.
    const ch = { nest: await limited('nest', 'POST', '/api/auth/login', { headers: json, body: { email: m.address.spring, password: PASSWORD } }), spring: await limited('spring', 'POST', '/api/auth/login', { headers: json, body: { email: m.address.nest, password: PASSWORD } }) };
    const vN = await limited('nest', 'POST', '/api/auth/mfa/verify-login', { headers: json, body: { mfaChallengeToken: ch.nest.json.mfaChallengeToken, recoveryCode: enabled.spring.json.recoveryCodes[0] } });
    const vS = await limited('spring', 'POST', '/api/auth/mfa/verify-login', { headers: json, body: { mfaChallengeToken: ch.spring.json.mfaChallengeToken, recoveryCode: enabled.nest.json.recoveryCodes[0] } });
    compare('mfa: recovery code issued by the other API signs in', selfNormalized(vN, m.address.spring), selfNormalized(vS, m.address.nest));
    await paired('mfa/regenerate: missing code → MFA_REQUIRED', m, (side) => limited(side, 'POST', '/api/auth/mfa/recovery-codes/regenerate', { headers: h(side), body: { password: PASSWORD } }));
    since = Date.now();
    await sleep(31_000 - (Date.now() % 30_000));
    const regen = await paired('mfa/regenerate: new codes', m, (side) => limited(side, 'POST', '/api/auth/mfa/recovery-codes/regenerate', { headers: h(side), body: { password: PASSWORD, totpCode: authenticator.generate(secrets[side]) } }), { bodyNormalizer: recoveryBody });
    await compareMail('regenerate sends a notice (codes never e-mailed)', m, since, ['mfa-recovery-codes-regenerated']);
    const mailed = captured('nest', m.address.nest, since).concat(captured('spring', m.address.spring, since));
    record('mail: recovery codes never appear in e-mail', mailed.every((x) => !regen.nest.json.recoveryCodes.concat(regen.spring.json.recoveryCodes).some((c) => x.text.includes(c) || x.html.includes(c))), mailed.length);
    since = Date.now();
    await paired('mfa/disable: with a recovery code', m, (side) => limited(side, 'POST', '/api/auth/mfa/disable', { headers: h(side), body: { password: PASSWORD, recoveryCode: regen[side].json.recoveryCodes[1] } }));
    await compareUsers('MFA disabled and secrets cleared', m, ['mfaSecretEncrypted', 'mfaPendingSecretEncrypted', 'mfaVerifiedAt']);
    await compareSessions('disable keeps this session and revokes the others', m);
    await paired('me: other device after MFA disable', m, (side) => limited(side, 'GET', '/api/auth/me', { headers: bearer(other[side].token) }));
    await compareMail('disable sends an MFA-disabled notice', m, since, ['mfa-disabled']);
    await compareAudit('MFA management', m, since - 120_000);
  }

  // ---- 7. Lockout notice (threshold crossing sends exactly one e-mail, no account-existence leak).
  {
    const lk = await pair('locker');
    const max = 8;
    const since = Date.now();
    const lastWrong = {};
    for (let i = 0; i < max + 1; i++) {
      for (const side of SIDES) lastWrong[side] = await limited(side, 'POST', '/api/auth/login', { headers: json, body: { email: lk.address[side], password: 'Wrong-Pass-9!' } });
    }
    compare('login: response after the lock is identical to a wrong password', selfNormalized(lastWrong.nest, lk.address.nest), selfNormalized(lastWrong.spring, lk.address.spring));
    const unknown = await both('login: unknown address gives the same answer', 'POST', '/api/auth/login', { headers: json, body: { email: email('nobody-lock'), password: 'Wrong-Pass-9!' } });
    record('lockout: locked and unknown accounts are indistinguishable', unknown.nest.status === lastWrong.nest.status && JSON.stringify(normalize(unknown.nest.json)) === JSON.stringify(normalize(lastWrong.nest.json)), { unknown: unknown.nest.json, locked: lastWrong.nest.json });
    await compareUsers('account locked after the threshold', lk, ['lockedUntil']);
    await compareMail('exactly one lockout notice', lk, since, ['account-locked']);
    await compareAudit('lockout', lk, since);
  }

  // ---- 8. Deactivation and deletion.
  {
    const dz = await pair('closer');
    const auth = await loginPair(dz);
    await paired('deactivate: wrong confirmation word', dz, (side) => limited(side, 'POST', '/api/auth/me/deactivate', { headers: { ...json, ...bearer(auth[side].token) }, body: { password: PASSWORD, confirmation: 'deactivate' } }));
    let since = Date.now();
    await paired('deactivate: success clears the cookie', dz, (side) => limited(side, 'POST', '/api/auth/me/deactivate', { headers: { ...json, ...bearer(auth[side].token) }, body: { password: PASSWORD, confirmation: 'DEACTIVATE' } }));
    await compareUsers('account deactivated', dz);
    await compareSessions('deactivation revokes every session', dz);
    await compareMail('deactivation notice', dz, since, ['account-deactivated']);
    await both('login: deactivated account', 'POST', '/api/auth/login', (side) => ({ headers: json, body: { email: dz.address[side], password: PASSWORD } }), { bodyNormalizer: (b) => b });

    const del = await pair('deleter');
    const delAuth = await loginPair(del);
    since = Date.now();
    await paired('delete account: success', del, (side) => limited(side, 'DELETE', '/api/auth/me', { headers: { ...json, ...bearer(delAuth[side].token) }, body: { password: PASSWORD, confirmation: 'DELETE' } }));
    await compareUsers('account pending deletion', del, ['deletedAt']);
    await compareMail('deletion notice', del, since, ['account-deletion-scheduled']);
    await compareAudit('deactivation and deletion', del, since);
  }

  // ---- 9. Administration (server-side role enforcement on both APIs).
  {
    const admins = await pair('admin', { role: 'ADMIN' });
    const members = await pair('member');
    const adminAuth = await loginPair(admins);
    const memberAuth = await loginPair(members);
    const ah = (side) => ({ ...json, ...bearer(adminAuth[side].token) });
    const mh = (side) => ({ ...json, ...bearer(memberAuth[side].token) });
    for (const path of ['/api/admin/overview', '/api/admin/users', '/api/admin/audit-events', `/api/admin/users/${members.nest.id}`]) {
      await paired(`admin: investor → 403 on ${path.replace(/[0-9a-f-]{36}/, ':id')}`, members, (side) => limited(side, 'GET', path, { headers: mh(side) }));
    }
    await paired('admin: investor PATCH status → 403 (no state change)', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/status`, { headers: mh(side), body: { status: 'SUSPENDED', reason: 'escalation attempt' } }));
    await compareUsers('investor cannot change any status', members);
    await paired('dashboard-context: administrator', admins, (side) => limited(side, 'GET', '/api/users/me/dashboard-context', { headers: ah(side) }));
    await both('admin: overview', 'GET', '/api/admin/overview', (side) => ({ headers: ah(side) }));
    const q = `?q=${RUN}&pageSize=5&page=1`;
    for (const query of [q, `?q=${RUN}&role=ADMIN`, `?q=${RUN}&status=PENDING_VERIFICATION&emailVerified=false`, '?q=%25&pageSize=1', '?q=_&pageSize=1', `?q=${RUN.toUpperCase()}&page=2&pageSize=3`,
      '?page=0', '?pageSize=101', '?page=abc', '?page=', '?page=1.5', '?page=1e1&pageSize=0x10', '?status=FOO', '?role=root', '?emailVerified=yes', '?unknown=1',
      '?q=' + 'x'.repeat(121), '?q=a&q=b', '?page=1&page=2']) {
      await both(`admin: users ${decodeURIComponent(query).slice(0, 60)}`, 'GET', '/api/admin/users' + query, (side) => ({ headers: ah(side) }));
    }
    await both('admin: user detail invalid id', 'GET', '/api/admin/users/123', (side) => ({ headers: ah(side) }));
    await both('admin: user detail unknown id', 'GET', '/api/admin/users/' + randomUUID(), (side) => ({ headers: ah(side) }));
    await both('admin: user detail', 'GET', `/api/admin/users/${members.nest.id}`, (side) => ({ headers: ah(side) }));
    for (const query of [`?subjectUserId=${members.nest.id}`, `?actorUserId=${admins.nest.id}&pageSize=5`, '?eventType=LOGIN_SUCCESS&outcome=SUCCESS&pageSize=3',
      '?eventType=login', '?outcome=MAYBE', '?actorUserId=123', '?subjectUserId=00000000-0000-0000-0000-000000000000',
      '?subjectUserId=11111111-1111-1111-1111-111111111111', '?from=2026-02-30', '?from=2026&to=2025', `?from=${new Date(t0).toISOString()}&pageSize=2`,
      '?from=2026-01-01T10:00&to=2026-01-02', '?page=2&pageSize=2']) {
      await both(`admin: audit ${decodeURIComponent(query).slice(0, 60)}`, 'GET', '/api/admin/audit-events' + query, (side) => ({ headers: ah(side) }));
    }
    // Documented divergence (legacy defect): ISO week and basic-format dates pass NestJS's @IsISO8601 but
    // new Date() cannot parse them, so NestJS fails with 500 INTERNAL_ERROR; Spring rejects them with a 400.
    for (const [query, field] of [['?to=2026-W01', 'to'], ['?from=20260101', 'from']]) {
      const n = await limited('nest', 'GET', '/api/admin/audit-events' + query, { headers: ah('nest') });
      const s = await limited('spring', 'GET', '/api/admin/audit-events' + query, { headers: ah('spring') });
      record(`divergence (documented): audit ${query} → NestJS 500, Spring 400`,
        n.status === 500 && n.json?.errorCode === 'INTERNAL_ERROR' && s.status === 400 && s.json?.errorCode === 'VALIDATION_ERROR'
          && JSON.stringify(s.json.details) === JSON.stringify([`${field} must be a valid ISO 8601 date string`]),
        { nest: [n.status, n.json?.errorCode], spring: [s.status, s.json?.errorCode, s.json?.details] });
    }
    await paired('admin: status validation', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/status`, { headers: ah(side), body: { status: 'GONE', reason: ' x ', extra: true } }));
    await paired('admin: unsupported status transition', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/status`, { headers: ah(side), body: { status: 'PENDING_DELETION', reason: 'cleanup' } }));
    await paired('admin: own status → 403', admins, (side) => limited(side, 'PATCH', `/api/admin/users/${admins[side].id}/status`, { headers: ah(side), body: { status: 'SUSPENDED', reason: 'self test' } }));
    await paired('admin: invalid id on PATCH', members, (side) => limited(side, 'PATCH', '/api/admin/users/xyz/status', { headers: ah(side), body: { status: 'SUSPENDED', reason: 'bad id' } }));
    await paired('admin: invalid id and invalid status body', members, (side) => limited(side, 'PATCH', '/api/admin/users/xyz/status', { headers: ah(side), body: { status: 'GONE' } }));
    await paired('admin: invalid id and invalid role body', members, (side) => limited(side, 'PATCH', '/api/admin/users/xyz/role', { headers: ah(side), body: { role: 'ROOT' } }));
    let since = Date.now();
    await paired('admin: suspend a member', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/status`, { headers: ah(side), body: { status: 'SUSPENDED', reason: '  Policy review  ' } }));
    await compareUsers('suspension bumps the security version', members);
    await compareSessions('suspension revokes every session', members);
    await compareMail('suspension notice', members, since, ['account-suspended']);
    await paired('member token after suspension → rejected', members, (side) => limited(side, 'GET', '/api/auth/me', { headers: mh(side) }));
    await paired('admin: same status again → STATUS_UNCHANGED', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/status`, { headers: ah(side), body: { status: 'SUSPENDED', reason: 'again' } }));
    await paired('admin: reactivate', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/status`, { headers: ah(side), body: { status: 'ACTIVE', reason: 'Review complete' } }));
    await compareMail('reactivation notice', members, since, ['account-suspended', 'account-reactivated']);
    await compareAudit('status changes', members, since);

    await paired('admin: own role → 403', admins, (side) => limited(side, 'PATCH', `/api/admin/users/${admins[side].id}/role`, { headers: ah(side), body: { role: 'INVESTOR', password: PASSWORD } }));
    await paired('admin: role validation', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/role`, { headers: ah(side), body: { role: 'ROOT', password: 7, totpCode: '12' } }));
    await paired('admin: role change with a wrong password → 403', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/role`, { headers: ah(side), body: { role: 'ADMIN', password: 'Wrong-Pass-9!' } }));
    since = Date.now();
    await paired('admin: promote a member', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/role`, { headers: ah(side), body: { role: 'ADMIN', password: PASSWORD } }));
    await paired('admin: same role again → ROLE_UNCHANGED', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/role`, { headers: ah(side), body: { role: 'ADMIN', password: PASSWORD } }));
    await paired('admin: demote back', members, (side) => limited(side, 'PATCH', `/api/admin/users/${members[side].id}/role`, { headers: ah(side), body: { role: 'INVESTOR', password: PASSWORD } }));
    await compareUsers('role changes bump the security version twice', members);
    await compareAudit('role changes', members, since);

    // Cross-backend and revocation: an admin token issued by one API works on the other until revoked.
    await both('admin: overview with the other API\'s admin token', 'GET', '/api/admin/overview', (side) => ({ headers: { ...json, ...bearer(adminAuth[side === 'nest' ? 'spring' : 'nest'].token) } }));
    await limited('nest', 'POST', '/api/auth/logout-all', { headers: ah('nest') });
    await limited('spring', 'POST', '/api/auth/logout-all', { headers: ah('spring') });
    await paired('admin: revoked admin session → 401', admins, (side) => limited(side, 'GET', '/api/admin/overview', { headers: ah(side) }));
  }

  await finish('differential-identity-report');
}

run(main);
