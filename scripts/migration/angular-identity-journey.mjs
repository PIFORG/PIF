#!/usr/bin/env node
/**
 * Browser journeys for the phase-2 identity slice on the Angular app backed by the Spring API: registration and
 * e-mail verification, password recovery, MFA enrolment and recovery-code sign-in, session revocation, multi-tab
 * sign-in/sign-out synchronization, administrator access control and operations, and cross-backend continuity
 * with the Next.js app backed by NestJS on the same `_test` database.
 *
 * Prerequisites (development only):
 *   - Angular on JOURNEY_ANGULAR_URL (default http://localhost:4200) using the Spring API (http://localhost:3002)
 *   - Next.js on JOURNEY_NEXT_URL (default http://localhost:3000) using the NestJS API (http://localhost:3001)
 *   - both APIs with MAIL_TRANSPORT=preview; SPRING_MAIL_DIR = Spring's MAIL_PREVIEW_DIR
 *   - DATABASE_URL pointing at the same `*_test` database (the script refuses anything else)
 *
 *   node scripts/migration/angular-identity-journey.mjs [<screenshot-dir>]
 *
 * Accounts are disposable (@spring-journey.test) and removed at the end. Tokens and the MFA secret stay in memory.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../tools/db-harness/index.mjs';
import { connect } from '../../apps/api/contract/visual-account.mjs';
import { launchEdge, sleep } from './headless-edge.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const { authenticator } = createRequire(join(ROOT, 'tools/db-harness/package.json'))('otplib');
const ANGULAR = process.env.JOURNEY_ANGULAR_URL ?? 'http://localhost:4200';
const NEXT = process.env.JOURNEY_NEXT_URL ?? 'http://localhost:3000';
const SPRING_API = process.env.SPRING_URL ?? 'http://localhost:3002';
const NEST_API = process.env.NEST_URL ?? 'http://localhost:3001';
const MAIL_DIR = process.env.SPRING_MAIL_DIR;
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/migration/screenshots/identity-journey');
const DOMAIN = '@spring-journey.test';
const RUN = Date.now().toString(36);
const address = (local) => `${local}-${RUN}${DOMAIN}`;
const PASSWORD = 'Journey-Pass-1!';
if (!MAIL_DIR || !existsSync(MAIL_DIR)) throw new Error('SPRING_MAIL_DIR must point at the Spring preview mail folder');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const { prisma, dbName } = await connect();
mkdirSync(SHOTS, { recursive: true });
const browser = await launchEdge({ port: 9347, name: 'angular-identity-journey' });
await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

// ---------------------------------------------------------------- helpers

/**
 * MFA secrets and recovery codes, even of disposable accounts, never reach a screenshot. They are masked only
 * for the capture and restored afterwards, so later checks still see the real page.
 */
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

async function shot(tab, name) {
  await tab.evaluate(MASK_SECRETS);
  try {
    const m = await tab.send('Page.getLayoutMetrics');
    const height = Math.min(Math.ceil(m.cssContentSize.height), 6000);
    const res = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.cssLayoutViewport.clientWidth, height, scale: 1 } });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
  } finally {
    await tab.evaluate(UNMASK_SECRETS);
  }
}
const path = (tab = browser) => tab.evaluate('location.pathname + location.search');
const LOGIN_READY = `!!document.querySelector('#email') && !!document.querySelector('#password')`;
const SUCCESS = `(document.querySelector('.form-success-banner')?.innerText ?? '')`;
const ERROR = `(document.querySelector('.form-error-banner[role="alert"], mtr-form-error [role="alert"]')?.innerText ?? '')`;
const DIALOG_BUTTON = '[role="alertdialog"] button';

/** Per-IP sign-in limit is 10/min per API; keep a margin so journeys never trip it. */
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

/** Typing before React (dev mode) or Angular has attached its listeners would be lost. */
const HYDRATED = `(() => { const el = document.querySelector('#email'); return !!el && (Object.keys(el).some((k) => k.startsWith('__react')) || !!document.querySelector('[ng-version]')); })()`;

async function signIn(tab, email, password = PASSWORD, base = ANGULAR) {
  await signInBudget();
  await tab.go(`${base}/login`, LOGIN_READY);
  await tab.waitFor(HYDRATED);
  await tab.setValue('#email', email);
  await tab.setValue('#password', password);
  await tab.click('form button[type="submit"]');
}

const MENU = `!!document.querySelector('button[aria-haspopup="menu"]')`;
async function signOut(tab) {
  if (!(await tab.evaluate(MENU))) await tab.go(`${new URL(await tab.evaluate('location.href')).origin}/settings/profile`, MENU);
  await tab.click('button[aria-haspopup="menu"]');
  await tab.waitFor(`!!document.querySelector('[role="menu"]')`);
  await tab.clickText('Sign out');
  await tab.waitFor(`location.pathname === '/login'`);
}

async function apiLogin(base, email, password = PASSWORD) {
  await signInBudget();
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: NEXT },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`API sign-in failed: ${res.status} ${body.errorCode ?? ''}`);
  return body.accessToken;
}

const me = (base, token) => fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, code: (await r.json().catch(() => ({}))).errorCode }));

async function createUser(local, extra = {}) {
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: address(local),
      firstName: 'Journey',
      lastName: local.charAt(0).toUpperCase() + local.slice(1),
      passwordHash: await hashPassword(PASSWORD),
      emailVerified: true,
      emailVerifiedAt: now,
      status: 'ACTIVE',
      ...extra,
    },
  });
  await prisma.userPreferences.create({ data: { id: randomUUID(), userId: user.id, updatedAt: now } });
  return user;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { OR: [{ email: { endsWith: DOMAIN } }, { lastName: { startsWith: `J-${RUN}` } }] }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await prisma.auditEvent.deleteMany({ where: { OR: [{ subjectUserId: { in: ids } }, { actorUserId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/** Waits for a captured e-mail and returns its link, re-pointed at the Angular app (see note in the report). */
async function mailLink(to, template, since) {
  for (let i = 0; i < 40; i++) {
    for (const file of readdirSync(MAIL_DIR).filter((f) => f.endsWith('.json'))) {
      const meta = JSON.parse(readFileSync(join(MAIL_DIR, file), 'utf8'));
      if (meta.to !== to || meta.template !== template || Date.parse(meta.createdAt) < since) continue;
      const text = readFileSync(join(MAIL_DIR, file.replace(/\.json$/, '.txt')), 'utf8');
      const link = /(https?:\/\/\S+\?token=[^\s]+)/.exec(text)?.[1];
      if (!link) return { found: true, link: null, origin: null };
      const url = new URL(link);
      return { found: true, origin: url.origin, link: `${ANGULAR}${url.pathname}${url.search}` };
    }
    await sleep(250);
  }
  return { found: false };
}

function mails(to, since) {
  return readdirSync(MAIL_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(MAIL_DIR, f), 'utf8')))
    .filter((m) => m.to === to && Date.parse(m.createdAt) >= since)
    .map((m) => m.template);
}

/** Collects the access tokens a tab receives (kept in memory for revocation checks; never printed). */
function captureTokens(tab) {
  const tokens = [];
  tab.on('Network.responseReceived', async ({ requestId, response }) => {
    if (!/\/api\/auth\/(refresh|login|mfa\/verify-login)$/.test(new URL(response.url).pathname) || response.status !== 200) return;
    await sleep(50);
    try {
      const { body } = await tab.send('Network.getResponseBody', { requestId });
      const token = JSON.parse(body).accessToken;
      if (token) tokens.push(token);
    } catch {
      /* body evicted; ignore */
    }
  });
  return tokens;
}

// ---------------------------------------------------------------- journeys

async function journeyRegistration() {
  const email = address('register');
  const since = Date.now();
  await browser.viewport(1440, 900);
  await browser.go(`${ANGULAR}/register`, `!!document.querySelector('#firstName')`);
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`document.querySelectorAll('.field-error').length >= 3`);
  check('J1. registration: empty submit shows field errors and sends nothing', (await prisma.user.count({ where: { email } })) === 0);
  await shot(browser, 'J1-register-errors');
  await browser.setValue('#firstName', 'Regina');
  await browser.setValue('#lastName', `J-${RUN}`);
  await browser.setValue('#email', email);
  await browser.setValue('#password', PASSWORD);
  await browser.setValue('#confirmPassword', PASSWORD);
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  const created = await prisma.user.findUnique({ where: { email } });
  check('   registration shows the generic confirmation and creates a pending account', created?.status === 'PENDING_VERIFICATION' && !created.emailVerified, await browser.evaluate(SUCCESS));
  await shot(browser, 'J1-register-success');

  const verify = await mailLink(email, 'verify-email', since);
  check('   a verification e-mail is captured by the preview transport (never delivered)', verify.found && !!verify.link, `link origin ${verify.origin}`);
  await signIn(browser, email);
  await browser.waitFor(`document.body.textContent.includes('not verified')`);
  const notice = await browser.evaluate(`[...document.querySelectorAll('[role="status"], [role="alert"]')].map((e) => e.textContent.trim()).find((t) => t.includes('not verified')) ?? ''`);
  check('   sign-in before verification is refused with a resend option', (await path()).startsWith('/login') && (await browser.evaluate(`document.body.textContent.includes('Resend verification email')`)), notice);
  await shot(browser, 'J1-login-unverified');

  await browser.go(verify.link, `!!document.querySelector('button.btn-primary')`);
  check('   the verification token is removed from the address bar before anything is sent', !(await path()).includes('token='), await path());
  check('   nothing is verified on page load', !(await prisma.user.findUnique({ where: { email } })).emailVerified);
  await browser.clickText('Confirm email verification');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  const verified = await prisma.user.findUnique({ where: { email } });
  check('   confirming verifies the e-mail and activates the account', verified.emailVerified && verified.status === 'ACTIVE', await browser.evaluate(SUCCESS));
  await shot(browser, 'J1-verified');
  await browser.go(verify.link, `!!document.querySelector('button.btn-primary')`);
  await browser.clickText('Confirm email verification');
  await browser.waitFor(`${ERROR}.length > 0`);
  check('   the link cannot be used twice', /invalid|expired|used/i.test(await browser.evaluate(ERROR)), await browser.evaluate(ERROR));

  await signIn(browser, email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  check('   the verified account signs in and lands on the workspace', (await path()) === '/dashboard');
  check('   a welcome e-mail followed verification', mails(email, since).includes('welcome'), mails(email, since).join(', '));
  await signOut(browser);
}

async function journeyRecovery() {
  const user = await createUser('recover');
  const since = Date.now();
  await browser.go(`${ANGULAR}/forgot-password`, `!!document.querySelector('#email')`);
  await browser.setValue('#email', user.email);
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  const generic = await browser.evaluate(SUCCESS);
  await browser.go(`${ANGULAR}/forgot-password`, `!!document.querySelector('#email')`);
  await browser.setValue('#email', address('nobody'));
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  check('J3. recovery: known and unknown addresses get the same answer', generic === (await browser.evaluate(SUCCESS)), generic);
  const reset = await mailLink(user.email, 'reset-password', since);
  check('   a reset link is captured for the real account only', reset.found && mails(address('nobody'), since).length === 0);

  await browser.go(reset.link, `${'document.body.innerText.includes("Confirm reset handoff")'}`);
  check('   the reset token is removed from the address bar', !(await path()).includes('token='), await path());
  await browser.clickText('Confirm reset handoff');
  await browser.waitFor(`!!document.querySelector('#password')`);
  await browser.setValue('#password', 'weakpassword');
  await browser.setValue('#confirmPassword', 'weakpassword');
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`!!document.querySelector('.field-error') || ${ERROR}.length > 0`);
  check('   a weak password is rejected without consuming the link', (await prisma.authToken.count({ where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null } })) === 1);
  await shot(browser, 'J3-reset-weak');
  await browser.setValue('#password', 'Recovered-Pass-2@');
  await browser.setValue('#confirmPassword', 'Recovered-Pass-2@');
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`${SUCCESS}.length > 0`);
  check('   the new password is saved', /updated|changed|reset/i.test(await browser.evaluate(SUCCESS)), await browser.evaluate(SUCCESS));
  await signIn(browser, user.email, PASSWORD);
  await browser.waitFor(`${ERROR}.length > 0`);
  check('   the old password no longer works', /invalid/i.test(await browser.evaluate(ERROR)));
  await signIn(browser, user.email, 'Recovered-Pass-2@');
  await browser.waitFor(`location.pathname === '/dashboard'`);
  check('   the new password signs in', (await path()) === '/dashboard');
  check('   a password-changed notice was sent', mails(user.email, since).includes('password-changed'), mails(user.email, since).join(', '));
  await signOut(browser);
}

async function journeyMfa() {
  const user = await createUser('mfa');
  const since = Date.now();
  await signIn(browser, user.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/settings/security`, `!!document.querySelector('#mfaSetupPassword')`);
  await shot(browser, 'J5-security');
  await browser.setValue('#mfaSetupPassword', 'Wrong-Pass-9!');
  await browser.clickText('Set up authenticator');
  await browser.waitFor(`${ERROR}.length > 0`);
  check('J5. MFA: a wrong password does not start enrolment', !(await prisma.user.findUnique({ where: { id: user.id } })).mfaPendingSecretEncrypted, await browser.evaluate(ERROR));
  await browser.setValue('#mfaSetupPassword', PASSWORD);
  await browser.clickText('Set up authenticator');
  await browser.waitFor(`!!document.querySelector('code[aria-label="Authenticator secret"]')`);
  const secret = await browser.evaluate(`document.querySelector('code[aria-label="Authenticator secret"]').innerText.trim()`);
  const pending = await prisma.user.findUnique({ where: { id: user.id } });
  check('   enrolment shows a secret that is stored only encrypted', /^[A-Z2-7]{16,}$/.test(secret) && pending.mfaPendingSecretEncrypted?.startsWith('v1:') && !pending.mfaPendingSecretEncrypted.includes(secret));
  await browser.setValue('#mfaEnableCode', '000000');
  await browser.clickText('Turn on two-step verification');
  await browser.waitFor(`${ERROR}.length > 0 || !!document.querySelector('.field-error')`);
  check('   a wrong code keeps MFA off', !(await prisma.user.findUnique({ where: { id: user.id } })).mfaEnabled);
  await browser.setValue('#mfaEnableCode', authenticator.generate(secret));
  await browser.clickText('Turn on two-step verification');
  await browser.waitFor(`!!document.querySelector('[aria-label="New recovery codes"]')`);
  const codes = await browser.evaluate(`[...document.querySelectorAll('[aria-label="New recovery codes"] code')].map((c) => c.innerText.trim())`);
  const enabled = await prisma.user.findUnique({ where: { id: user.id } });
  check('   a valid code turns MFA on and shows 10 recovery codes once', enabled.mfaEnabled && codes.length === 10, `${codes.length} codes`);
  await shot(browser, 'J5-recovery-codes');
  await browser.clickText('I have stored these codes');
  check('   the codes are gone from the page after acknowledgement', !(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(codes[0])})`)));
  await signOut(browser);

  await signIn(browser, user.email);
  await browser.waitFor(`!!document.querySelector('#code')`);
  await browser.setValue('#code', codes[0]);
  await browser.clickText('Verify and continue');
  await browser.waitFor(`location.pathname === '/dashboard'`);
  const used = await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: { not: null } } });
  check('   a recovery code completes sign-in and is consumed', used === 1, `${used} used`);
  await signOut(browser);
  await signIn(browser, user.email);
  await browser.waitFor(`!!document.querySelector('#code')`);
  await browser.setValue('#code', codes[0]);
  await browser.clickText('Verify and continue');
  await browser.waitFor(`${LOGIN_READY} && ${ERROR}.length > 0`);
  check('   the same recovery code cannot be used twice', (await path()).startsWith('/login'), await browser.evaluate(ERROR));
  check('   MFA-enabled notice sent', mails(user.email, since).includes('mfa-enabled'), mails(user.email, since).join(', '));
}

async function journeySessions() {
  const user = await createUser('sessions');
  const otherDevice = await apiLogin(SPRING_API, user.email);
  await signIn(browser, user.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/settings/sessions`, `document.querySelectorAll('mtr-session-card').length === 2`);
  const current = await browser.evaluate(`[...document.querySelectorAll('mtr-session-card')].filter((c) => c.textContent.includes('This device')).length`);
  check('J6. sessions: both sessions are listed and exactly one is marked as this device', current === 1);
  await shot(browser, 'J6-sessions');
  check('   the other device is signed in before revocation', (await me(SPRING_API, otherDevice)).status === 200);
  await browser.clickText('Revoke session');
  await browser.waitFor(`document.querySelectorAll('mtr-session-card').length === 1`);
  const after = { spring: await me(SPRING_API, otherDevice), nest: await me(NEST_API, otherDevice) };
  check('   revoking it from the page denies its token on Spring and on NestJS', after.spring.status === 401 && after.nest.status === 401, `${after.spring.status} ${after.spring.code} / ${after.nest.status} ${after.nest.code}`);
  const row = await prisma.authSession.findFirst({ where: { userId: user.id, revokedAt: { not: null } } });
  check('   the session is revoked in PostgreSQL with reason USER_REVOKE', row?.revokedReason === 'USER_REVOKE', row?.revokedReason);
  await signOut(browser);
}

async function journeyMultiTab() {
  const user = await createUser('tabs');
  const tabA = browser;
  await signIn(tabA, user.email);
  await tabA.waitFor(`location.pathname === '/dashboard'`);
  const tabB = await browser.openTab();
  const tokensB = captureTokens(tabB);
  await tabB.go(`${ANGULAR}/settings/profile`, `document.querySelector('#firstName')?.value === 'Journey'`);
  check('MT1. a second tab opens signed in from the shared HttpOnly cookie', (await path(tabB)) === '/settings/profile');
  const storage = await tabB.evaluate(`JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)) + document.cookie`);
  check('     no token is readable from Web Storage or document.cookie in either tab', !/eyJ|refresh/i.test(storage));

  // Concurrent refresh: both tabs reload at the same moment and present the same refresh cookie.
  await tabA.go(`${ANGULAR}/settings/profile`, `document.querySelector('#firstName')?.value === 'Journey'`);
  const refreshes = { a: [], b: [] };
  for (const [key, tab] of [['a', tabA], ['b', tabB]]) {
    tab.on('Network.responseReceived', ({ response }) => {
      if (response.url.endsWith('/api/auth/refresh')) refreshes[key].push(response.status);
    });
    await tab.evaluate('window.__beforeReload = true');
  }
  // Page.reload returns before the old document unloads; wait for a document without the marker.
  const RELOADED = `!window.__beforeReload && document.readyState === 'complete' && document.querySelector('#firstName')?.value === 'Journey'`;
  await Promise.all([tabA.send('Page.reload'), tabB.send('Page.reload')]);
  await Promise.all([tabA.waitFor(RELOADED), tabB.waitFor(RELOADED)]);
  await sleep(1000);
  check('     both tabs refreshed after the simultaneous reload', refreshes.a.includes(200) && refreshes.b.includes(200), `tab A ${refreshes.a.join('/')} · tab B ${refreshes.b.join('/')}`);
  const reuse = await prisma.auditEvent.count({ where: { subjectUserId: user.id, eventType: 'REFRESH_REUSE_DETECTED' } });
  const live = await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } });
  check('MT6. simultaneous reloads (concurrent refresh) keep both tabs signed in without a reuse alarm', reuse === 0 && live === 1, `${live} live session(s), ${reuse} reuse event(s)`);
  check('MT8. a reload restores the session in both tabs', (await path(tabA)) === '/settings/profile' && (await path(tabB)) === '/settings/profile');
  const tokenB = tokensB.at(-1);

  await signOut(tabA);
  await tabB.waitFor(`location.pathname === '/login'`, 5000).catch(() => false);
  check('MT2/3. signing out in one tab sends the other tab to sign-in without user action', (await path(tabB)).startsWith('/login'), await path(tabB));
  await shot(tabB, 'MT3-other-tab-signed-out');
  await tabB.go(`${ANGULAR}/settings/profile`, LOGIN_READY);
  check('MT4. after sign-out a reload cannot refresh: the tab stays signed out', (await path(tabB)).startsWith('/login'));
  const refreshAfter = await tabB.evaluate(`fetch(${JSON.stringify(SPRING_API + '/api/auth/refresh')}, { method: 'POST', credentials: 'include' }).then((r) => r.status)`);
  check('     the refresh endpoint answers 401 for that browser', refreshAfter === 401, String(refreshAfter));
  const denied = tokenB ? { spring: await me(SPRING_API, tokenB), nest: await me(NEST_API, tokenB) } : null;
  check('MT5. the other tab\'s last access token is rejected by Spring and NestJS', denied && denied.spring.status === 401 && denied.nest.status === 401, denied ? `${denied.spring.status} ${denied.spring.code} / ${denied.nest.status} ${denied.nest.code}` : 'no token captured');

  await signIn(tabB, user.email);
  await tabB.waitFor(`location.pathname === '/dashboard'`);
  await tabA.waitFor(`!document.querySelector('#password')`, 5000).catch(() => false);
  await tabA.go(`${ANGULAR}/settings/profile`, `document.querySelector('#firstName')?.value === 'Journey'`);
  check('MT7. a new sign-in in one tab restores a valid session in the other', (await path(tabA)) === '/settings/profile');

  // Cross-app: the Next.js app (NestJS) shares the cookie; its sign-out is not broadcast to Angular, but Angular's
  // next request fails closed.
  const tabC = await browser.openTab();
  await tabC.go(`${NEXT}/settings/profile`, `document.querySelector('#firstName')?.value === 'Journey'`);
  check('MT9. the Next.js app (NestJS) accepts the session started in Angular (Spring)', (await path(tabC)) === '/settings/profile');
  await signOut(tabC);
  await tabA.go(`${ANGULAR}/settings/profile`, LOGIN_READY);
  check('     after signing out in Next.js, Angular cannot resume the session', (await path(tabA)).startsWith('/login'));
  await tabB.close();
  await tabC.close();
}

async function journeyAdmin() {
  const admin = await createUser('admin', { role: 'ADMIN' });
  const investor = await createUser('investor');
  const target = await createUser('target');

  // Non-admin.
  await signIn(browser, investor.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/admin/users`, `location.pathname === '/unauthorized'`);
  check('J8. an investor opening /admin/users is sent to /unauthorized', (await path()) === '/unauthorized');
  check('   the administration UI is never rendered for them', !(await browser.evaluate(`document.body.innerText.includes('Platform administration')`)));
  await shot(browser, 'J8-unauthorized');
  const investorToken = await apiLogin(SPRING_API, investor.email);
  const direct = await fetch(`${SPRING_API}/api/admin/users/${target.id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${investorToken}` },
    body: JSON.stringify({ status: 'SUSPENDED', reason: 'bypassing the UI' }),
  });
  check('   a direct API call bypassing Angular is refused by Spring (403) and changes nothing', direct.status === 403 && (await prisma.user.findUnique({ where: { id: target.id } })).status === 'ACTIVE', String(direct.status));
  await signOut(browser);
  await browser.go(`${ANGULAR}/admin`, LOGIN_READY);
  check('   a signed-out visitor opening /admin is sent to sign-in with a returnTo', (await path()) === '/login?returnTo=%2Fadmin');

  // Administrator.
  const since = Date.now();
  await signIn(browser, admin.email);
  await browser.waitFor(`location.pathname === '/dashboard'`);
  await browser.go(`${ANGULAR}/admin`, `document.body.innerText.includes('Platform administration')`);
  check('J9. an administrator reaches the administration overview', (await path()) === '/admin');
  await shot(browser, 'J9-admin-overview');
  await browser.go(`${ANGULAR}/admin/users`, `!!document.querySelector('table.data-table')`);
  await browser.setValue('input[type="search"], form input', target.email);
  await browser.clickText('Search');
  await browser.waitFor(`document.querySelectorAll('table.data-table tbody tr').length === 1`);
  await shot(browser, 'J9-admin-users');
  await browser.click(`a[href="/admin/users/${target.id}"]`);
  await browser.waitFor(`document.body.innerText.includes(${JSON.stringify(target.email)}) && !!document.querySelector('select')`);
  const targetToken = await apiLogin(SPRING_API, target.email);
  await browser.setValue('form.card-panel select', 'SUSPENDED');
  await browser.setValue('form.card-panel input', 'Journey policy review');
  await browser.clickText('Change status…');
  await browser.waitFor(`!!document.querySelector('[role="alertdialog"]')`);
  await shot(browser, 'J9-admin-status-dialog');
  await browser.clickText('Change status', DIALOG_BUTTON);
  await browser.waitFor(`${SUCCESS}.length > 0`);
  const suspended = await prisma.user.findUnique({ where: { id: target.id } });
  check('   suspending a user from the detail page updates PostgreSQL', suspended.status === 'SUSPENDED', await browser.evaluate(SUCCESS));
  check('   the suspended user\'s token stops working immediately', (await me(SPRING_API, targetToken)).status === 401);
  check('   the user is notified (captured) and the change is audited', mails(target.email, since).includes('account-suspended') && (await prisma.auditEvent.count({ where: { subjectUserId: target.id, actorUserId: admin.id } })) >= 1, mails(target.email, since).join(', '));
  await browser.setValue('form.card-panel select', 'ACTIVE');
  await browser.setValue('form.card-panel input', 'Review complete');
  await browser.clickText('Change status…');
  await browser.waitFor(`!!document.querySelector('[role="alertdialog"]')`);
  await browser.clickText('Change status', DIALOG_BUTTON);
  await browser.waitFor(`${SUCCESS}.length > 0 && document.body.innerText.includes('Active')`);
  check('   reactivation restores ACTIVE', (await prisma.user.findUnique({ where: { id: target.id } })).status === 'ACTIVE');

  await browser.setValue('form.card-panel:nth-of-type(2) select', 'ADMIN');
  await browser.clickText('Change role…');
  await browser.waitFor(`!!document.querySelector('#role-change-password')`);
  await browser.setValue('#role-change-password', PASSWORD);
  await browser.clickText('Change role', DIALOG_BUTTON);
  await browser.waitFor(`${SUCCESS}.length > 0`);
  check('   promoting with password step-up makes the user an administrator', (await prisma.user.findUnique({ where: { id: target.id } })).role === 'ADMIN', await browser.evaluate(SUCCESS));
  await browser.go(`${ANGULAR}/admin/audit`, `!!document.querySelector('table')`);
  const rows = await browser.evaluate(`document.querySelectorAll('table tbody tr').length`);
  check('   the audit log page lists events', rows > 0, `${rows} rows`);
  await shot(browser, 'J9-admin-audit');

  // Revoked administrator: the promoted user demotes the original admin through the API; the open admin page
  // must lose access on its next navigation.
  const promotedToken = await apiLogin(SPRING_API, target.email);
  const demote = await fetch(`${SPRING_API}/api/admin/users/${admin.id}/role`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${promotedToken}` },
    body: JSON.stringify({ role: 'INVESTOR', password: PASSWORD }),
  });
  check('   another administrator demotes the first one', demote.status === 200, String(demote.status));
  await browser.go(`${ANGULAR}/admin/users`, `location.pathname === '/unauthorized' || location.pathname === '/login'`);
  const landed = await path();
  check('   the demoted administrator can no longer open /admin', landed === '/unauthorized' || landed.startsWith('/login'), landed);
}

async function journeyCrossBackend() {
  const user = await createUser('cross');
  await browser.clearCookies();
  await signIn(browser, user.email, PASSWORD, NEXT);
  await browser.waitFor(`location.pathname === '/dashboard'`, 30000);
  await browser.go(`${ANGULAR}/settings/profile`, `document.querySelector('#firstName')?.value === 'Journey'`);
  check('J10. a NestJS sign-in (Next.js) is resumed by Angular through a Spring refresh', (await path()) === '/settings/profile');
  await browser.go(`${NEXT}/settings/profile`, `document.querySelector('#firstName')?.value === 'Journey'`);
  check('    Next.js resumes again with the cookie Spring rotated', (await path()) === '/settings/profile');
  const live = await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } });
  check('    the round trip keeps a single session', live === 1, `${live}`);
  await browser.go(`${ANGULAR}/settings/profile`, `document.querySelector('#firstName')?.value === 'Journey'`);
  await signOut(browser);
  await browser.go(`${NEXT}/settings/profile`, LOGIN_READY);
  check('    signing out in Angular (Spring) signs the Next.js app (NestJS) out too', (await path()).startsWith('/login'));
  check('    the session is revoked in PostgreSQL', (await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })) === 0);
}

// Every full page load costs one /api/auth/refresh (20 per minute per IP); journeys start a minute apart and any
// rate-limited response is reported rather than silently turning into a signed-out page.
const rateLimited = [];
const watch429 = (tab) => tab.on('Network.responseReceived', ({ response }) => {
  if (response.status === 429) rateLimited.push(new URL(response.url).pathname);
});
watch429(browser);
const openTab = browser.openTab.bind(browser);
browser.openTab = async () => {
  const tab = await openTab();
  watch429(tab);
  return tab;
};
let lastStart = 0;

async function step(name, fn) {
  const wait = lastStart + 61_000 - Date.now();
  if (lastStart && wait > 0) await sleep(wait);
  lastStart = Date.now();
  try {
    await fn();
  } catch (error) {
    check(`${name} aborted: ${error.message}`, false);
    await shot(browser, `${name}-aborted`).catch(() => undefined);
    await browser.clearCookies().catch(() => undefined);
  }
}

try {
  console.log(`Database: ${dbName}`);
  await cleanup();
  await step('J1', journeyRegistration);
  await step('J3', journeyRecovery);
  await step('J5', journeyMfa);
  await step('J6', journeySessions);
  await step('J7', journeyMultiTab);
  await step('J8-9', journeyAdmin);
  await step('J10', journeyCrossBackend);
} finally {
  await sleep(200);
  browser.close();
  await cleanup().catch((e) => check(`cleanup failed: ${e.message}`, false));
  await prisma.$disconnect();
}
if (browser.allPageErrors.length) check('no uncaught page errors', false, browser.allPageErrors.join(' | '));
check('no request was rate-limited during the journeys', rateLimited.length === 0, rateLimited.join(', '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
writeFileSync(join(SHOTS, 'results.json'), JSON.stringify({ ranAt: new Date().toISOString(), database: dbName, results }, null, 2));
process.exit(failed ? 1 : 0);
