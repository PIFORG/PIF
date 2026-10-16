#!/usr/bin/env node
/**
 * Browser end-to-end test for the transactional email flows (headless Microsoft Edge via CDP).
 *
 * Prerequisites (development only):
 *   - API running with MAIL_TRANSPORT=preview   (npm run dev:api)
 *   - Web running                               (npm run dev:web)
 *   - Preview inbox running                     (npm run mail:inbox)
 *
 *   npm run test:e2e:email [-- <screenshot-dir>]
 *
 * Uses freshly generated throwaway @example.test accounts with random passwords that are never
 * printed. Links are read from the local preview folder exactly as a user would open them from
 * the message. Exits non-zero when any check fails.
 */
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
const INBOX = process.env.E2E_INBOX_URL ?? 'http://127.0.0.1:3025';
const PREVIEW_DIR = resolve(ROOT, 'apps/api', process.env.MAIL_PREVIEW_DIR ?? '.mail-preview');
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/transactional-email/screenshots');
const EDGE =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9341;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomPassword() {
  return `${randomBytes(9).toString('base64url')}a7!`;
}
function throwaway(tag) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `e2e-${tag}-${stamp}-${randomBytes(3).toString('hex')}@example.test`;
}

async function api(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: WEB,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: json };
}

function mailsFor(to, template, since = 0) {
  if (!existsSync(PREVIEW_DIR)) return [];
  return readdirSync(PREVIEW_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(PREVIEW_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((m) => m && m.to === to && m.template === template && Date.parse(m.createdAt) >= since)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((m) => ({
      ...m,
      text: readFileSync(join(PREVIEW_DIR, `${m.id}.txt`), 'utf8'),
      html: readFileSync(join(PREVIEW_DIR, `${m.id}.html`), 'utf8'),
      eml: readFileSync(join(PREVIEW_DIR, `${m.id}.eml`), 'utf8'),
    }));
}

async function waitForMail(to, template, since, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = mailsFor(to, template, since);
    if (found.length) return found[found.length - 1];
    await sleep(250);
  }
  throw new Error(`No "${template}" email captured within ${timeout} ms`);
}

function linkIn(mail, path) {
  const m = new RegExp(`${WEB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${path}\\?token=[A-Za-z0-9_%-]+`).exec(mail.text);
  if (!m) throw new Error(`No ${path} link in ${mail.template}`);
  return m[0];
}

function totp(base32Secret, stepOffset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of base32Secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', bytes).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

// ---------- headless Edge ----------
mkdirSync(SHOTS, { recursive: true });
const profile = join(tmpdir(), `mtrs-email-e2e-${Date.now()}`);
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-extensions',
  // Keep the sandboxed preview frame in-process so the test can locate the CTA inside it.
  '--disable-site-isolation-trials',
  '--disable-features=IsolateOrigins,site-per-process',
  '--window-size=1280,900',
  'about:blank',
]);

async function cdpJson(path) {
  for (let i = 0; i < 60; i += 1) {
    try {
      return await (await fetch(`http://127.0.0.1:${CDP_PORT}${path}`)).json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Edge did not start');
}
const page = (await cdpJson('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: ok, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(msg.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
  }
});
const send = (method, params = {}) =>
  new Promise((ok, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: ok, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
async function waitFor(expression, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression).catch(() => false)) return true;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

async function go(url, ready) {
  await send('Page.navigate', { url });
  await waitFor(`document.readyState === 'complete'`);
  if (ready) await waitFor(ready);
  await sleep(400);
}
async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}
async function shot(name, { full = true } = {}) {
  // Screenshots are documentation artefacts: never let a token value appear in them.
  await evaluate(`(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      n.nodeValue = n.nodeValue.replace(/token=[A-Za-z0-9_%-]+/g, 'token=[redacted]');
    }
    document.querySelectorAll('a[href*="token="]').forEach((a) => a.setAttribute('href', '#redacted'));
    return true;
  })()`);
  const m = await send('Page.getLayoutMetrics');
  const width = m.cssLayoutViewport.clientWidth;
  const height = full ? Math.min(Math.ceil(m.cssContentSize.height), 4000) : m.cssLayoutViewport.clientHeight;
  const res = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
}
const bodyHas = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
async function fill(name, value) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector('input[name=${JSON.stringify(name)}]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Input ${name} not found`);
}
async function clickButton(label) {
  const ok = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(label)});
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Button "${label}" not found or disabled`);
}
async function clearSession() {
  await send('Network.clearBrowserCookies');
  await go(`${WEB}/`, null);
}

async function run() {
  // 0. Token pages never leak the URL through Referer and are not cached.
  for (const path of ['/verify-email', '/reset-password', '/confirm-email-change']) {
    const res = await fetch(`${WEB}${path}`);
    check(
      `${path} sends Referrer-Policy: no-referrer and Cache-Control: no-store`,
      res.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(res.headers.get('cache-control') ?? ''),
      `${res.status} ${res.headers.get('referrer-policy')} / ${res.headers.get('cache-control')}`,
    );
  }

  // 1. Registration through the real UI.
  const email = throwaway('verify');
  let password = randomPassword();
  const t0 = Date.now() - 1000;
  await viewport(1280, 900);
  await go(`${WEB}/register`, `!!document.querySelector('input[name="firstName"]')`);
  await fill('firstName', 'Nadia');
  await fill('lastName', 'Tester');
  await fill('email', email);
  await fill('password', password);
  await fill('confirmPassword', password);
  await clickButton('Create investor account');
  await waitFor(bodyHas('you will receive a verification message shortly'));
  check('register form shows the generic confirmation', true);

  const verifyMail = await waitForMail(email, 'verify-email', t0);
  check('verification email captured to local preview from a real registration', true, verifyMail.id);
  check('message is RFC 5322 multipart/alternative (HTML + text)',
    /^Subject: Verify your email for MTRS/m.test(verifyMail.eml) && /multipart\/alternative/.test(verifyMail.eml) &&
      /text\/plain/.test(verifyMail.eml) && /text\/html/.test(verifyMail.eml));
  check('expiry and single-use copy match the configured 60-minute TTL',
    verifyMail.text.includes('This link expires in 1 hour and can be used only once.'));
  check('greeting uses the registered first name', verifyMail.text.startsWith('Hi Nadia,'));
  check('no TaxGain branding anywhere in the message', !/taxgain/i.test(verifyMail.eml + verifyMail.html));
  const verifyLink = linkIn(verifyMail, '/verify-email');
  check('verification link targets APP_FRONTEND_URL /verify-email', verifyLink.startsWith(`${WEB}/verify-email?token=`));

  // Rendered email screenshots (desktop + mobile) through the loopback preview inbox.
  await go(`${INBOX}/`, bodyHas('MTRS preview inbox'));
  await shot('00-preview-inbox', { full: false });

  // A real mouse click on the CTA inside the sandboxed preview frame opens the app in a new tab.
  await go(`${INBOX}/m/${verifyMail.id}`, `!!document.querySelector('iframe')`);
  await sleep(1000);
  const frame = (await send('Page.getFrameTree')).frameTree.childFrames?.[0]?.frame;
  const world = (await send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'e2e' })).executionContextId;
  const cta = (await send('Runtime.evaluate', {
    contextId: world,
    returnByValue: true,
    expression: `(() => { const a = [...document.querySelectorAll('a')].find((x) => x.textContent.trim() === 'Confirm email address'); const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  })).result.value;
  const box = await evaluate(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.x + 1, y: r.y + 1 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: box.x + cta.x, y: box.y + cta.y, button: 'left', clickCount: 1 });
  }
  let opened = null;
  for (let i = 0; i < 40 && !opened; i += 1) {
    await sleep(250);
    opened = (await cdpJson('/json/list')).find((t) => t.type === 'page' && t.url.startsWith(`${WEB}/verify-email`));
  }
  check('clicking the CTA in the preview inbox opens /verify-email in a new tab', !!opened);
  if (opened) await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${opened.id}`);
  await go(`${INBOX}/m/${verifyMail.id}/html`, `!!document.querySelector('h1')`);
  await shot('01-verify-email-desktop');
  await viewport(390, 844);
  await go(`${INBOX}/m/${verifyMail.id}/html`, `!!document.querySelector('h1')`);
  await shot('02-verify-email-mobile');
  await viewport(1280, 900);

  // 2. A link scanner fetching the URL must not verify the account.
  const scan = await fetch(verifyLink);
  check('verification URL returns the page (not 404)', scan.status === 200, `HTTP ${scan.status}`);
  let login = await api('POST', '/auth/login', { email, password });
  check('GET of the link does not consume the token (login still EMAIL_NOT_VERIFIED)',
    login.body?.errorCode === 'EMAIL_NOT_VERIFIED', `HTTP ${login.status} ${login.body?.errorCode}`);

  // 3. Login UI before verification offers resend.
  await go(`${WEB}/login`, `!!document.querySelector('input[name="email"]')`);
  await fill('email', email);
  await fill('password', password);
  await clickButton('Sign in');
  await waitFor(bodyHas('Your email is not verified yet'));
  check('login page explains EMAIL_NOT_VERIFIED and offers resend',
    await evaluate(bodyHas('Resend verification email')));

  // 4. Open the link, token is stripped, nothing happens until Confirm.
  await go(verifyLink, bodyHas('Confirm email verification'));
  const search = await evaluate('location.search');
  check('token is removed from the address bar on load', !search.includes('token'), `search="${search}"`);
  await shot('03-verify-page-before-confirm');
  await clickButton('Confirm email verification');
  await waitFor(bodyHas('Email verified successfully'));
  await shot('04-verify-page-confirmed');
  check('token survived the scanner GET and page load; Confirm POST verifies the email', true);
  const welcome = await waitForMail(email, 'welcome', t0);
  check('welcome email sent after verification', /^Subject: Your MTRS account is ready/m.test(welcome.eml));

  // 5. Reuse is rejected.
  await go(verifyLink, bodyHas('Confirm email verification'));
  await clickButton('Confirm email verification');
  await waitFor(bodyHas('invalid, has expired or was already used'));
  check('reusing the verification link is rejected', true);

  // 6. Login works after verification.
  await go(`${WEB}/login`, `!!document.querySelector('input[name="email"]')`);
  await fill('email', email);
  await fill('password', password);
  await clickButton('Sign in');
  await waitFor(`location.pathname === '/dashboard'`, 30000);
  check('login succeeds after verification and lands on /dashboard', true);
  await clearSession();

  // 7. Resend cooldown and concurrency on a second, unverified account.
  const email2 = throwaway('race');
  const password2 = randomPassword();
  const t1 = Date.now() - 1000;
  const reg2 = await api('POST', '/auth/register', {
    email: email2, password: password2, passwordConfirmation: password2, firstName: 'Race', lastName: 'Tester',
  });
  check('API registration returns the generic message', reg2.status === 201);
  const firstMail = await waitForMail(email2, 'verify-email', t1);
  const resend = await api('POST', '/auth/resend-verification', { email: email2 });
  const resendUnknown = await api('POST', '/auth/resend-verification', { email: throwaway('nobody') });
  await sleep(1500);
  check('resend inside the cooldown sends nothing new', mailsFor(email2, 'verify-email', t1).length === 1);
  check('resend response is identical for known and unknown addresses',
    resend.status === resendUnknown.status && resend.body?.message === resendUnknown.body?.message);
  const raceToken = decodeURIComponent(linkIn(firstMail, '/verify-email').split('token=')[1]);
  const race = await Promise.all(
    Array.from({ length: 5 }, () => api('POST', '/auth/verify-email', { token: raceToken })),
  );
  const winners = race.filter((r) => r.status === 200).length;
  check('5 concurrent confirmations of one token: exactly one succeeds', winners === 1,
    `statuses=${race.map((r) => r.status).join(',')}`);

  // 8. Forgot password -> reset (UI) -> password-changed email.
  const t2 = Date.now() - 1000;
  await go(`${WEB}/forgot-password`, `!!document.querySelector('input[name="email"]')`);
  await fill('email', email);
  await clickButton('Send reset link');
  await waitFor(bodyHas('password reset instructions have been sent'));
  const unknownForgot = await api('POST', '/auth/forgot-password', { email: throwaway('ghost') });
  check('forgot-password response is generic for unknown addresses', unknownForgot.status === 200);
  const resetMail = await waitForMail(email, 'reset-password', t2);
  check('reset email states the configured 30-minute expiry',
    resetMail.text.includes('This link expires in 30 minutes and can be used only once.'));
  const resetLink = linkIn(resetMail, '/reset-password');
  await go(resetLink, bodyHas('Confirm reset handoff'));
  check('reset page strips the token from the URL', !(await evaluate('location.search')).includes('token'));
  await clickButton('Confirm reset handoff');
  await waitFor(`!!document.querySelector('input[name="password"]')`);
  const oldPassword = password;
  password = randomPassword();
  await fill('password', password);
  await fill('confirmPassword', password);
  await clickButton('Update password');
  await waitFor(bodyHas('Password updated'));
  check('password reset completes once', true);
  const changedAfterReset = await waitForMail(email, 'password-changed', t2);
  check('password-changed email after reset says every device was signed out',
    changedAfterReset.text.includes('Every device was signed out'));
  const reusePassword = randomPassword();
  const reuseReset = await api('POST', '/auth/reset-password', {
    token: decodeURIComponent(resetLink.split('token=')[1]),
    password: reusePassword,
    passwordConfirmation: reusePassword,
  });
  check('reusing the reset link is rejected', reuseReset.body?.errorCode === 'TOKEN_INVALID',
    `HTTP ${reuseReset.status} ${reuseReset.body?.errorCode}`);
  const oldLogin = await api('POST', '/auth/login', { email, password: oldPassword });
  check('old password no longer works', oldLogin.status === 401);
  login = await api('POST', '/auth/login', { email, password });
  check('new password works', login.status === 200 && !!login.body?.accessToken);
  let access = login.body?.accessToken;

  // 9. MFA notices never contain secrets or recovery codes.
  const t3 = Date.now() - 1000;
  const setup = await api('POST', '/auth/mfa/setup', { password }, access);
  const secret = setup.body?.secret;
  const enable = await api('POST', '/auth/mfa/enable', { totpCode: totp(secret) }, access);
  check('MFA enabled with a real TOTP code', enable.status === 200 || enable.status === 201, `HTTP ${enable.status}`);
  const codes = enable.body?.recoveryCodes ?? [];
  const mfaOn = await waitForMail(email, 'mfa-enabled', t3);
  const regen = await api('POST', '/auth/mfa/recovery-codes/regenerate', { password, totpCode: totp(secret, 1) }, access);
  check('recovery codes regenerated with step-up', regen.status === 200, `HTTP ${regen.status}`);
  const regenMail = await waitForMail(email, 'mfa-recovery-codes-regenerated', t3);
  const allCodes = [...codes, ...(regen.body?.recoveryCodes ?? [])];
  const leaks = (m) => allCodes.some((c) => m.eml.includes(c)) || (secret && m.eml.includes(secret));
  check('mfa-enabled email contains no secret or recovery code', !leaks(mfaOn));
  check('recovery-codes email contains no secret or recovery code', !leaks(regenMail));
  // Each TOTP step is accepted once; wait for the next window before disabling.
  const waitMs = 30_000 - (Date.now() % 30_000) + 1500;
  await sleep(waitMs);
  const disable = await api('POST', '/auth/mfa/disable', { password, totpCode: totp(secret, 1) }, access);
  check('MFA disabled with step-up', disable.status === 200, `HTTP ${disable.status} ${disable.body?.errorCode ?? ''}`);
  const mfaOff = await waitForMail(email, 'mfa-disabled', t3);
  check('mfa-disabled email contains no secret or recovery code', !leaks(mfaOff));
  const stale = await api('GET', '/auth/me', undefined, access);
  check('disabling MFA invalidates the previous access token (security version bump)', stale.status === 401);
  login = await api('POST', '/auth/login', { email, password });
  access = login.body?.accessToken;

  // 10. Password change (signed in) uses the "other devices" wording.
  const t4 = Date.now() - 1000;
  const nextPassword = randomPassword();
  const change = await api('POST', '/auth/change-password', {
    currentPassword: password, newPassword: nextPassword, newPasswordConfirmation: nextPassword,
  }, access);
  check('signed-in password change succeeds', change.status === 200, `HTTP ${change.status}`);
  password = nextPassword;
  const changedMail = await waitForMail(email, 'password-changed', t4);
  check('password-changed email after a signed-in change says other devices were signed out',
    changedMail.text.includes('Other devices were signed out'));
  login = await api('POST', '/auth/login', { email, password });
  access = login.body?.accessToken;

  // 11. Email change: link to the new address, alert to the old, completion notices to both.
  const t5 = Date.now() - 1000;
  const newEmail = throwaway('moved');
  const req = await api('POST', '/auth/change-email/request', { password, newEmail }, access);
  check('email change request accepted (generic)', req.status === 200, `HTTP ${req.status}`);
  const confirmMail = await waitForMail(newEmail, 'email-change-confirm', t5);
  const alertMail = await waitForMail(email, 'email-change-requested', t5);
  check('old address is alerted with a masked target', /ne\*\*\*@example\.test|e2\*\*\*@example\.test/.test(alertMail.text)
    && !alertMail.eml.includes(newEmail));
  const confirmLink = linkIn(confirmMail, '/confirm-email-change');
  const scanChange = await fetch(confirmLink);
  check('email-change URL returns the page (not 404)', scanChange.status === 200, `HTTP ${scanChange.status}`);
  await go(confirmLink, bodyHas('Confirm new email'));
  check('confirm-email-change page strips the token', !(await evaluate('location.search')).includes('token'));
  await clickButton('Confirm new email');
  await waitFor(bodyHas('Your email address was changed'));
  check('token survived the scanner GET; email change confirmed by POST', true);
  const toOld = await waitForMail(email, 'email-changed-old', t5);
  const toNew = await waitForMail(newEmail, 'email-changed-new', t5);
  check('completion notices sent to old and new addresses', !!toOld && !!toNew);
  check('old-address notice does not tell the victim to use a reset link that now goes elsewhere',
    toOld.text.includes('password reset links now go to the new address'));
  const oldEmailLogin = await api('POST', '/auth/login', { email, password });
  const newEmailLogin = await api('POST', '/auth/login', { email: newEmail, password });
  check('sign-in moves to the new address', oldEmailLogin.status === 401 && newEmailLogin.status === 200,
    `old=${oldEmailLogin.status} new=${newEmailLogin.status}`);

  // Remaining rendered samples for the report.
  for (const [mail, name] of [[resetMail, '05-reset-password-email'], [changedAfterReset, '06-password-changed-email'],
    [confirmMail, '07-email-change-confirm-email'], [toOld, '08-email-changed-old-address'], [mfaOn, '09-mfa-enabled-email'],
    [welcome, '10-welcome-email']]) {
    await go(`${INBOX}/m/${mail.id}/html`, `!!document.querySelector('h1')`);
    await shot(name);
  }

  check('no uncaught page errors during the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
}

let crashed = null;
try {
  await run();
} catch (err) {
  crashed = err;
  check('run completed without an unexpected error', false, err instanceof Error ? err.message : String(err));
} finally {
  ws.close();
  edge.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Edge may still hold the profile briefly */
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${SHOTS}`);
process.exit(failed || crashed ? 1 : 0);
