#!/usr/bin/env node
/**
 * Browser journey: sign-in, MFA, workspace shell, profile, sessions, sign-out on Angular + Spring.
 *
 * Prerequisites:
 *   - Angular on JOURNEY_ANGULAR_URL (default http://localhost:4200) → Spring API
 *   - DATABASE_URL pointing at a `*_test` database
 *
 *   node scripts/migration/angular-auth-journey.mjs [<screenshot-dir>]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connect, create, VISUAL_EMAIL, VISUAL_MFA_EMAIL, VISUAL_PASSWORD } from '../../apps/api/contract/visual-account.mjs';
import { launchEdge, sleep } from './headless-edge.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const { authenticator } = createRequire(join(ROOT, 'tools/db-harness/package.json'))('otplib');
const ANGULAR = process.env.JOURNEY_ANGULAR_URL ?? 'http://localhost:4200';
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/migration/screenshots/journey');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const { prisma, dbName } = await connect();
mkdirSync(SHOTS, { recursive: true });
const browser = await launchEdge({ port: 9346, name: 'angular-auth-journey' });
const { send, evaluate, waitFor, go, setValue, click, clickText, bodyHas } = browser;
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

async function shot(name) {
  const m = await send('Page.getLayoutMetrics');
  const height = Math.min(Math.ceil(m.cssContentSize.height), 6000);
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.cssLayoutViewport.clientWidth, height, scale: 1 } });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
}
const path = () => evaluate('location.pathname + location.search');
const LOGIN_READY = `!!document.querySelector('#email') && !!document.querySelector('#password')`;
const PROFILE_READY = (first) => `location.pathname === '/settings/profile' && document.querySelector('#firstName')?.value === ${JSON.stringify(first)}`;
const banner = `(document.querySelector('.form-error-banner, [role="alert"]')?.innerText ?? '')`;
async function submitLogin(email, password) {
  await setValue('#email', email);
  await setValue('#password', password);
  await click('form button[type="submit"]');
}
const user = (email) => prisma.user.findUnique({ where: { email }, include: { preferences: true } });

async function run() {
  const totpSecret = await create(prisma);
  await browser.viewport(1440, 900);

  const redirects = [];
  for (const route of ['/settings/profile', '/dashboard', '/trading?symbol=CTB']) {
    await go(`${ANGULAR}${route}`, LOGIN_READY);
    redirects.push(await path());
  }
  check('1. anonymous protected routes redirect to sign-in with a returnTo (omitted for the /dashboard default)', redirects[0] === '/login?returnTo=%2Fsettings%2Fprofile' && redirects[1] === '/login', redirects.join(' , '));

  await go(`${ANGULAR}/login?returnTo=%2Fsettings%2Fprofile`, LOGIN_READY);
  await submitLogin(VISUAL_EMAIL, 'Wrong-Password-1!');
  await waitFor(`${banner}.length > 0 && !document.querySelector('form button[type="submit"]').disabled`);
  const wrong = { text: await evaluate(banner), password: await evaluate(`document.querySelector('#password').value`) };
  check('2. wrong password shows the API error and clears the password field', /invalid email or password/i.test(wrong.text) && wrong.password === '', wrong.text);
  check('   the failed attempt is recorded on the account', (await user(VISUAL_EMAIL)).failedLoginCount === 1);
  await shot('J02-login-error');

  await submitLogin(VISUAL_EMAIL, VISUAL_PASSWORD);
  await waitFor(PROFILE_READY('Visual'));
  const header = await evaluate(`document.querySelector('button[aria-haspopup="menu"]')?.innerText ?? ''`);
  check('3. sign-in returns to /settings/profile with the user in the header', header.includes('Visual Check') && header.includes(VISUAL_EMAIL), header.replace(/\s+/g, ' '));
  check('   the failure counter is reset after a successful sign-in', (await user(VISUAL_EMAIL)).failedLoginCount === 0);
  const tokenStorage = await evaluate(`JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)) + document.cookie`);
  check('   no access or refresh token is readable from storage or document.cookie', !/eyJ|refresh/i.test(tokenStorage));
  await shot('J03-profile');

  await setValue('#firstName', 'Visia');
  await setValue('#preferredCurrency', 'USD');
  await click('input[name="reduceMotion"]');
  await clickText('Save profile');
  await waitFor(bodyHas('Profile updated.'));
  const saved = await user(VISUAL_EMAIL);
  check('4. saving shows "Profile updated." and persists name, currency and accessibility preference', saved.firstName === 'Visia' && saved.preferences.preferredCurrency === 'USD' && saved.preferences.reduceMotion === true, `${saved.firstName} ${saved.preferences.preferredCurrency} reduceMotion=${saved.preferences.reduceMotion}`);
  check('   the reduce-motion preference is applied to the document', await evaluate(`document.documentElement.hasAttribute('data-reduce-motion')`));
  await shot('J04-profile-saved');

  await go(`${ANGULAR}/settings/profile`, PROFILE_READY('Visia'));
  check('5. reload restores the session without signing in again', (await path()) === '/settings/profile');

  await click('aside a[href="/dashboard"]');
  await waitFor(`location.pathname === '/dashboard' && !!document.querySelector('header nav[aria-label="Breadcrumb"]')`);
  const crumbs = await evaluate(`[...document.querySelectorAll('header nav[aria-label="Breadcrumb"] li')].map((l) => l.innerText.trim())`);
  check('6. Overview dashboard is live from the sidebar (not a migration placeholder)', crumbs.at(-1) === 'Overview' && !(await evaluate(bodyHas('not been migrated'))), crumbs.join(' / '));
  await shot('J06-dashboard');

  const sessionsBefore = await prisma.authSession.findMany({ where: { user: { email: VISUAL_EMAIL }, revokedAt: null } });
  check('7. a single live session is active after sign-in', sessionsBefore.length === 1, `${sessionsBefore.length} active session(s)`);

  await click('button[aria-haspopup="menu"]');
  await waitFor(`!!document.querySelector('[role="menu"]')`);
  await clickText('Sign out');
  await waitFor(`location.pathname === '/login' && ${LOGIN_READY}`);
  const revoked = await prisma.authSession.findUnique({ where: { id: sessionsBefore[0]?.id ?? '00000000-0000-0000-0000-000000000000' } });
  check('8. sign-out returns to /login and revokes the session in PostgreSQL', !!revoked?.revokedAt, revoked?.revokedReason ?? 'not revoked');
  await go(`${ANGULAR}/settings/profile`, LOGIN_READY);
  check('   the profile page is protected again after sign-out', (await path()).startsWith('/login'));

  await go(`${ANGULAR}/login`, LOGIN_READY);
  await submitLogin(VISUAL_MFA_EMAIL, VISUAL_PASSWORD);
  await waitFor(`!!document.querySelector('#code')`);
  check('9. an MFA account is asked for a second step', await evaluate(bodyHas('Two-step verification')));
  await shot('J09-mfa');
  await setValue('#code', '000000');
  await clickText('Verify and continue');
  await waitFor(`${LOGIN_READY} && ${banner}.length > 0`);
  check('   a wrong code returns to the password step with an explanation', /not accepted/i.test(await evaluate(banner)), await evaluate(banner));
  await submitLogin(VISUAL_MFA_EMAIL, VISUAL_PASSWORD);
  await waitFor(`!!document.querySelector('#code')`);
  await setValue('#code', authenticator.generate(totpSecret));
  await clickText('Verify and continue');
  await waitFor(`location.pathname === '/dashboard' && !!document.querySelector('header nav[aria-label="Breadcrumb"]')`);
  check('   a valid authenticator code signs in and opens the default workspace page', (await path()) === '/dashboard');
  const audits = await prisma.auditEvent.findMany({ where: { subject: { email: VISUAL_MFA_EMAIL } }, orderBy: { createdAt: 'asc' } });
  const trail = audits.map((a) => a.eventType + (a.context?.mfa ? '(mfa)' : ''));
  check('   the MFA attempts are audited', trail.includes('MFA_LOGIN_FAILURE') && trail.includes('LOGIN_SUCCESS(mfa)'), trail.join(', '));

  await browser.viewport(375, 812);
  await click('button[aria-label="Open navigation"]');
  await waitFor(`!!document.querySelector('[role="dialog"][aria-label="Navigation"]')`);
  await shot('J10-mobile-drawer');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`!document.querySelector('[role="dialog"][aria-label="Navigation"]')`);
  check('10. the mobile drawer opens and closes with Escape', true);
  const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check('    no horizontal overflow at 375px', overflow <= 1, `${overflow}px`);
}

try {
  console.log(`Database: ${dbName}`);
  await run();
} catch (error) {
  check(`journey aborted: ${error.message}`, false);
} finally {
  await sleep(200);
  browser.close();
  await create(prisma).catch((e) => check(`restoring the visual accounts failed: ${e.message}`, false));
  await prisma.$disconnect();
}
if (browser.pageErrors.length) check('no uncaught page errors', false, browser.pageErrors.join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
