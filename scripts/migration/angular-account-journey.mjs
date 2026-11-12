#!/usr/bin/env node
/**
 * Browser journeys for the account-security flows of the Angular app backed by the Spring API that the identity
 * journey does not cover: verification resend, password change, e-mail change, recovery-code regeneration, MFA
 * disable, account deactivation and account deletion. With `admin-mfa`, the administrator MFA enforcement journey
 * runs instead (Spring must be started with AUTH_ADMIN_MFA_REQUIRED=true).
 *
 * E-mailed links are opened exactly as sent (never re-pointed): Spring must run with
 * MIGRATION_FRONTEND_URL = JOURNEY_ANGULAR_URL so the links target the Angular app under test.
 *
 * Prerequisites (development only):
 *   - Angular on JOURNEY_ANGULAR_URL (default http://localhost:4200) using the Spring API (http://localhost:3002)
 *   - Spring with MAIL_TRANSPORT=preview; SPRING_MAIL_DIR = its MAIL_PREVIEW_DIR
 *   - DATABASE_URL pointing at the same `*_test` database (the script refuses anything else)
 *
 *   node scripts/migration/angular-account-journey.mjs [account|admin-mfa] [<screenshot-dir>]
 *
 * Accounts are disposable (@spring-account.test) and removed at the end, including deleted (anonymised) ones.
 * Tokens, TOTP secrets and recovery codes stay in memory; screenshots mask them.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../tools/db-harness/index.mjs';
import { connect, encryptForAccount } from '../../apps/api/contract/visual-account.mjs';
import { launchEdge, sleep } from './headless-edge.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const { authenticator } = createRequire(join(ROOT, 'tools/db-harness/package.json'))('otplib');
const MODE = process.argv[2] ?? 'account';
if (!['account', 'admin-mfa'].includes(MODE)) throw new Error('Usage: angular-account-journey.mjs [account|admin-mfa] [<screenshot-dir>]');
const ANGULAR = process.env.JOURNEY_ANGULAR_URL ?? 'http://localhost:4200';
const SPRING_API = process.env.SPRING_URL ?? 'http://localhost:3002';
const MAIL_DIR = process.env.SPRING_MAIL_DIR;
const SHOTS = resolve(ROOT, process.argv[3] ?? `docs/migration/screenshots/account-journey${MODE === 'admin-mfa' ? '-admin-mfa' : ''}`);
const DOMAIN = '@spring-account.test';
const RUN = Date.now().toString(36);
const address = (local) => `${local}-${RUN}${DOMAIN}`;
const PASSWORD = 'Account-Journey-1!';
if (!MAIL_DIR || !existsSync(MAIL_DIR)) throw new Error('SPRING_MAIL_DIR must point at the Spring preview mail folder');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const { prisma, dbName } = await connect();
mkdirSync(SHOTS, { recursive: true });
const browser = await launchEdge({ port: 9352, name: 'angular-account-journey' });
await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await browser.viewport(1440, 900);

// ---------------------------------------------------------------- secrets kept in memory only

/** Every secret value the journeys see; the artifact scan at the end proves none of them was written anywhere. */
const secrets = new Set();
const remember = (...values) => values.flat().filter(Boolean).forEach((v) => secrets.add(v));

const MASK_SECRETS = `(() => {
  const nodes = [...document.querySelectorAll('code[aria-label="Authenticator secret"], [aria-label="New recovery codes"] code')];
  window.__journeyMasked = nodes.map((node) => [node, node.textContent]);
  for (const node of nodes) node.textContent = 'X'.repeat(node.textContent.length);
  return nodes.length;
})()`;
const UNMASK_SECRETS = `(() => {
  for (const [node, text] of window.__journeyMasked ?? []) node.textContent = text;
  window.__journeyMasked = undefined;
  return true;
})()`;
let maskedCaptures = 0;

async function shot(name) {
  maskedCaptures += (await browser.evaluate(MASK_SECRETS)) > 0 ? 1 : 0;
  try {
    const m = await browser.send('Page.getLayoutMetrics');
    const height = Math.min(Math.ceil(m.cssContentSize.height), 6000);
    const res = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.cssLayoutViewport.clientWidth, height, scale: 1 } });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
  } finally {
    await browser.evaluate(UNMASK_SECRETS);
  }
}

// ---------------------------------------------------------------- helpers

const path = () => browser.evaluate('location.pathname + location.search');
const LOGIN_READY = `!!document.querySelector('#email') && !!document.querySelector('#password')`;
const HYDRATED = `!!document.querySelector('#email') && !!document.querySelector('[ng-version]')`;
const SUCCESS = `(document.querySelector('.form-success-banner')?.innerText ?? '')`;
const ERROR = `(document.querySelector('.form-error-banner[role="alert"], mtr-form-error [role="alert"]')?.innerText ?? '')`;
const DIALOG = '[role="alertdialog"]';
const DIALOG_BUTTON = `${DIALOG} button`;
const DIALOG_ERROR = `(document.querySelector('${DIALOG} [role="alert"]')?.innerText ?? '')`;

/** Per-IP sign-in limit is 10/min; keep a margin. */
const signIns = [];
async function signInBudget() {
  const recent = signIns.filter((t) => Date.now() - t < 61_000);
  if (recent.length >= 8) {
    const wait = 61_000 - (Date.now() - recent[0]) + 250;
    console.log(`… waiting ${Math.ceil(wait / 1000)} s for the sign-in rate limit`);
    await sleep(wait);
  }
  signIns.push(Date.now());
}

async function signIn(email, password = PASSWORD) {
  await signInBudget();
  await browser.go(`${ANGULAR}/login`, LOGIN_READY);
  await browser.waitFor(HYDRATED);
  await browser.setValue('#email', email);
  await browser.setValue('#password', password);
  await browser.click('form button[type="submit"]');
}

async function signOut() {
  const MENU = `!!document.querySelector('button[aria-haspopup="menu"]')`;
  if (!(await browser.evaluate(MENU))) await browser.go(`${ANGULAR}/settings/profile`, MENU);
  await browser.click('button[aria-haspopup="menu"]');
  await browser.waitFor(`!!document.querySelector('[role="menu"]')`);
  await browser.clickText('Sign out');
  await browser.waitFor(`location.pathname === '/login'`);
}

async function apiLogin(email, password = PASSWORD) {
  await signInBudget();
  const res = await fetch(`${SPRING_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ANGULAR },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { status: res.status, code: body.errorCode, token: body.accessToken, challenge: body.mfaChallengeToken };
}

async function apiMfaLogin(email, secret) {
  const first = await apiLogin(email);
  const res = await fetch(`${SPRING_API}/api/auth/mfa/verify-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ANGULAR },
    body: JSON.stringify({ mfaChallengeToken: first.challenge, totpCode: await freshCode(secret) }),
  });
  const body = await res.json();
  return { status: res.status, code: body.errorCode, token: body.accessToken };
}

const apiGet = (route, token) =>
  fetch(`${SPRING_API}/api${route}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

/** Spring refuses a TOTP code twice (replay protection), so every use waits for an unused 30-second step. */
const lastStep = new Map();
async function freshCode(secret) {
  const step = () => Math.floor(Date.now() / 30_000);
  while (step() <= (lastStep.get(secret) ?? -1)) await sleep(500);
  lastStep.set(secret, step());
  return authenticator.generate(secret);
}

const created = new Set();
async function createUser(local, extra = {}) {
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: address(local),
      firstName: 'Account',
      lastName: local.charAt(0).toUpperCase() + local.slice(1),
      passwordHash: await hashPassword(PASSWORD),
      emailVerified: true,
      emailVerifiedAt: now,
      status: 'ACTIVE',
      ...extra,
    },
  });
  await prisma.userPreferences.create({ data: { id: randomUUID(), userId: user.id, updatedAt: now } });
  created.add(user.id);
  return user;
}

async function createMfaUser(local, extra = {}) {
  const secret = authenticator.generateSecret();
  remember(secret);
  const user = await createUser(local, { mfaEnabled: true, mfaVerifiedAt: new Date(), mfaSecretEncrypted: encryptForAccount(secret), mfaSecretKeyVersion: 1, ...extra });
  return { user, secret };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { OR: [{ email: { endsWith: DOMAIN } }, { id: { in: [...created] } }] }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await prisma.auditEvent.deleteMany({ where: { OR: [{ subjectUserId: { in: ids } }, { actorUserId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

function mailFiles() {
  return readdirSync(MAIL_DIR).filter((f) => f.endsWith('.json'));
}

function mails(to, since) {
  return mailFiles()
    .map((f) => JSON.parse(readFileSync(join(MAIL_DIR, f), 'utf8')))
    .filter((m) => m.to === to && Date.parse(m.createdAt) >= since)
    .map((m) => m.template);
}

/** Waits for a captured e-mail; returns every URL in its text and HTML bodies and the token link, unmodified. */
async function mail(to, template, since) {
  for (let i = 0; i < 40; i++) {
    for (const file of mailFiles()) {
      const meta = JSON.parse(readFileSync(join(MAIL_DIR, file), 'utf8'));
      if (meta.to !== to || meta.template !== template || Date.parse(meta.createdAt) < since) continue;
      const bodies = ['.txt', '.html']
        .map((ext) => join(MAIL_DIR, file.replace(/\.json$/, ext)))
        .filter(existsSync)
        .map((f) => readFileSync(f, 'utf8'));
      const urls = [...new Set(bodies.flatMap((b) => b.match(/https?:\/\/[^\s"'<>]+/g) ?? []).map((u) => u.replace(/&amp;/g, '&')))];
      const link = urls.find((u) => u.includes('token='));
      if (link) remember(new URL(link).searchParams.get('token'));
      return { found: true, link, urls };
    }
    await sleep(250);
  }
  return { found: false, urls: [] };
}

/** Gap C: the token link is the Angular origin under test, and no URL carrying a token leaves that origin. */
function checkLinkTarget(label, captured, pathname) {
  const url = captured.link ? new URL(captured.link) : null;
  check(`   ${label}: the e-mailed link targets the configured Angular origin, unmodified`, url && url.origin === new URL(ANGULAR).origin && url.pathname === pathname, captured.link ? `${url.origin}${url.pathname}?token=<redacted>` : 'no link');
  const foreign = captured.urls.filter((u) => u.includes('token=') && new URL(u).origin !== new URL(ANGULAR).origin);
  check(`   ${label}: no URL in the message sends the token to another origin`, foreign.length === 0, `${captured.urls.length} URL(s) in the message`);
}

// ---------------------------------------------------------------- journeys

async function journeyResend() {
  const user = await createUser('resend', { emailVerified: false, emailVerifiedAt: null, status: 'PENDING_VERIFICATION' });
  const since = Date.now();
  await browser.go(`${ANGULAR}/resend-verification`, `!!document.querySelector('#email')`);
  await browser.setValue('#email', user.email);
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  const generic = await browser.evaluate(SUCCESS);
  await shot('A1-resend-sent');
  await browser.go(`${ANGULAR}/resend-verification`, `!!document.querySelector('#email')`);
  await browser.setValue('#email', address('nobody'));
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  check('A1. resend verification: known and unknown addresses get the same answer', generic === (await browser.evaluate(SUCCESS)), generic);
  const verify = await mail(user.email, 'verify-email', since);
  check('   a verification e-mail is captured for the pending account only', verify.found && mails(address('nobody'), since).length === 0);
  checkLinkTarget('verification', verify, '/verify-email');

  await browser.go(verify.link, `!!document.querySelector('button.btn-primary')`);
  check('   the token is removed from the address bar before anything is sent', !(await path()).includes('token='), await path());
  await browser.clickText('Confirm email verification');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  const after = await prisma.user.findUnique({ where: { id: user.id } });
  check('   the resent link verifies and activates the account', after.emailVerified && after.status === 'ACTIVE', await browser.evaluate(SUCCESS));
}

async function journeyPasswordChange() {
  const user = await createUser('password');
  const since = Date.now();
  const otherDevice = await apiLogin(user.email);
  await signIn(user.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/settings/security`, `!!document.querySelector('#currentPassword')`);
  const NEW = 'Changed-Journey-2@';
  await browser.setValue('#currentPassword', 'Wrong-Current-9!');
  await browser.setValue('#newPassword', NEW);
  await browser.setValue('#confirmPassword', NEW);
  await browser.click('#password-heading + form button[type="submit"]');
  await browser.waitFor(`${ERROR}.length > 0`);
  const unchanged = (await prisma.user.findUnique({ where: { id: user.id } })).passwordHash === user.passwordHash;
  check('A2. password change: a wrong current password is refused and changes nothing', unchanged, await browser.evaluate(ERROR));
  await shot('A2-password-wrong-current');
  await browser.setValue('#currentPassword', PASSWORD);
  await browser.setValue('#newPassword', NEW);
  await browser.setValue('#confirmPassword', NEW);
  await browser.click('#password-heading + form button[type="submit"]');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  check('   the correct current password changes it', (await prisma.user.findUnique({ where: { id: user.id } })).passwordHash !== user.passwordHash, await browser.evaluate(SUCCESS));
  await shot('A2-password-changed');
  check('   the other device is signed out', (await apiGet('/auth/me', otherDevice.token)).status === 401);
  await browser.go(`${ANGULAR}/settings/security`, `!!document.querySelector('#currentPassword')`);
  check('   this device continues on its new session after a reload', (await path()) === '/settings/security');
  const old = await apiLogin(user.email, PASSWORD);
  const fresh = await apiLogin(user.email, NEW);
  check('   the old password is refused and the new one signs in', old.status === 401 && fresh.status === 200, `${old.status} ${old.code} / ${fresh.status}`);
  check('   a password-changed notice was sent', mails(user.email, since).includes('password-changed'), mails(user.email, since).join(', '));
  await signOut();
}

async function journeyEmailChange() {
  const user = await createUser('email');
  const newEmail = address('email-new');
  const since = Date.now();
  await signIn(user.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/settings/security`, `!!document.querySelector('#newEmail')`);
  await browser.setValue('#newEmail', newEmail);
  await browser.setValue('#emailPassword', PASSWORD);
  await browser.clickText('Request email change');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  check('A3. e-mail change: the request is accepted and nothing changes yet', (await prisma.user.findUnique({ where: { id: user.id } })).email === user.email, await browser.evaluate(SUCCESS));
  await shot('A3-email-change-requested');
  const confirm = await mail(newEmail, 'email-change-confirm', since);
  check('   the confirmation goes to the new address and a notice to the current one', confirm.found && mails(user.email, since).includes('email-change-requested'));
  checkLinkTarget('e-mail change', confirm, '/confirm-email-change');

  await browser.go(confirm.link, `!!document.querySelector('button.btn-primary')`);
  check('   the token is removed from the address bar before anything is sent', !(await path()).includes('token='), await path());
  await browser.clickText('Confirm new email');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  const after = await prisma.user.findUnique({ where: { id: user.id } });
  check('   confirming moves the account to the new address', after.email === newEmail, await browser.evaluate(SUCCESS));
  check('   every session is signed out', (await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })) === 0);
  check('   both addresses are notified', mails(user.email, since).includes('email-changed-old') && mails(newEmail, since).includes('email-changed-new'));
  await shot('A3-email-changed');
  await signIn(newEmail);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  check('   the new address signs in', (await path()) === '/dashboard');
  await signOut();
}

async function generateCodes(secret) {
  await browser.clickText('Generate new recovery codes');
  await browser.waitFor(`!!document.querySelector('#regen-password')`);
  await browser.setValue('#regen-password', PASSWORD);
  await browser.setValue('#regen-totp', await freshCode(secret));
  await browser.clickText('Generate codes', DIALOG_BUTTON);
  await browser.waitFor(`!!document.querySelector('[aria-label="New recovery codes"]')`);
  const codes = await browser.evaluate(`[...document.querySelectorAll('[aria-label="New recovery codes"] code')].map((c) => c.innerText.trim())`);
  remember(codes);
  return codes;
}

async function mfaSignIn(email, code) {
  await signIn(email);
  await browser.waitFor(`!!document.querySelector('#code')`);
  await browser.setValue('#code', code);
  await browser.clickText('Verify and continue');
}

async function journeyRecoveryCodesAndDisable() {
  const { user, secret } = await createMfaUser('mfa');
  const since = Date.now();
  await mfaSignIn(user.email, await freshCode(secret));
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/settings/security`, `document.body.innerText.includes('Generate new recovery codes')`);

  const first = await generateCodes(secret);
  check('A4. recovery codes: regeneration with password and code shows 10 new codes', first.length === 10, `${first.length} codes`);
  await shot('A4-recovery-codes');
  await browser.clickText('I have stored these codes');
  const second = await generateCodes(secret);
  await browser.clickText('I have stored these codes');
  const unused = await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } });
  check('   regenerating again replaces the set (10 unused codes stored, all different)', unused === 10 && !second.some((c) => first.includes(c)), `${unused} unused`);
  check('   the codes are gone from the page after acknowledgement', !(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(second[0])})`)));
  check('   a notice was sent for each regeneration', mails(user.email, since).filter((t) => t === 'mfa-recovery-codes-regenerated').length === 2, mails(user.email, since).join(', '));
  await signOut();

  await mfaSignIn(user.email, first[0]);
  await browser.waitFor(`${LOGIN_READY} && ${ERROR}.length > 0`);
  check('   a code from the replaced set no longer signs in', (await path()).startsWith('/login'), await browser.evaluate(ERROR));
  await mfaSignIn(user.email, second[0]);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  check('   a code from the current set signs in and is consumed', (await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: { not: null } } })) === 1);

  const otherDevice = await apiMfaLogin(user.email, secret);
  check('   a second device signs in with password and code', otherDevice.status === 200 && (await apiGet('/auth/me', otherDevice.token)).status === 200, `${otherDevice.status} ${otherDevice.code ?? ''}`);
  await browser.go(`${ANGULAR}/settings/security`, `!!document.querySelector('#disable-mfa-heading')`);
  await browser.clickText('Turn off two-step verification');
  await browser.waitFor(`!!document.querySelector('#disableMfa-password')`);
  await browser.setValue('#disableMfa-password', PASSWORD);
  await browser.setValue('#disableMfa-totp', '000000');
  await browser.clickText('Turn off', DIALOG_BUTTON);
  await browser.waitFor(`${DIALOG_ERROR}.length > 0`);
  check('A5. MFA disable: a wrong authenticator code keeps it on', (await prisma.user.findUnique({ where: { id: user.id } })).mfaEnabled, await browser.evaluate(DIALOG_ERROR));
  await shot('A5-disable-wrong-code');
  await browser.setValue('#disableMfa-password', PASSWORD);
  await browser.setValue('#disableMfa-totp', await freshCode(secret));
  await browser.clickText('Turn off', DIALOG_BUTTON);
  await browser.waitFor(`${SUCCESS}.length > 0`);
  const off = await prisma.user.findUnique({ where: { id: user.id } });
  check('   password and a fresh code turn it off and erase the secret and recovery codes', !off.mfaEnabled && !off.mfaSecretEncrypted && (await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })) === 0, await browser.evaluate(SUCCESS));
  check('   the other device is signed out', !!otherDevice.token && (await apiGet('/auth/me', otherDevice.token)).status === 401);
  check('   an MFA-disabled notice was sent', mails(user.email, since).includes('mfa-disabled'));
  await shot('A5-mfa-off');
  await signOut();
}

async function journeyDeactivate() {
  const user = await createUser('deactivate');
  const since = Date.now();
  await signIn(user.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/settings/security`, `!!document.querySelector('#lifecycle-heading')`);
  await browser.clickText('Deactivate account');
  await browser.waitFor(`!!document.querySelector('#deactivate-password')`);
  await browser.setValue('#deactivate-password', 'Wrong-Pass-9!');
  await browser.clickText('Deactivate', DIALOG_BUTTON);
  await browser.waitFor(`${DIALOG_ERROR}.length > 0`);
  check('A6. deactivation: a wrong password is refused', (await prisma.user.findUnique({ where: { id: user.id } })).status === 'ACTIVE', await browser.evaluate(DIALOG_ERROR));
  await shot('A6-deactivate-dialog');
  await browser.setValue('#deactivate-password', PASSWORD);
  await browser.clickText('Deactivate', DIALOG_BUTTON);
  await browser.waitFor(`location.pathname === '/login'`);
  const after = await prisma.user.findUnique({ where: { id: user.id } });
  check('   the account is deactivated, every session revoked, and the page returns to sign-in', after.status === 'DEACTIVATED' && (await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })) === 0);
  check('   a deactivation notice was sent', mails(user.email, since).includes('account-deactivated'));
  await signIn(user.email);
  await browser.waitFor(`${ERROR}.length > 0`);
  check('   signing in again is refused', (await path()).startsWith('/login'), await browser.evaluate(ERROR));
}

async function journeyDelete() {
  const user = await createUser('delete');
  const since = Date.now();
  await signIn(user.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/settings/security`, `!!document.querySelector('#lifecycle-heading')`);
  await browser.clickText('Delete account');
  await browser.waitFor(`!!document.querySelector('#delete-password')`);
  await browser.setValue('#delete-password', PASSWORD);
  await browser.setValue('#deleteConfirmation', 'delete');
  await browser.clickText('Delete account', DIALOG_BUTTON);
  await browser.waitFor(`${DIALOG_ERROR}.length > 0`);
  check('A7. deletion: the confirmation word must be typed exactly', (await prisma.user.findUnique({ where: { id: user.id } })).status === 'ACTIVE', await browser.evaluate(DIALOG_ERROR));
  await shot('A7-delete-dialog');
  await browser.setValue('#deleteConfirmation', 'DELETE');
  await browser.clickText('Delete account', DIALOG_BUTTON);
  await browser.waitFor(`location.pathname === '/login'`);
  const after = await prisma.user.findUnique({ where: { id: user.id } });
  check('   the account is pending deletion with name and e-mail removed', after.status === 'PENDING_DELETION' && after.email === `deleted:${user.id}@invalid.local` && after.firstName === 'Deleted', after.status);
  check('   every session is revoked', (await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })) === 0);
  check('   the notice went to the original address', mails(user.email, since).includes('account-deletion-scheduled'));
  const again = await apiLogin(user.email);
  check('   the old address can no longer sign in', again.status === 401, `${again.status} ${again.code}`);
}

async function journeyAdminMfaPolicy() {
  const admin = await createUser('policy-admin', { role: 'ADMIN' });
  const investor = await createUser('policy-investor');
  const session = await apiLogin(admin.email);
  const blocked = await apiGet('/admin/overview', session.token);
  check('M1. admin MFA policy: an administrator without MFA is refused by Spring (403 ADMIN_MFA_REQUIRED)', blocked.status === 403 && blocked.body.errorCode === 'ADMIN_MFA_REQUIRED', `${blocked.status} ${blocked.body.errorCode}`);
  const context = await apiGet('/users/me/dashboard-context', session.token);
  check('   the dashboard context asks the administrator to enrol', context.body.requiredActions?.includes('ENROLL_MFA_FOR_ADMIN'), JSON.stringify(context.body.requiredActions));
  const investorSession = await apiLogin(investor.email);
  const investorContext = await apiGet('/users/me/dashboard-context', investorSession.token);
  check('   investors are not affected', investorContext.status === 200 && !investorContext.body.requiredActions?.includes('ENROLL_MFA_FOR_ADMIN'));

  await signIn(admin.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/admin`, `${ERROR}.length > 0`);
  check('   the Angular admin overview shows the enrolment requirement instead of data', /two-step verification/i.test(await browser.evaluate(ERROR)), await browser.evaluate(ERROR));
  await shot('M1-admin-locked');
  await browser.go(`${ANGULAR}/settings/security`, `!!document.querySelector('#mfaSetupPassword')`);
  await browser.waitFor(`document.body.innerText.includes('Administrator tools stay locked')`, 5000).catch(() => false);
  check('   the security page explains why administrator tools are locked', await browser.evaluate(`document.body.innerText.includes('Administrator tools stay locked')`));
  await shot('M1-security-banner');

  await browser.setValue('#mfaSetupPassword', PASSWORD);
  await browser.clickText('Set up authenticator');
  await browser.waitFor(`!!document.querySelector('code[aria-label="Authenticator secret"]')`);
  const secret = await browser.evaluate(`document.querySelector('code[aria-label="Authenticator secret"]').innerText.trim()`);
  remember(secret);
  await browser.setValue('#mfaEnableCode', await freshCode(secret));
  await browser.clickText('Turn on two-step verification');
  await browser.waitFor(`!!document.querySelector('[aria-label="New recovery codes"]')`);
  remember(await browser.evaluate(`[...document.querySelectorAll('[aria-label="New recovery codes"] code')].map((c) => c.innerText.trim())`));
  await shot('M2-enrolled');
  await browser.clickText('I have stored these codes');
  check('M2. enrolling turns MFA on', (await prisma.user.findUnique({ where: { id: admin.id } })).mfaEnabled);
  await browser.go(`${ANGULAR}/admin`, `document.querySelectorAll('.stat-tile').length > 0 || ${ERROR}.length > 0`);
  const tiles = await browser.evaluate(`document.querySelectorAll('.stat-tile').length`);
  check('   the same administrator now reaches the overview with live data', (await path()) === '/admin' && tiles > 0 && (await browser.evaluate(ERROR)) === '', `${tiles} tiles`);
  await shot('M2-admin-unlocked');
  const unlocked = await apiGet('/admin/overview', session.token);
  check('   Spring serves the admin API to the same session once MFA is on', unlocked.status === 200, String(unlocked.status));
}

/** Gap F: no secret seen during the run was written to any artifact, screenshot result file or e-mail. */
function scanArtifacts() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(SHOTS);
  for (const f of mailFiles()) files.push(join(MAIL_DIR, f), join(MAIL_DIR, f.replace(/\.json$/, '.txt')), join(MAIL_DIR, f.replace(/\.json$/, '.html')));
  const codesAndSecrets = [...secrets].filter((s) => !/^[0-9a-f]{64}$/.test(s));
  const leaks = [];
  for (const file of files.filter(existsSync)) {
    const text = readFileSync(file, 'latin1');
    if (codesAndSecrets.some((s) => text.includes(s))) leaks.push(file);
  }
  check('S1. no TOTP secret or recovery code appears in screenshots, results or captured e-mails', leaks.length === 0, `${codesAndSecrets.length} value(s) checked in ${files.filter(existsSync).length} file(s)${leaks.length ? `; found in ${leaks.join(', ')}` : ''}`);
}

const rateLimited = [];
browser.on('Network.responseReceived', ({ response }) => {
  if (response.status === 429) rateLimited.push(new URL(response.url).pathname);
});

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(`${name} aborted: ${error.message}`, false);
    await shot(`${name}-aborted`).catch(() => undefined);
    await browser.clearCookies().catch(() => undefined);
  }
}

try {
  console.log(`Database: ${dbName} · mode: ${MODE}`);
  await cleanup();
  // Sign-ins from an earlier run in the last minute still count toward the per-IP limit.
  console.log('… waiting 61 s so earlier sign-ins leave the rate-limit window');
  await sleep(61_000);
  if (MODE === 'account') {
    await step('A1', journeyResend);
    await step('A2', journeyPasswordChange);
    await step('A3', journeyEmailChange);
    await step('A4-5', journeyRecoveryCodesAndDisable);
    await step('A6', journeyDeactivate);
    await step('A7', journeyDelete);
  } else {
    await step('M1-2', journeyAdminMfaPolicy);
  }
} finally {
  await sleep(200);
  browser.close();
  await cleanup().catch((e) => check(`cleanup failed: ${e.message}`, false));
  await prisma.$disconnect();
}
if (browser.allPageErrors.length) check('no uncaught page errors', false, browser.allPageErrors.join(' | '));
check('no request was rate-limited during the journeys', rateLimited.length === 0, rateLimited.join(', '));
check('screenshots taken while secrets were on screen were masked', maskedCaptures > 0, `${maskedCaptures} masked capture(s)`);
scanArtifacts();
writeFileSync(join(SHOTS, 'results.json'), JSON.stringify({ ranAt: new Date().toISOString(), database: dbName, mode: MODE, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
