#!/usr/bin/env node
/**
 * Verifies the Angular production host (apps/web/server/host.mjs) with real HTTP responses and a real
 * browser. Prerequisites: `npm run build` in apps/web; the Spring API on SPRING_URL (default
 * http://localhost:3002) for the /api forwarding checks.
 *
 *   node scripts/migration/angular-host-check.mjs
 *
 * Checks the security, token-page and caching headers on documents, token pages (with and without a trailing
 * slash, GET and HEAD), redirects, hashed and unhashed assets, missing files, refused methods and API
 * forwarding (reachable and unreachable upstream). In headless Edge it then opens each token page with a
 * disposable token and checks that the token leaves the address bar and the history entry, that no request
 * carries it in a Referer, and that the host's access log never contains it.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchEdge, sleep } from './headless-edge.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ANGULAR = resolve(ROOT, 'apps/web');
const SPRING = process.env.SPRING_URL ?? 'http://localhost:3002';
const PORT = 4310;
const DEAD_PORT = 4311;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'f00dfeed'.repeat(8);

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function startHost(port, upstream) {
  const child = spawn(process.execPath, ['server/host.mjs'], {
    cwd: ANGULAR,
    env: { ...process.env, HOST_PORT: String(port), API_UPSTREAM: upstream },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (d) => output.push(String(d)));
  child.stderr.on('data', (d) => output.push(String(d)));
  return { child, output };
}

async function waitUp(base) {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base, { method: 'HEAD' });
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Host on ${base} did not start`);
}

const get = (path, init = {}) => fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
const h = (res, name) => res.headers.get(name);
const securityHeadersPresent = (res) =>
  h(res, 'x-content-type-options') === 'nosniff' && h(res, 'x-frame-options') === 'DENY' && h(res, 'permissions-policy') === 'camera=(), microphone=(), geolocation=()';

const host = startHost(PORT, SPRING);
const deadHost = startHost(DEAD_PORT, 'http://127.0.0.1:9');
try {
  await waitUp(BASE);
  await waitUp(`http://127.0.0.1:${DEAD_PORT}`);

  // ---------------------------------------------------------------- documents and token pages
  for (const page of ['/verify-email', '/reset-password', '/confirm-email-change']) {
    for (const method of ['GET', 'HEAD']) {
      const res = await get(`${page}?token=${TOKEN}`, { method });
      check(`${method} ${page}?token=… is the app with no-referrer and no-store`,
        res.status === 200 && h(res, 'referrer-policy') === 'no-referrer' && h(res, 'cache-control') === 'no-store' && securityHeadersPresent(res) && h(res, 'content-type')?.startsWith('text/html'),
        `${res.status} ${h(res, 'referrer-policy')} ${h(res, 'cache-control')}`);
    }
    const redirect = await get(`${page}/?token=${TOKEN}`);
    check(`GET ${page}/?token=… redirects (308) with the token-page headers`,
      redirect.status === 308 && h(redirect, 'location') === `${page}?token=${TOKEN}` && h(redirect, 'referrer-policy') === 'no-referrer' && h(redirect, 'cache-control') === 'no-store' && securityHeadersPresent(redirect),
      `${redirect.status} ${h(redirect, 'referrer-policy')} ${h(redirect, 'cache-control')}`);
  }
  for (const page of ['/login', '/dashboard', '/settings/security', '/', '/no-such-route']) {
    const res = await get(page);
    check(`GET ${page} is the app with the default policy (not no-store)`,
      res.status === 200 && h(res, 'referrer-policy') === 'strict-origin-when-cross-origin' && h(res, 'cache-control') === 'no-cache' && securityHeadersPresent(res),
      `${res.status} ${h(res, 'referrer-policy')} ${h(res, 'cache-control')}`);
  }
  const prefix = await get('/verify-emails?token=x');
  check('a path that only starts like a token page keeps the default policy', h(prefix, 'referrer-policy') === 'strict-origin-when-cross-origin');

  // ---------------------------------------------------------------- static assets
  const dist = resolve(ANGULAR, 'dist/web-angular/browser');
  const main = readdirSync(dist).find((f) => /^main-[A-Z0-9]+\.js$/.test(f));
  const styles = readdirSync(dist).find((f) => /^styles-[A-Z0-9]+\.css$/.test(f));
  const font = readdirSync(resolve(dist, 'media')).find((f) => f.endsWith('.woff2'));
  for (const asset of [`/${main}`, `/${styles}`, `/media/${font}`]) {
    const res = await get(asset);
    check(`hashed asset ${asset.replace(/-[A-Z0-9]+\./, '-<hash>.')} is cacheable for a year`,
      res.status === 200 && h(res, 'cache-control') === 'public, max-age=31536000, immutable' && h(res, 'referrer-policy') === 'strict-origin-when-cross-origin' && securityHeadersPresent(res),
      `${res.status} ${h(res, 'cache-control')}`);
  }
  const icon = await get('/icon.svg');
  check('unhashed /icon.svg is revalidated (no-cache), not no-store', icon.status === 200 && h(icon, 'cache-control') === 'no-cache' && h(icon, 'content-type') === 'image/svg+xml');

  // ---------------------------------------------------------------- error states
  const missing = await get('/missing-file.js');
  check('a missing file is 404 with security headers and no-store', missing.status === 404 && h(missing, 'cache-control') === 'no-store' && securityHeadersPresent(missing));
  const traversal = await get('/..%2f..%2fpackage.json');
  check('path traversal is refused', traversal.status === 404, String(traversal.status));
  const post = await get('/login', { method: 'POST' });
  check('POST to a page is 405 with security headers', post.status === 405 && h(post, 'allow') === 'GET, HEAD' && securityHeadersPresent(post));

  // ---------------------------------------------------------------- API forwarding
  const health = await get('/api/health');
  const body = await health.json().catch(() => null);
  check('/api/health is forwarded to Spring on the same origin', health.status === 200 && body?.status !== undefined, `${health.status} ${JSON.stringify(body)?.slice(0, 80)}`);
  const unauthorized = await get('/api/auth/me');
  check('a protected API route answers 401 through the host', unauthorized.status === 401, String(unauthorized.status));
  const dead = await fetch(`http://127.0.0.1:${DEAD_PORT}/api/health`);
  check('an unreachable API is 502 with no-store and an error code', dead.status === 502 && h(dead, 'cache-control') === 'no-store' && (await dead.json()).errorCode === 'UPSTREAM_UNAVAILABLE');

  // ---------------------------------------------------------------- browser: token handling
  const browser = await launchEdge({ port: 9351, name: 'angular-host-check' });
  try {
    const requests = [];
    const documents = [];
    browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, referer: p.request.headers.Referer ?? p.request.headers.referer ?? null }));
    browser.on('Network.responseReceived', (p) => {
      if (p.type === 'Document') documents.push({ url: p.response.url, headers: p.response.headers });
    });
    const pages = [
      ['/verify-email', 'Confirm email verification'],
      ['/reset-password', 'Confirm reset handoff'],
      ['/confirm-email-change', 'Confirm new email'],
    ];
    for (const [page, ready] of pages) {
      requests.length = 0;
      documents.length = 0;
      await browser.go(`${BASE}${page}?token=${TOKEN}`, `document.body.innerText.includes(${JSON.stringify(ready)}) && !location.search.includes('token=')`);
      await sleep(500);
      const history = await browser.send('Page.getNavigationHistory');
      const entry = history.entries[history.currentIndex];
      check(`${page}: the token is gone from the address bar and the history entry`,
        !(await browser.evaluate('location.href')).includes(TOKEN) && !entry.url.includes(TOKEN), entry.url);
      const doc = documents.find((d) => d.url.includes(page));
      const policy = doc ? Object.entries(doc.headers).find(([k]) => k.toLowerCase() === 'referrer-policy')?.[1] : null;
      check(`${page}: the browser received Referrer-Policy: no-referrer`, policy === 'no-referrer', String(policy));
      const leaking = requests.filter((r) => r.referer?.includes(TOKEN));
      const withReferer = requests.filter((r) => r.referer);
      check(`${page}: no request carries the token in a Referer (${requests.length} requests)`, leaking.length === 0, `${withReferer.length} with any Referer`);
    }
    check('no page error in the browser', browser.allPageErrors.length === 0, browser.allPageErrors.join('; '));
  } finally {
    browser.close();
  }

  await sleep(200);
  const log = host.output.join('');
  check('the access log records requests', log.includes('GET /verify-email?<redacted> 200'));
  check('the access log never contains the token', !log.includes(TOKEN));
} finally {
  host.child.kill();
  deadHost.child.kill();
}

console.log(`\n${passed}/${passed + failures.length} checks passed`);
process.exit(failures.length ? 1 : 0);
