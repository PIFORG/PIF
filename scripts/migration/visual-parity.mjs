#!/usr/bin/env node
/**
 * Side-by-side visual parity check of the migrated screens: the existing Next.js app (reference) and the
 * Angular app, driven through the same scenarios in headless Microsoft Edge over the DevTools protocol.
 *
 * Prerequisites (development only, both APIs on a `_test` database):
 *   - Next.js on VISUAL_NEXT_URL (default http://localhost:3000) using the NestJS API
 *   - Angular on VISUAL_ANGULAR_URL (default http://localhost:4200) using the Spring API
 *   - the disposable accounts from apps/api/contract/visual-account.mjs
 *
 *   node scripts/migration/visual-parity.mjs [<output-dir>]
 *
 * VISUAL_ONLY=identity|trading|learning|actuarial runs one group of scenarios. The trading group also needs the Spring API on
 * VISUAL_SPRING_API_URL (default http://localhost:3002): the trader account's portfolio is opened and traded once,
 * through the Spring API only, and both apps afterwards only read it (it never keeps a working order, so neither
 * backend's read path writes). The script checks that the stored portfolio is unchanged after the captures.
 *
 * For every scenario and viewport it writes <name>-next.png, <name>-angular.png and <name>-diff.png
 * (differing pixels in red over a dimmed reference) plus visual-parity-report.json. No e-mail is sent:
 * the scenarios only sign in existing accounts and use an unknown address for the error state.
 * Exits non-zero when a scenario fails to render or a page overflows horizontally.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  connect,
  ensureTrader,
  VISUAL_ADMIN_EMAIL as ADMIN_EMAIL,
  VISUAL_EMAIL as EMAIL,
  VISUAL_MFA_EMAIL as MFA_EMAIL,
  VISUAL_PASSWORD as PASSWORD,
  VISUAL_TRADER_EMAIL as TRADER_EMAIL,
  VISUAL_UNKNOWN_EMAIL,
} from '../../apps/api/contract/visual-account.mjs';
import { launchEdge, sleep } from './headless-edge.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const APPS = {
  next: process.env.VISUAL_NEXT_URL ?? 'http://localhost:3000',
  angular: process.env.VISUAL_ANGULAR_URL ?? 'http://localhost:4200',
};
const SPRING_API = process.env.VISUAL_SPRING_API_URL ?? 'http://localhost:3002';
const ONLY = process.env.VISUAL_ONLY ?? 'all';
if (!['all', 'identity', 'trading', 'learning', 'actuarial'].includes(ONLY)) {
  throw new Error('VISUAL_ONLY must be identity, trading, learning or actuarial');
}
const OUT = resolve(ROOT, process.argv[2] ?? 'docs/migration/screenshots');
const VIEWPORTS = { 1440: [1440, 900], 768: [768, 1024], 375: [375, 812] };
/** A channel difference above this counts as a differing pixel (absorbs sub-pixel anti-aliasing noise). */
const CHANNEL_TOLERANCE = 32;

mkdirSync(OUT, { recursive: true });
const { prisma } = await connect();
const browser = await launchEdge({ port: 9345, name: 'visual-parity' });
const { send, evaluate, waitFor, go, setValue, click } = browser;
await send('Emulation.setEmulatedMedia', {
  features: [
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-color-scheme', value: 'light' },
  ],
});

let themeScript = null;
async function useTheme(theme) {
  if (themeScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: themeScript });
  themeScript = (
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('mtrs-theme', ${JSON.stringify(theme)}); localStorage.removeItem('mtrs-sidebar-collapsed'); } catch {}`,
    })
  ).identifier;
}
const viewport = (width) => browser.viewport(...VIEWPORTS[width]);

/** Lets fonts and layout settle and hides the dev-only Next.js overlay before a capture. */
async function settle() {
  await evaluate(`(async () => {
    if (!document.getElementById('pif-visual-parity')) {
      const style = document.createElement('style');
      style.id = 'pif-visual-parity';
      style.textContent = 'nextjs-portal { display: none !important; } * { caret-color: transparent !important; }';
      document.head.appendChild(style);
    }
    document.activeElement?.blur?.();
    await document.fonts.ready;
    return true;
  })()`);
  await sleep(400);
}
async function capture() {
  await settle();
  const m = await send('Page.getLayoutMetrics');
  const width = m.cssLayoutViewport.clientWidth;
  const height = Math.min(Math.ceil(m.cssContentSize.height), 6000);
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
  const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  return { data: res.data, width, height, overflow };
}

/** Pixel comparison runs in the page itself: both captures are data URLs, so the canvas is never tainted. */
async function diff(a, b) {
  return evaluate(`(async () => {
    const load = (d) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = 'data:image/png;base64,' + d; });
    const [ia, ib] = await Promise.all([load(${JSON.stringify(a.data)}), load(${JSON.stringify(b.data)})]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const read = (img) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
    const da = read(ia), db = read(ib);
    const out = new ImageData(w, h);
    let differing = 0, exact = 0, maxDelta = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    for (let i = 0; i < da.data.length; i += 4) {
      const delta = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
      if (delta > 0) exact += 1;
      if (delta > maxDelta) maxDelta = delta;
      if (delta > ${CHANNEL_TOLERANCE}) {
        differing += 1;
        const p = i / 4, x = p % w, y = (p - x) / w;
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        out.data.set([255, 0, 0, 255], i);
      } else {
        const g = Math.round((da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3);
        out.data.set([g, g, g, 64], i);
      }
    }
    const c = new OffscreenCanvas(w, h); c.getContext('2d').putImageData(out, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {
      comparedArea: w + 'x' + h,
      differingPixels: differing,
      differingPercent: Math.round((differing / (w * h)) * 100000) / 1000,
      exactlyDifferingPixels: exact,
      maxChannelDelta: maxDelta,
      differenceBox: differing ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
      png: btoa(bin),
    };
  })()`);
}

/**
 * Screens that show live data (audit counts, session totals, sign-in times) change between the two captures,
 * because signing in to the second app adds data. For scenarios with `replayApi`, the JSON bodies NestJS returns
 * to Next.js for matching requests are recorded, and the Angular capture renders those same bodies. Spring is
 * still called, and a body is only substituted when Spring answered with the same status; Spring's own headers
 * are kept. Response equality itself is covered by the differential contract suites, not by this script.
 */
const replay = { app: null, bodies: new Map(), replayed: 0, mismatches: [] };
/**
 * Loading and error states: matching API requests are either held unanswered until the capture is done, or
 * answered in the browser with the same 503 body in both apps. Neither backend sees those requests.
 */
const intercept = { mode: null, match: null, held: [] };
const UNAVAILABLE = { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again shortly.' };
browser.on('Fetch.requestPaused', async ({ requestId, request, responseStatusCode, responseHeaders }) => {
  try {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}${url.search}`;
    if (responseStatusCode === undefined && request.method !== 'OPTIONS' && intercept.mode && intercept.match.test(url.pathname)) {
      if (intercept.mode === 'hold') {
        intercept.held.push(requestId);
        return;
      }
      const origin = Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'origin')?.[1] ?? '*';
      await send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 503,
        responseHeaders: [
          { name: 'content-type', value: 'application/json' },
          { name: 'access-control-allow-origin', value: origin },
          { name: 'access-control-allow-credentials', value: 'true' },
        ],
        body: Buffer.from(JSON.stringify(UNAVAILABLE)).toString('base64'),
      });
      return;
    }
    if (responseStatusCode === undefined || request.method === 'OPTIONS') {
      await send('Fetch.continueRequest', { requestId });
    } else if (replay.app === 'next') {
      const { body, base64Encoded } = await send('Fetch.getResponseBody', { requestId });
      replay.bodies.set(key, { status: responseStatusCode, body: base64Encoded ? body : Buffer.from(body).toString('base64') });
      await send('Fetch.continueRequest', { requestId });
    } else {
      const recorded = replay.bodies.get(key);
      if (!recorded || recorded.status !== responseStatusCode) {
        replay.mismatches.push(`${key}: Spring ${responseStatusCode}, NestJS ${recorded?.status ?? 'not requested'}`);
        await send('Fetch.continueRequest', { requestId });
        return;
      }
      const headers = responseHeaders.filter((h) => !['content-length', 'content-encoding', 'etag'].includes(h.name.toLowerCase()));
      await send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode, responseHeaders: headers, body: recorded.body });
      replay.replayed += 1;
    }
  } catch (error) {
    replay.mismatches.push(`interception error: ${error.message}`);
    await send('Fetch.continueRequest', { requestId }).catch(() => {});
  }
});
async function startInterception(app, replayApi, interceptApi) {
  replay.app = app;
  if (app === 'next') replay.bodies.clear();
  intercept.mode = interceptApi?.mode ?? null;
  intercept.match = interceptApi?.match ?? null;
  intercept.held = [];
  await send('Fetch.enable', {
    patterns: [
      ...(replayApi ?? []).map((urlPattern) => ({ urlPattern, requestStage: 'Response' })),
      ...(interceptApi ? [{ urlPattern: '*/api/*', requestStage: 'Request' }] : []),
    ],
  });
}
async function stopInterception() {
  intercept.mode = null;
  for (const requestId of intercept.held.splice(0)) await send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => {});
  await send('Fetch.disable');
}

const report = [];
let failures = 0;
/**
 * Runs `prepare` on each app (it must leave the page in the state to capture), then captures every
 * requested width.
 */
async function scenario(name, { theme = 'light', widths = [1440, 768, 375], prepare, replayApi, interceptApi, angularCheck }) {
  await useTheme(theme);
  const shots = { next: {}, angular: {} };
  const checks = {};
  replay.replayed = 0;
  replay.mismatches = [];
  const intercepting = !!(replayApi || interceptApi);
  for (const app of ['next', 'angular']) {
    try {
      await viewport(widths[0]);
      if (intercepting) await startInterception(app, replayApi, interceptApi);
      await prepare(APPS[app]);
      for (const width of widths) {
        await viewport(width);
        shots[app][width] = await capture();
        if (app === 'angular' && angularCheck) checks[width] = await evaluate(angularCheck);
      }
    } catch (error) {
      failures += 1;
      report.push({ scenario: name, theme, app, error: error.message });
      console.log(`FAIL  ${name} (${app}): ${error.message}`);
    } finally {
      if (intercepting) await stopInterception();
    }
  }
  if (replayApi) {
    console.log(`      ${name}: ${replay.replayed} NestJS response bodies replayed to Angular` +
      `${replay.mismatches.length ? `; not replayed: ${replay.mismatches.join(' | ')}` : ''}`);
  }
  for (const width of widths) {
    const a = shots.next[width];
    const b = shots.angular[width];
    if (!a || !b) continue;
    const file = `${name}-${theme}-${width}`;
    writeFileSync(join(OUT, `${file}-next.png`), Buffer.from(a.data, 'base64'));
    writeFileSync(join(OUT, `${file}-angular.png`), Buffer.from(b.data, 'base64'));
    const { png, ...d } = await diff(a, b);
    writeFileSync(join(OUT, `${file}-diff.png`), Buffer.from(png, 'base64'));
    const checkProblem = checks[width] || null;
    const overflowOk = a.overflow <= 1 && b.overflow <= 1 && !checkProblem;
    if (!overflowOk) failures += 1;
    const entry = {
      scenario: name,
      theme,
      width,
      nextSize: `${a.width}x${a.height}`,
      angularSize: `${b.width}x${b.height}`,
      sameSize: a.width === b.width && a.height === b.height,
      horizontalOverflow: { next: a.overflow, angular: b.overflow },
      ...(angularCheck ? { angularCheck: checkProblem ?? 'passed' } : {}),
      ...(replayApi ? { replayedApiBodies: replay.replayed, replayMismatches: replay.mismatches } : {}),
      ...(interceptApi ? { simulatedApiState: interceptApi.mode === 'hold' ? 'requests held (loading)' : 'HTTP 503 (error)' } : {}),
      ...d,
    };
    report.push(entry);
    console.log(
      `${overflowOk ? 'DONE' : 'FAIL'}  ${file}: ${d.differingPercent}% pixels differ beyond tolerance` +
        ` (${d.exactlyDifferingPixels} px differ at all, max channel delta ${d.maxChannelDelta})` +
        `${entry.sameSize ? '' : ` sizes ${entry.nextSize} vs ${entry.angularSize}`}` +
        `${checkProblem ? ` check: ${checkProblem}` : ''}` +
        `${d.differenceBox ? ` box ${JSON.stringify(d.differenceBox)}` : ''}`,
    );
  }
}

const LOGIN_READY = `!!document.querySelector('#email') && !!document.querySelector('#password')`;
async function openLogin(base) {
  await browser.clearCookies();
  await go(`${base}/login`, LOGIN_READY);
}
/**
 * Both APIs allow 10 sign-ins per minute per IP and 20 per account per 15 minutes; stay below both per app.
 * The account budget only knows this run, so full runs stay 15 minutes apart.
 */
const signIns = { [APPS.next]: [], [APPS.angular]: [] };
const ACCOUNT_WINDOW = 15 * 60_000 + 5_000;
async function signInBudget(base, email) {
  const recent = signIns[base].filter((s) => Date.now() - s.at < 61_000);
  if (recent.length >= 8) {
    const wait = 61_000 - (Date.now() - recent[0].at) + 250;
    console.log(`… waiting ${Math.ceil(wait / 1000)} s for the sign-in rate limit`);
    await sleep(wait);
  }
  const account = signIns[base].filter((s) => s.email === email && Date.now() - s.at < ACCOUNT_WINDOW);
  if (account.length >= 18) {
    const wait = ACCOUNT_WINDOW - (Date.now() - account[0].at);
    console.log(`… waiting ${Math.ceil(wait / 1000)} s for the per-account sign-in limit of ${email}`);
    await sleep(wait);
  }
  signIns[base].push({ at: Date.now(), email });
}
async function signIn(base, email, returnTo) {
  await signInBudget(base, email);
  await browser.clearCookies();
  await go(`${base}/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`, LOGIN_READY);
  await setValue('#email', email);
  await setValue('#password', PASSWORD);
  await click('form button[type="submit"]');
}
const PROFILE_READY = `location.pathname === '/settings/profile' && document.querySelector('#firstName')?.value === 'Visual' && !!document.querySelector('header nav[aria-label="Breadcrumb"]')`;
async function openProfile(base) {
  await signIn(base, EMAIL, '/settings/profile');
  await waitFor(PROFILE_READY);
}

async function run() {
  if (ONLY === 'all' || ONLY === 'identity') {
    await shellScenarios();
    await identityScenarios();
  }
  if (ONLY === 'all' || ONLY === 'trading') await tradingScenarios();
  if (ONLY === 'all' || ONLY === 'learning') await learningScenarios();
  if (ONLY === 'all' || ONLY === 'actuarial') await actuarialScenarios();
  await browser.clearCookies();
}

async function shellScenarios() {
  for (const theme of ['light', 'dark']) {
    await scenario('login', { theme, prepare: openLogin });
  }
  await scenario('login-validation', {
    widths: [1440, 375],
    prepare: async (base) => {
      await openLogin(base);
      await click('form button[type="submit"]');
      await waitFor(`!!document.querySelector('#email-error') && !!document.querySelector('#password-error')`);
    },
  });
  await scenario('login-error', {
    widths: [1440, 375],
    prepare: async (base) => {
      await signIn(base, VISUAL_UNKNOWN_EMAIL);
      await waitFor(`!!document.querySelector('[role="alert"]') && !document.querySelector('form button[type="submit"]').disabled`);
    },
  });
  await scenario('login-mfa', {
    prepare: async (base) => {
      await signIn(base, MFA_EMAIL);
      await waitFor(`!!document.querySelector('#code')`);
    },
  });
  for (const theme of ['light', 'dark']) {
    await scenario('settings-profile', { theme, prepare: openProfile });
  }
  await scenario('shell-collapsed', {
    widths: [1440],
    prepare: async (base) => {
      await openProfile(base);
      await click('aside button[aria-label="Collapse sidebar"]');
      await waitFor(`!!document.querySelector('aside button[aria-label="Expand sidebar"]')`);
    },
  });
  await scenario('profile-menu', {
    widths: [1440],
    prepare: async (base) => {
      await openProfile(base);
      await click('button[aria-haspopup="menu"]');
      await waitFor(`!!document.querySelector('[role="menu"]')`);
    },
  });
  await scenario('mobile-drawer', {
    widths: [375],
    prepare: async (base) => {
      await openProfile(base);
      await click('button[aria-label="Open navigation"]');
      await waitFor(`!!document.querySelector('[role="dialog"][aria-label="Navigation"]')`);
    },
  });
}

// ---------------------------------------------------------------- phase 2: identity, security, sessions, admin

/** Never a valid token: link pages are captured in their pre-confirmation state and nothing is consumed. */
const FAKE_TOKEN = 'f'.repeat(64);
const open = (base, path, ready) => browser.clearCookies().then(() => go(`${base}${path}`, ready));
const has = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
const DIALOG = `!!document.querySelector('[role="alertdialog"]')`;
async function clickButton(text) {
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === ${JSON.stringify(text)} && !b.disabled)`);
  await browser.clickText(text);
}

/** Sessions differ per run; start each app from exactly one live session so both lists have the same length. */
async function resetVisualSessions() {
  await prisma.authSession.updateMany({ where: { user: { email: EMAIL }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'VISUAL_CHECK_RESET' } });
}

async function identityScenarios() {
  for (const theme of ['light', 'dark']) {
    await scenario('register', { theme, prepare: (base) => open(base, '/register', `!!document.querySelector('#confirmPassword')`) });
  }
  await scenario('register-validation', {
    widths: [1440, 375],
    prepare: async (base) => {
      await open(base, '/register', `!!document.querySelector('#confirmPassword')`);
      await click('form button[type="submit"]');
      await waitFor(`document.querySelectorAll('.field-error').length >= 3`);
    },
  });
  await scenario('register-password-strength', {
    widths: [1440],
    prepare: async (base) => {
      await open(base, '/register', `!!document.querySelector('#confirmPassword')`);
      await setValue('#password', 'abc');
    },
  });
  for (const theme of ['light', 'dark']) {
    await scenario('forgot-password', { theme, prepare: (base) => open(base, '/forgot-password', `!!document.querySelector('#email')`) });
  }
  await scenario('forgot-password-sent', {
    widths: [1440, 375],
    prepare: async (base) => {
      await open(base, '/forgot-password', `!!document.querySelector('#email')`);
      await setValue('#email', VISUAL_UNKNOWN_EMAIL);
      await click('form button[type="submit"]');
      await waitFor(`!!document.querySelector('.form-success-banner')`);
    },
  });
  await scenario('resend-verification', { prepare: (base) => open(base, '/resend-verification', `!!document.querySelector('#email')`) });
  await scenario('verify-email-link', { prepare: (base) => open(base, `/verify-email?token=${FAKE_TOKEN}`, `${has('Confirm email verification')} && !location.search.includes('token=')`) });
  await scenario('verify-email-missing-token', { widths: [1440, 375], prepare: (base) => open(base, '/verify-email', has('No verification token')) });
  await scenario('reset-password-handoff', { prepare: (base) => open(base, `/reset-password?token=${FAKE_TOKEN}`, `${has('Confirm reset handoff')} && !location.search.includes('token=')`) });
  await scenario('reset-password-form', {
    widths: [1440, 375],
    prepare: async (base) => {
      await open(base, `/reset-password?token=${FAKE_TOKEN}`, has('Confirm reset handoff'));
      await clickButton('Confirm reset handoff');
      await waitFor(`!!document.querySelector('#password')`);
    },
  });
  await scenario('confirm-email-change-link', { prepare: (base) => open(base, `/confirm-email-change?token=${FAKE_TOKEN}`, `!!document.querySelector('button.btn-primary') && !location.search.includes('token=')`) });
  await scenario('unauthorized', { prepare: (base) => open(base, '/unauthorized', has('Sign in with another account')) });

  await scenario('admin-forbidden-investor', {
    widths: [1440, 375],
    prepare: async (base) => {
      await signIn(base, EMAIL, '/admin');
      await waitFor(`location.pathname === '/unauthorized' && ${has('Sign in with another account')}`);
    },
  });

  const SECURITY_READY = `location.pathname === '/settings/security' && !!document.querySelector('#mfaSetupPassword') && !!document.querySelector('#currentPassword') && !document.body.innerText.includes('Loading active sessions')`;
  const openSecurity = async (base) => {
    await resetVisualSessions();
    await signIn(base, EMAIL, '/settings/security');
    await waitFor(SECURITY_READY);
    // The sign-in time (to the second) is the only live value left on the page; both apps show the same fixed text.
    await evaluate(`(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        n.textContent = n.textContent.replace(/Last sign-in .*?\\d{1,2}:\\d{2}(:\\d{2})?\\./, 'Last sign-in 01/01/2026 09:00:00.');
      }
      return true;
    })()`);
  };
  for (const theme of ['light', 'dark']) await scenario('settings-security', { theme, prepare: openSecurity });
  await scenario('security-password-validation', {
    widths: [1440, 375],
    prepare: async (base) => {
      await openSecurity(base);
      await clickButton('Update password');
      await waitFor(`!!document.querySelector('#currentPassword-error')`);
    },
  });
  await scenario('security-mfa-enrolment', {
    widths: [1440, 375],
    prepare: async (base) => {
      await openSecurity(base);
      await setValue('#mfaSetupPassword', PASSWORD);
      await clickButton('Set up authenticator');
      await waitFor(`!!document.querySelector('code[aria-label="Authenticator secret"]')`);
      // The enrolment secret of the disposable account is masked before any capture.
      await evaluate(`(() => {
        document.querySelector('code[aria-label="Authenticator secret"]').textContent = 'XXXXXXXXXXXXXXXX';
        for (const a of document.querySelectorAll('a[href^="otpauth:"]')) a.setAttribute('href', 'otpauth://masked');
        return true;
      })()`);
    },
  });
  await scenario('security-delete-dialog', {
    widths: [1440, 375],
    prepare: async (base) => {
      await openSecurity(base);
      await clickButton('Delete account');
      await waitFor(DIALOG);
    },
  });

  const SESSIONS_READY = `location.pathname === '/settings/sessions' && document.body.textContent.includes('This device')`;
  const openSessions = async (base) => {
    await resetVisualSessions();
    await signIn(base, EMAIL, '/settings/sessions');
    await waitFor(SESSIONS_READY);
  };
  for (const theme of ['light', 'dark']) await scenario('settings-sessions', { theme, prepare: openSessions });
  await scenario('sessions-sign-out-everywhere-dialog', {
    widths: [1440, 375],
    prepare: async (base) => {
      await openSessions(base);
      await clickButton('Sign out everywhere');
      await waitFor(DIALOG);
    },
  });

  const visual = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  const adminPage = (path, ready) => async (base) => {
    await signIn(base, ADMIN_EMAIL, path);
    await waitFor(`location.pathname === ${JSON.stringify(path.split('?')[0])} && ${ready}`);
    await sleep(600);
  };
  const ADMIN_API = ['*/api/admin/*'];
  for (const theme of ['light', 'dark']) {
    await scenario('admin-overview', { theme, replayApi: ADMIN_API, prepare: adminPage('/admin', `${has('Platform administration')} && !document.querySelector('[aria-busy="true"]')`) });
  }
  await scenario('admin-users', {
    replayApi: ADMIN_API,
    prepare: async (base) => {
      await adminPage('/admin/users', `document.querySelectorAll('table tbody tr').length > 0`)(base);
      await setValue('input[placeholder="Search name or email"]', EMAIL);
      await clickButton('Search');
      await waitFor(`document.querySelectorAll('table tbody tr').length === 1 && document.querySelector('table tbody tr').textContent.includes(${JSON.stringify(EMAIL)})`);
    },
  });
  await scenario('admin-user-detail', { replayApi: ADMIN_API, prepare: adminPage(`/admin/users/${visual.id}`, `${has(EMAIL)} && !!document.querySelector('select')`) });
  await scenario('admin-role-dialog', {
    widths: [1440, 375],
    replayApi: ADMIN_API,
    prepare: async (base) => {
      await adminPage(`/admin/users/${visual.id}`, `${has(EMAIL)} && !!document.querySelector('select')`)(base);
      await evaluate(`(() => {
        const role = [...document.querySelectorAll('select')].at(-1);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(role, 'ADMIN');
        role.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await clickButton('Change role…');
      await waitFor(DIALOG);
    },
  });
  await scenario('admin-audit', { replayApi: ADMIN_API, prepare: adminPage('/admin/audit', `document.querySelectorAll('table tbody tr').length > 0`) });
}

// ---------------------------------------------------------------- phase 3: dashboard, markets, trading, portfolios

async function springApi(token, method, path, body) {
  const res = await fetch(`${SPRING_API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', Origin: APPS.angular, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${json?.errorCode ?? ''}`);
  return json;
}

/**
 * The trader's portfolio is opened and traded once, through the Spring API only; later runs reuse it. It ends
 * with no working order, so reading it never matches orders and neither backend writes while it is displayed.
 */
async function traderPortfolio() {
  await ensureTrader(prisma);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: TRADER_EMAIL }, select: { id: true } });
  const existing = await prisma.tradingPortfolio.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (existing) return existing.id;

  const instruments = await prisma.instrument.findMany({ where: { status: 'ACTIVE' }, orderBy: { symbol: 'asc' } });
  const [equity, second] = instruments.filter((i) => i.assetClass === 'EQUITY');
  const fund = instruments.find((i) => i.assetClass === 'FUND');
  if (!equity || !second || !fund) throw new Error('Trader setup needs two active equities and an active fund');

  await signInBudget(APPS.angular, TRADER_EMAIL);
  const { accessToken: token } = await springApi(null, 'POST', '/api/auth/login', { email: TRADER_EMAIL, password: PASSWORD });
  const portfolio = await springApi(token, 'POST', '/api/portfolios', { name: 'Visual core', initialCapital: 100000 });
  const base = `/api/portfolios/${portfolio.id}`;
  const place = async (ref, terms, expected) => {
    const preview = await springApi(token, 'POST', `${base}/orders/preview`, terms);
    const placed = await springApi(token, 'POST', `${base}/orders`, {
      ...terms,
      clientOrderId: `visual-trader-${ref}`,
      expectedVersion: preview.portfolioVersion,
      quoteAsOf: preview.quote.asOf,
    });
    if (placed.order.status !== expected) throw new Error(`Trader setup: ${ref} is ${placed.order.status}, expected ${expected}`);
    return placed.order;
  };
  await place('buy-equity', { symbol: equity.symbol, side: 'BUY', type: 'MARKET', quantity: 60 }, 'FILLED');
  await place('buy-fund', { symbol: fund.symbol, side: 'BUY', type: 'MARKET', quantity: 30 }, 'FILLED');
  await place('buy-second', { symbol: second.symbol, side: 'BUY', type: 'MARKET', quantity: 25 }, 'FILLED');
  await place('trim-equity', { symbol: equity.symbol, side: 'SELL', type: 'MARKET', quantity: 20 }, 'FILLED');
  await place('oversell', { symbol: fund.symbol, side: 'SELL', type: 'MARKET', quantity: 1000 }, 'REJECTED');
  const { quote, priceDecimals } = await springApi(token, 'GET', `/api/market/instruments/${second.symbol}`);
  const limitPrice = Number((quote.mid * 0.6).toFixed(priceDecimals));
  const resting = await place('resting-limit', { symbol: second.symbol, side: 'BUY', type: 'LIMIT', quantity: 10, limitPrice }, 'OPEN');
  await springApi(token, 'POST', `${base}/orders/${resting.id}/cancel`);
  const current = await springApi(token, 'GET', base);
  await springApi(token, 'POST', `${base}/cash-flows`, { type: 'DEPOSIT', amount: 5000, expectedVersion: current.version });
  for (const symbol of [equity.symbol, fund.symbol]) await springApi(token, 'PUT', `/api/market/watchlist/${symbol}`);
  if ((await springApi(token, 'GET', base)).openOrders !== 0) throw new Error('Trader setup left a working order');
  console.log(`      trader portfolio opened through the Spring API (${equity.symbol}, ${second.symbol}, ${fund.symbol})`);
  return portfolio.id;
}

/** Everything a read could change: balances, match time, orders, fills, cash entries and positions. */
async function portfolioFingerprint(portfolioId) {
  const [p, orders, executions, entries, positions] = await Promise.all([
    prisma.tradingPortfolio.findUniqueOrThrow({ where: { id: portfolioId } }),
    prisma.tradingOrder.findMany({ where: { portfolioId }, orderBy: { sequence: 'asc' }, select: { id: true, status: true, filledQuantity: true, updatedAt: true } }),
    prisma.tradingExecution.count({ where: { portfolioId } }),
    prisma.portfolioCashEntry.count({ where: { portfolioId } }),
    prisma.portfolioPosition.findMany({ where: { portfolioId }, orderBy: { instrumentId: 'asc' }, select: { instrumentId: true, quantity: true, costBasisMillimes: true, updatedAt: true } }),
  ]);
  return JSON.stringify(
    { version: p.version, cash: p.cashMillimes, matchedThrough: p.matchedThrough, updatedAt: p.updatedAt, orders, executions, entries, positions },
    (_, v) => (typeof v === 'bigint' ? String(v) : v),
  );
}

const NO_SKELETON = `document.querySelectorAll('.skeleton').length === 0`;
const ON = (path) => `location.pathname === ${JSON.stringify(path)}`;
/**
 * Deliberate correction (docs/migration/UI_VISUAL_PARITY.md): in Next.js the Stress tests table keeps its
 * descriptions on one line, so Impact and Equity after sit outside the panel from 768 px up. Angular must
 * show every column without horizontal scrolling at those widths; 375 px may scroll like every table.
 */
const STRESS_COLUMNS_VISIBLE = `(() => {
  if (window.innerWidth < 768) return '';
  const table = document.querySelector('.tr-stressRow')?.closest('table');
  const wrap = table?.closest('.table-wrap');
  if (!table || !wrap) return 'stress table not found';
  const last = table.querySelector('thead th:last-child').getBoundingClientRect();
  const box = wrap.getBoundingClientRect();
  return last.right <= box.right + 1 ? '' : 'stress columns overflow the panel by ' + Math.round(last.right - box.right) + ' px';
})()`;

const TRADING_READY = {
  dashboard: `${ON('/dashboard')} && ${has('Watchlist')} && ${NO_SKELETON}`,
  markets: `${ON('/markets')} && ${has('How these prices are made')} && document.querySelectorAll('table tbody tr').length > 0 && ${NO_SKELETON}`,
  trading: `${ON('/trading')} && ${has('Recent trades')} && !!document.querySelector('svg[role="img"]') && ${NO_SKELETON}`,
  tradingEmpty: `${ON('/trading')} && ${has('Start with a virtual portfolio')} && !!document.querySelector('svg[role="img"]') && ${NO_SKELETON}`,
  portfolios: `${ON('/portfolios')} && ${has('Reconciliation')} && ${has('Stress tests')} && ${NO_SKELETON}`,
  portfoliosEmpty: `${ON('/portfolios')} && ${has('Create a virtual portfolio')} && ${NO_SKELETON}`,
};
const LOADING = (path) => `${ON(path)} && document.querySelectorAll('.skeleton').length > 0`;
/** Panels whose own request did not fail keep their skeleton in both apps, so only the alert is awaited. */
const FAILED = (path) => `${ON(path)} && !!document.querySelector('[role="alert"]')`;
const TRADING_API = ['*/api/market/*', '*/api/portfolios*', '*/api/users/me/*', '*/api/auth/sessions*'];

async function tradingScenarios() {
  const portfolioId = await traderPortfolio();
  const before = await portfolioFingerprint(portfolioId);
  const empty = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { _count: { select: { tradingPortfolios: true } } } });
  if (empty._count.tradingPortfolios !== 0) throw new Error(`${EMAIL} must have no portfolio for the empty states`);

  const page = (email, path, ready, after) => async (base) => {
    await signIn(base, email, path);
    await waitFor(ready);
    await sleep(600);
    if (after) await after();
  };
  // Loading and error states do not depend on account data; they use the empty account so the trader stays
  // within the per-account sign-in limit.
  const loading = (path) => async (base) => {
    await signIn(base, EMAIL, path);
    await waitFor(LOADING(path));
    await sleep(600);
  };
  const failing = (path) => page(EMAIL, path, FAILED(path), () => sleep(1500));
  const hold = (match) => ({ mode: 'hold', match });
  const fail = (match) => ({ mode: 'error', match });
  const MARKET = /^\/api\/market\//;
  const TRADING_DATA = /^\/api\/(market|portfolios)(\/|$)/;

  for (const theme of ['light', 'dark']) {
    await scenario('dashboard', { theme, replayApi: TRADING_API, prepare: page(TRADER_EMAIL, '/dashboard', TRADING_READY.dashboard) });
  }
  await scenario('dashboard-sample', {
    widths: [1440, 375],
    replayApi: TRADING_API,
    prepare: page(TRADER_EMAIL, '/dashboard', TRADING_READY.dashboard, async () => {
      await clickButton('Explore sample workspace');
      await waitFor(`!!document.querySelector('[aria-pressed="true"]') && ${has('Exit sample workspace')}`);
    }),
  });
  await scenario('dashboard-loading', {
    widths: [1440],
    interceptApi: hold(/^\/api\/(users\/me|auth\/sessions|learning)/),
    prepare: loading('/dashboard'),
  });

  for (const theme of ['light', 'dark']) {
    await scenario('markets', { theme, replayApi: TRADING_API, prepare: page(TRADER_EMAIL, '/markets', TRADING_READY.markets) });
  }
  await scenario('markets-loading', { widths: [1440, 375], interceptApi: hold(MARKET), prepare: loading('/markets') });
  await scenario('markets-error', {
    widths: [1440, 375],
    interceptApi: fail(MARKET),
    prepare: failing('/markets'),
  });

  for (const theme of ['light', 'dark']) {
    await scenario('trading', { theme, replayApi: TRADING_API, prepare: page(TRADER_EMAIL, '/trading', TRADING_READY.trading) });
  }
  await scenario('trading-no-portfolio', { widths: [1440, 375], replayApi: TRADING_API, prepare: page(EMAIL, '/trading', TRADING_READY.tradingEmpty) });
  await scenario('trading-ticket-validation', {
    widths: [1440, 375],
    replayApi: TRADING_API,
    prepare: page(TRADER_EMAIL, '/trading', TRADING_READY.trading, async () => {
      await setValue('#ticket-quantity', '');
      await clickButton('Preview order');
      await waitFor(`document.querySelectorAll('.field-error').length > 0`);
    }),
  });
  await scenario('trading-order-preview', {
    widths: [1440, 375],
    replayApi: TRADING_API,
    prepare: page(TRADER_EMAIL, '/trading', TRADING_READY.trading, async () => {
      await setValue('#ticket-quantity', '10');
      await clickButton('Preview order');
      await waitFor(`${has('Review: buy 10')} && [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Confirm buy')`);
    }),
  });
  await scenario('trading-loading', { widths: [1440, 375], interceptApi: hold(TRADING_DATA), prepare: loading('/trading') });
  await scenario('trading-error', {
    widths: [1440, 375],
    interceptApi: fail(TRADING_DATA),
    prepare: failing('/trading'),
  });

  for (const theme of ['light', 'dark']) {
    await scenario('portfolios', {
      theme,
      replayApi: TRADING_API,
      prepare: page(TRADER_EMAIL, '/portfolios', TRADING_READY.portfolios),
      angularCheck: STRESS_COLUMNS_VISIBLE,
    });
  }
  for (const tab of ['Trades', 'Cash']) {
    await scenario(`portfolios-history-${tab.toLowerCase()}`, {
      widths: [1440, 375],
      replayApi: TRADING_API,
      prepare: page(TRADER_EMAIL, '/portfolios', TRADING_READY.portfolios, async () => {
        await clickButton(tab);
        await waitFor(`[...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.innerText.trim() === ${JSON.stringify(tab)})`);
      }),
    });
  }
  await scenario('portfolios-no-portfolio', { widths: [1440, 375], replayApi: TRADING_API, prepare: page(EMAIL, '/portfolios', TRADING_READY.portfoliosEmpty) });
  await scenario('portfolios-loading', { widths: [1440, 375], interceptApi: hold(/^\/api\/portfolios(\/|$)/), prepare: loading('/portfolios') });
  await scenario('portfolios-error', {
    widths: [1440, 375],
    interceptApi: fail(/^\/api\/portfolios(\/|$)/),
    prepare: failing('/portfolios'),
  });

  const unchanged = (await portfolioFingerprint(portfolioId)) === before;
  report.push({ check: 'trader portfolio unchanged by both apps while displayed', passed: unchanged });
  if (!unchanged) failures += 1;
  console.log(`${unchanged ? 'DONE' : 'FAIL'}  the trader portfolio (balances, match time, orders, fills, cash entries, positions) is unchanged after both apps displayed it`);
}

const LEARNING_READY = {
  hub: `${ON('/learn')} && ${has('Competency profile')} && document.querySelectorAll('[data-availability]').length >= 10`,
  stories: `${ON('/stories')} && (!!document.querySelector('[aria-label="FinStories feed"]') || ${has('No stories yet')})`,
};
const ACTUARIAL_READY = {
  overview: `${ON('/actuarial')} && (${has('Reference')} || ${has('Claims & Pricing')})`,
  pricing: `${ON('/actuarial/pricing')} && (${has('Gross premium')} || ${has('Pure premium')})`,
};

async function learningScenarios() {
  const page = (path, ready) => async (base) => {
    await signIn(base, EMAIL, path);
    await waitFor(ready);
    await sleep(600);
  };
  for (const theme of ['light', 'dark']) {
    await scenario('learn-hub', { theme, prepare: page('/learn', LEARNING_READY.hub) });
    await scenario('stories-feed', { theme, prepare: page('/stories', LEARNING_READY.stories) });
  }
}

async function actuarialScenarios() {
  const page = (path, ready) => async (base) => {
    await signIn(base, EMAIL, path);
    await waitFor(ready);
    await sleep(600);
  };
  for (const theme of ['light', 'dark']) {
    await scenario('actuarial-overview', { theme, prepare: page('/actuarial', ACTUARIAL_READY.overview) });
    await scenario('actuarial-pricing', { theme, prepare: page('/actuarial/pricing', ACTUARIAL_READY.pricing) });
  }
}

try {
  await run();
} catch (error) {
  failures += 1;
  console.log(`FAIL  ${error.message}`);
} finally {
  writeFileSync(join(OUT, 'visual-parity-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), apps: APPS, channelTolerance: CHANNEL_TOLERANCE, pageErrors: browser.pageErrors, results: report }, null, 2));
  browser.close();
  await prisma.$disconnect();
}
console.log(`\n${report.filter((r) => r.scenario && !r.error).length} comparisons written to ${OUT}; ${failures} failure(s); ${browser.pageErrors.length} page error(s)`);
if (browser.pageErrors.length) console.log(browser.pageErrors.join('\n'));
process.exit(failures ? 1 : 0);
