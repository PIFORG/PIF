#!/usr/bin/env node
/**
 * Browser end-to-end journey for the Actuarial Lab (overview, Claims & Pricing Studio and Monte
 * Carlo Lab), driven through headless Microsoft Edge over the DevTools protocol.
 *
 * Prerequisites (development only):
 *   - API built (`npm run build`, so simulations use worker threads) and running with
 *     MAIL_TRANSPORT=preview against a `_test` database that has the actuarial migrations applied
 *   - Web running on E2E_WEB_URL (default http://localhost:3000)
 *
 *   npm run test:e2e:actuarial [-- <screenshot-dir>]
 *
 * Registers a throwaway @example.test account with a random password that is never printed, then:
 *  1 reads the overview · 2 prices the reference portfolio (checked against an exact binomial
 *  computed here) · 3 switches to Poisson · 4 switches to lognormal costs · 5 is stopped by inline
 *  validation · 6 grosses up for variable expenses and margin · 7 saves, rejects a duplicate and
 *  reloads a scenario · 8 sees it on the overview · 9 deletes it · 10 runs a seeded Monte Carlo
 *  simulation checked against binomial tails · 11 reproduces it from the seed · 12 probes API
 *  latency during a heavy run · 13 sees changed inputs flagged · 14 reloads and deletes runs ·
 *  15 sees the runs on the overview · 16 reserves the motor example (paid chain ladder checked
 *  against a calculation here) · 17 enters a hand-checked triangle · 18 selects a factor ·
 *  19 sees missing cells and recoveries flagged · 20 is stopped by local and server validation ·
 *  21 saves, lists, reloads and deletes a reserving run.
 * Exits non-zero when any check fails.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
const PREVIEW_DIR = resolve(ROOT, 'apps/api', process.env.MAIL_PREVIEW_DIR ?? '.mail-preview');
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/actuarial/screenshots');
const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9345;
const VIEWPORTS = { desktop: [1440, 900], tablet: [768, 1024], mobile: [375, 812] };

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: WEB },
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

async function verificationToken(email, since) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (existsSync(PREVIEW_DIR)) {
      const mails = readdirSync(PREVIEW_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(PREVIEW_DIR, f), 'utf8')))
        .filter((m) => m.to === email && m.template === 'verify-email' && Date.parse(m.createdAt) >= since);
      if (mails.length) {
        const text = readFileSync(join(PREVIEW_DIR, `${mails[0].id}.txt`), 'utf8');
        const match = /verify-email\?token=([A-Za-z0-9_%-]+)/.exec(text);
        if (match) return decodeURIComponent(match[1]);
      }
    }
    await sleep(250);
  }
  throw new Error('No verification email was captured. Is the API running with MAIL_TRANSPORT=preview?');
}

/** P(N ≥ k) for N ~ Bin(n, p) by the multiplicative recurrence, independent of the server code. */
function binomialTail(n, p, k) {
  let pmf = Math.pow(1 - p, n);
  let below = 0;
  for (let i = 0; i < k; i += 1) {
    below += pmf;
    pmf = (pmf * (n - i) * p) / ((i + 1) * (1 - p));
  }
  return 1 - below;
}

// ---------- headless Edge ----------
mkdirSync(SHOTS, { recursive: true });
const profile = join(tmpdir(), `mtrs-actuarial-e2e-${Date.now()}`);
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--window-size=1440,900', 'about:blank']);

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
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
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

const bodyHas = (text) => `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`;
async function go(url, ready) {
  await send('Page.navigate', { url });
  await waitFor(`document.readyState === 'complete'`);
  if (ready) await waitFor(ready);
  await sleep(300);
}
async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(400);
}
async function shot(name) {
  const m = await send('Page.getLayoutMetrics');
  const width = m.cssLayoutViewport.clientWidth;
  const height = Math.min(Math.ceil(m.cssContentSize.height), 9000);
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
}
async function shotAll(name) {
  for (const [label, [w, h]] of Object.entries(VIEWPORTS)) {
    await viewport(w, h);
    const layout = await evaluate(`({ inner: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    check(`${name} has no horizontal overflow at ${w}px`, layout.overflow <= 1 && layout.inner === w, `layout ${layout.inner}px, overflow ${layout.overflow}px`);
    await shot(`${name}-${label}`);
  }
  await viewport(...VIEWPORTS.desktop);
}
/** Close-up of one panel at the current viewport, for visual review. */
async function shotElement(selector, name) {
  const box = await evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return r ? { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } : null;
  })()`);
  if (!box) throw new Error(`No element ${selector} to capture`);
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 1 } });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
}
async function setValue(selector, value) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Field ${selector} not found`);
}
async function click(label, tag = 'button', scope = 'document') {
  const ok = await evaluate(`(() => {
    const el = [...${scope}.querySelectorAll(${JSON.stringify(tag)})].find((x) => (x.getAttribute('aria-label') ?? x.textContent).trim().startsWith(${JSON.stringify(label)}));
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`${tag} "${label}" not found or disabled`);
}
const num = (text) => Number(String(text).replace(/\u2212/g, '-').replace(/[^0-9.\-]/g, ''));

/** Waits until the debounced recalculation has started and finished. */
async function settled() {
  await sleep(500);
  await waitFor(`!document.querySelector('[aria-busy="true"]') && ${bodyHas('Results are up to date.')}`);
  await sleep(200);
}
const kpi = (label) =>
  evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-tone]')].find((n) => n.firstElementChild?.textContent.trim().startsWith(${JSON.stringify(label)}));
    return card ? card.children[1].textContent.trim() : null;
  })()`);
const premiumRows = () =>
  evaluate(`Object.fromEntries([...document.querySelectorAll('#premium tbody tr')].map((r) => [r.querySelector('th').firstChild.textContent.trim(), [...r.querySelectorAll('td')].map((td) => td.textContent.trim())]))`);
const stat = (panel, label) =>
  evaluate(`(() => {
    const d = [...document.querySelectorAll('#${panel} dl > div')].find((x) => x.querySelector('dt').textContent.trim() === ${JSON.stringify(label)});
    return d ? d.querySelector('dd').textContent.trim() : null;
  })()`);

async function run() {
  // 0. Throwaway account through the real registration and verification flow.
  const email = `e2e-actuarial-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}@example.test`;
  const password = `${randomBytes(12).toString('base64url')}a7!`;
  const t0 = Date.now() - 1000;
  const reg = await api('POST', '/auth/register', { firstName: 'Amel', lastName: 'Actuary', email, password, passwordConfirmation: password });
  check('throwaway actuary registered', reg.status === 201, `HTTP ${reg.status}`);
  const verified = await api('POST', '/auth/verify-email', { token: await verificationToken(email, t0) });
  check('email verified through the captured link token', verified.status === 200, `HTTP ${verified.status}`);

  // 1. Overview.
  await viewport(...VIEWPORTS.desktop);
  await go(`${WEB}/login?returnTo=%2Factuarial`, `!!document.querySelector('input[name="email"]')`);
  await setValue('input[name="email"]', email);
  await setValue('input[name="password"]', password);
  await click('Sign in');
  await waitFor(`location.pathname === '/actuarial' && !!document.querySelector('#reference svg')`);
  const overview = await evaluate(`({
    title: document.querySelector('h1')?.textContent,
    estimate: ${bodyHas('Model estimates from fictional assumptions')},
    fictional: !!document.querySelector('#reference .badge'),
    columns: document.querySelectorAll('#reference svg rect').length,
    planned: [...document.querySelectorAll('nav[aria-label="Actuarial lab workspaces"] [aria-disabled="true"]')].map((n) => n.textContent),
    current: document.querySelector('nav[aria-label="Actuarial lab workspaces"] [aria-current="page"]')?.textContent,
    pendingBadge: ${bodyHas('Preview · backend pending')},
    empty: ${bodyHas('No saved scenarios yet')},
  })`);
  check('1. overview: live Actuarial Lab with labelled fictional reference portfolio and its distribution', overview.title === 'Actuarial Lab' && overview.estimate && overview.fictional && overview.columns > 10, `${overview.columns} columns`);
  check('   planned workspaces are announced, not linked; Overview is the current tab', overview.planned.length === 2 && overview.current === 'Overview', overview.planned.join(', '));
  check('   no "backend pending" preview label; empty scenario state', !overview.pendingBadge && overview.empty);
  check('   reference KPIs: 89,000 premium, 60,000 expected cost', (await kpi('Gross premium')) === '89,000 DT' && (await kpi('Expected claim cost E[S]')) === '60,000 DT', `${await kpi('Gross premium')} / ${await kpi('Expected claim cost E[S]')}`);
  await shotAll('A01-overview');

  // 2. Pricing studio on the reference portfolio.
  await click('Open the pricing studio', 'a');
  await waitFor(`location.pathname === '/actuarial/pricing' && !!document.querySelector('#premium')`);
  await settled();
  const rows = await premiumRows();
  check(
    '2. reference build-up: 60,000 + 9,000 + 20,000 = 89,000, i.e. 89 per policy',
    rows['Pure premium']?.[0] === '60,000.000 DT' &&
      rows['Risk loading']?.[0] === '9,000.000 DT' &&
      rows['Fixed and per-policy expenses']?.[0] === '20,000.000 DT' &&
      rows['Gross (commercial) premium']?.[0] === '89,000.000 DT' &&
      rows['Gross (commercial) premium']?.[1] === '89.000 DT',
    JSON.stringify(rows['Gross (commercial) premium']),
  );
  const exactLoss = binomialTail(1000, 0.05, 58);
  const shownLoss = num(await kpi('P(underwriting loss)')) / 100;
  check('   P(underwriting loss) = P(N ≥ 58) for Bin(1000, 5%), matching an independent calculation', Math.abs(shownLoss - exactLoss) < 0.00006, `shown ${(shownLoss * 100).toFixed(2)}%, exact ${(exactLoss * 100).toFixed(4)}%`);
  check('   loss ratio 67.4% and combined ratio 89.9%', (await stat('premium', 'Loss ratio')) === '67.4%' && (await kpi('Combined ratio')) === '89.9%');
  check('   deterministic cost explained instead of a density chart', await evaluate(bodyHas('Every claim costs the same')));
  check('   exact method note shown', await evaluate(bodyHas('Exact distribution: every claim costs the same')));
  const sd = await stat('aggregate', 'Standard deviation');
  check('   sd(S) = 1,200 × √47.5 = 8,270.429', sd === '8,270.429 DT', sd);
  await shotAll('A02-pricing-reference');
  await shotElement('#premium', 'A02a-premium-buildup');
  await shotElement('#aggregate', 'A02b-aggregate-distribution');
  await shotElement('#assumptions', 'A02c-assumptions');
  await viewport(...VIEWPORTS.mobile);
  await shotElement('#premium', 'A02d-premium-buildup-mobile');
  await shotElement('#aggregate', 'A02e-aggregate-distribution-mobile');
  await viewport(...VIEWPORTS.desktop);

  // 3. Poisson frequency with the same expected count.
  await click('Poisson', 'button', `document.querySelector('[role="group"][aria-label="Frequency model"]')`);
  await setValue('#act-intensity', '0.05');
  await settled();
  const disp = await stat('frequency', 'Var ÷ mean');
  check('3. Poisson: E[S] unchanged at 60,000, dispersion index exactly 1', (await stat('aggregate', 'E[S]')) === '60,000.000 DT' && /^1Exactly 1/.test(disp ?? ''), disp);
  check('   preset selector switches to "Custom assumptions"', (await evaluate(`document.querySelector('#act-preset').value`)) === '');

  // 4. Lognormal claim costs.
  await click('Lognormal', 'button', `document.querySelector('[role="group"][aria-label="Severity model"]')`);
  await setValue('#act-cv', '2.5');
  await settled();
  const logn = await evaluate(`({
    mu: [...document.querySelectorAll('#severity dt')].some((d) => d.textContent === 'μ, σ of ln X'),
    curve: !!document.querySelector('#severity svg path'),
    panjer: ${bodyHas('Panjer recursion')},
    q995: [...document.querySelectorAll('#aggregate tbody tr')].find((r) => r.querySelector('th').textContent === '99.5%')?.querySelectorAll('td')[0].textContent,
    normal: [...document.querySelectorAll('#aggregate tbody tr')].find((r) => r.querySelector('th').textContent === '99.5%')?.querySelectorAll('td')[2].textContent,
  })`);
  check('4. lognormal: μ and σ labelled as parameters of ln X, density drawn, Panjer used', logn.mu && logn.curve && logn.panjer);
  check('   heavy tail: the exact 99.5% quantile exceeds the normal approximation', num(logn.q995) > num(logn.normal), `${logn.q995} vs normal ${logn.normal}`);
  await shotAll('A03-pricing-lognormal');
  await shotElement('#severity', 'A03a-severity-lognormal');
  await shotElement('#frequency', 'A03b-frequency-poisson');
  await shotElement('#sensitivity', 'A03c-sensitivity');

  // 5. Inline validation blocks the request.
  await setValue('#act-policies', '12.5');
  await sleep(500);
  const invalid = await evaluate(`({
    error: document.querySelector('#act-policies-error')?.textContent,
    aria: document.querySelector('#act-policies').getAttribute('aria-invalid'),
    status: document.querySelector('#act-status').textContent,
  })`);
  check('5. invalid policy count shows a field error and stops recalculation', invalid.error === 'Policies must be a whole number.' && invalid.aria === 'true' && /Fix the highlighted fields/.test(invalid.status));
  await setValue('#act-policies', '1000');
  await settled();

  // 6. Gross-up for variable expenses and margin.
  await setValue('#act-variablePct', '15');
  await setValue('#act-marginPct', '5');
  await settled();
  const g = await premiumRows();
  const technical = num(g['Technical premium'][0]);
  const gross = num(g['Gross (commercial) premium'][0]);
  check('6. gross premium = technical ÷ (1 − 15% − 5%)', Math.abs(gross - technical / 0.8) < 0.002, `${technical} → ${gross}`);
  check('   variable expenses are 15% of the gross premium', Math.abs(num(g['Variable expenses'][0]) - 0.15 * gross) < 0.002);

  // 7. Save, reject a duplicate, reload.
  const scenarioName = 'E2E lognormal book';
  await setValue('#act-scenario-name', scenarioName);
  await click('Save current assumptions');
  await waitFor(`[...document.querySelectorAll('#scenarios tbody th')].some((t) => t.textContent.startsWith(${JSON.stringify(scenarioName)}))`);
  const savedPerPolicy = await evaluate(
    `[...document.querySelectorAll('#scenarios tbody tr')].find((r) => r.querySelector('th').textContent.startsWith(${JSON.stringify(scenarioName)})).querySelector('td').textContent`,
  );
  check(
    '7. scenario saved and listed with the premium the server computed for it',
    num(savedPerPolicy) === num(g['Gross (commercial) premium'][1]),
    `${savedPerPolicy} per policy`,
  );
  await setValue('#act-scenario-name', scenarioName);
  await click('Save current assumptions');
  await waitFor(bodyHas('You already have a scenario with this name.'));
  check('   duplicate name rejected with a clear message', true);
  await setValue('#act-preset', 'reference-deterministic');
  await settled();
  check('   reference preset reloaded (Binomial, fixed cost)', (await evaluate(`document.querySelector('[aria-label="Severity model"] [aria-pressed="true"]').textContent`)) === 'Fixed');
  await click(`Load ${scenarioName}`, 'button', `document.querySelector('#scenarios')`);
  await settled();
  const restored = await evaluate(`({
    severity: document.querySelector('[aria-label="Severity model"] [aria-pressed="true"]').textContent,
    frequency: document.querySelector('[aria-label="Frequency model"] [aria-pressed="true"]').textContent,
    cv: document.querySelector('#act-cv').value,
    variable: document.querySelector('#act-variablePct').value,
  })`);
  check('   loading the saved scenario restores its assumptions', restored.severity === 'Lognormal' && restored.frequency === 'Poisson' && restored.cv === '2.5' && restored.variable === '15', JSON.stringify(restored));

  // Accessibility basics on the studio.
  const a11y = await evaluate(`({
    unlabelled: [...document.querySelectorAll('#assumptions input, #assumptions select')].filter((el) => !document.querySelector('label[for="' + el.id + '"]')).length,
    segmented: [...document.querySelectorAll('[role="group"] button')].every((b) => b.hasAttribute('aria-pressed')),
    live: document.querySelector('#act-status')?.getAttribute('aria-live'),
    captions: [...document.querySelectorAll('#premium table, #aggregate table, #sensitivity table')].every((t) => !!t.caption),
    charts: [...document.querySelectorAll('svg[role="img"]')].every((s) => (s.getAttribute('aria-label') ?? '').length > 20),
  })`);
  check('   every input labelled, toggles expose aria-pressed, status is a live region, tables captioned, charts described', a11y.unlabelled === 0 && a11y.segmented && a11y.live === 'polite' && a11y.captions && a11y.charts, JSON.stringify(a11y));

  // 8. Overview lists the scenario.
  await click('Overview', 'a', `document.querySelector('nav[aria-label="Actuarial lab workspaces"]')`);
  await waitFor(`location.pathname === '/actuarial' && ${bodyHas(scenarioName)}`);
  check('8. overview shows the saved scenario (1 of 50)', await evaluate(bodyHas('1 of 50 saved.')));

  // 9. Delete.
  await click('Claims & Pricing Studio', 'a', `document.querySelector('nav[aria-label="Actuarial lab workspaces"]')`);
  await waitFor(`[...document.querySelectorAll('#scenarios tbody th')].some((t) => t.textContent.startsWith(${JSON.stringify(scenarioName)}))`);
  await evaluate(`window.confirm = () => true`);
  await click(`Delete ${scenarioName}`, 'button', `document.querySelector('#scenarios')`);
  await waitFor(bodyHas('No saved scenarios yet'));
  check('9. scenario deleted after confirmation', true);

  await monteCarlo();
  await reserving();

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
}

const mcRun = async () => {
  await click('Run simulation');
  await waitFor(`${bodyHas('Showing the run with seed')} && !document.querySelector('[aria-busy="true"]')`, 60000);
  await sleep(300);
};
/** Rows of the simulated-against-exact table: { label: [[value, interval hint], …] }. */
const comparisonRows = () =>
  evaluate(
    `Object.fromEntries([...document.querySelectorAll('#comparison table')[0].querySelectorAll('tbody tr')].map((r) => [r.querySelector('th').firstChild.textContent.trim(), [...r.querySelectorAll('td')].map((td) => [td.firstChild.textContent.trim(), td.querySelector('span')?.textContent.trim() ?? ''])]))`,
  );

async function monteCarlo() {
  // 10. Seeded simulation of the reference portfolio, checked against independent binomial tails.
  await click('Monte Carlo Lab', 'a', `document.querySelector('nav[aria-label="Actuarial lab workspaces"]')`);
  await waitFor(`location.pathname === '/actuarial/monte-carlo' && !!document.querySelector('#act-policies') && !!document.querySelector('#runs')`);
  check('10. Monte Carlo lab opens with no results until a run completes', await evaluate(bodyHas('No simulation yet')));
  await setValue('#mc-simulations', '20000');
  await setValue('#mc-seed', '20261109');
  await setValue('#mc-capital', '5000');
  await setValue('#mc-label', 'E2E reference');
  await mcRun();
  const t = Object.fromEntries(
    await evaluate(`[...document.querySelectorAll('#thresholds dl > div')].map((d) => [d.querySelector('dt').textContent.trim(), d.querySelector('dd').firstChild.textContent.trim()])`),
  );
  check('   thresholds: budget B = 89,000 − 20,000 = 69,000; B + C = 74,000', t['Claims budget B = P − F − vP'] === '69,000.000 DT' && t['Capital threshold B + C'] === '74,000.000 DT', JSON.stringify(t));
  const rowsA = await comparisonRows();
  const budgetExact = binomialTail(1000, 0.05, 58);
  const capitalExact = binomialTail(1000, 0.05, 62);
  const [[simBudget], [exactBudget], [insideBudget]] = rowsA['P(S > claims budget)'];
  const [[simCapital, capitalInterval], [exactCapital]] = rowsA['P(S > budget + capital)'];
  check('   exact column = P(N ≥ 58) and P(N ≥ 62), matching an independent calculation', Math.abs(num(exactBudget) / 100 - budgetExact) < 0.00006 && Math.abs(num(exactCapital) / 100 - capitalExact) < 0.00006, `${exactBudget} / ${exactCapital}`);
  const se = Math.sqrt((budgetExact * (1 - budgetExact)) / 20000);
  check('   simulated P(S > budget) within 4 standard errors of the exact value', Math.abs(num(simBudget) / 100 - budgetExact) < 4 * se + 0.00005, `${simBudget} vs ${(budgetExact * 100).toFixed(4)}%, se ${(se * 100).toFixed(3)}%, exact in interval: ${insideBudget}`);
  check('   simulated capital-insufficiency probability is reported with an interval', /%/.test(simCapital) && /^95%: .+%.*–.+%$/.test(capitalInterval), `${simCapital}, ${capitalInterval}`);
  const meta = await evaluate(`({
    simulated: ${bodyHas('Simulated values from fictional assumptions')},
    seed: ${bodyHas('seed 20261109')},
    bars: document.querySelectorAll('#distribution svg rect').length,
    exceedanceExact: ${bodyHas('Exact P(S > x)')},
    convergence: !!document.querySelector('#convergence svg path'),
    var995: [...document.querySelectorAll('#comparison table')[1].querySelectorAll('tbody tr')].find((r) => r.querySelector('th').textContent === '99.5%')?.querySelectorAll('td')[0].firstChild.textContent,
  })`);
  check('   labelled as simulated with its seed; histogram, exceedance (simulated and exact) and convergence drawn', meta.simulated && meta.seed && meta.bars > 10 && meta.exceedanceExact && meta.convergence, `${meta.bars} bars`);
  check('   fixed cost: the simulated 99.5% VaR is a multiple of 1,200', num(meta.var995) % 1200 === 0, meta.var995);
  await shotAll('A04-monte-carlo-reference');
  await shotElement('#distribution', 'A04a-simulated-distribution');
  await shotElement('#comparison', 'A04b-simulated-vs-exact');
  await shotElement('#exceedance', 'A04c-exceedance');
  await shotElement('#convergence', 'A04d-convergence');
  await shotElement('#simulation-settings', 'A04e-simulation-settings');
  await viewport(...VIEWPORTS.mobile);
  await shotElement('#comparison', 'A04f-simulated-vs-exact-mobile');
  await viewport(...VIEWPORTS.desktop);

  // 11. Same seed and inputs reproduce the run.
  await mcRun();
  const rowsB = await comparisonRows();
  check('11. rerunning with the same seed reproduces every simulated figure', JSON.stringify(rowsA) === JSON.stringify(rowsB));
  check('   both runs listed', (await evaluate(`document.querySelectorAll('#runs tbody tr').length`)) === 2);

  // 12. A heavy run executes off the request thread: the API keeps answering while it runs.
  await setValue('#act-preset', 'home-lognormal');
  await setValue('#mc-simulations', '80000');
  await setValue('#mc-label', 'E2E heavy lognormal');
  await click('Run simulation');
  await sleep(150);
  const probe = await evaluate(`(async () => {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = await fetch(${JSON.stringify(`${API}/health`)});
      times.push({ ms: Math.round(performance.now() - t0), ok: res.ok, busy: !!document.querySelector('[aria-busy="true"]') });
    }
    return times;
  })()`);
  await waitFor(`${bodyHas('Showing the run with seed')} && !document.querySelector('[aria-busy="true"]')`, 60000);
  const duration = await evaluate(`document.querySelector('[class*="runMeta"]')?.textContent ?? ''`);
  const whileBusy = probe.filter((p) => p.busy);
  check(
    '12. health checks answered quickly while a lognormal run was in progress',
    whileBusy.length > 0 && whileBusy.every((p) => p.ok && p.ms < 500),
    `${whileBusy.map((p) => `${p.ms} ms`).join(', ')} during the run; ${duration.replace(/\s+/g, ' ').trim()}`,
  );
  check('   lognormal run labels the exact comparison as Panjer', await evaluate(bodyHas('Exact values: Panjer recursion')));
  await shotElement('#comparison', 'A04g-lognormal-simulated-vs-exact');

  // 13. Changing an input marks the shown results as outdated.
  await click('New seed');
  check('13. a new seed marks the shown results as belonging to the previous inputs', await evaluate(bodyHas('The inputs have changed since')));

  // 14. Load the first run back; delete the heavy one.
  await click('Load E2E reference', 'button', `document.querySelector('#runs')`);
  await waitFor(bodyHas('Loaded “E2E reference”'));
  const restored = await evaluate(`({ seed: document.querySelector('#mc-seed').value, sims: document.querySelector('#mc-simulations').value, capital: document.querySelector('#mc-capital').value, outdated: ${bodyHas('The inputs have changed since')} })`);
  check('14. loading a run restores its seed, size and capital with its stored results', restored.seed === '20261109' && restored.sims === '20000' && restored.capital === '5000' && !restored.outdated, JSON.stringify(restored));
  check('   the loaded results are the stored ones', JSON.stringify(await comparisonRows()) === JSON.stringify(rowsA));
  await evaluate(`window.confirm = () => true`);
  await click('Delete E2E heavy lognormal', 'button', `document.querySelector('#runs')`);
  await waitFor(`document.querySelectorAll('#runs tbody tr').length === 2 && ${bodyHas('Deleted “E2E heavy lognormal”')}`);
  check('   run deleted after confirmation', true);

  const a11y = await evaluate(`({
    unlabelled: [...document.querySelectorAll('#simulation-settings input')].filter((el) => !document.querySelector('label[for="' + el.id + '"]')).length,
    live: document.querySelector('#mc-status')?.getAttribute('aria-live'),
    captions: [...document.querySelectorAll('#comparison table, #runs table')].every((t) => !!t.caption),
    charts: [...document.querySelectorAll('svg[role="img"]')].every((s) => (s.getAttribute('aria-label') ?? '').length > 20),
  })`);
  check('   settings labelled, status is a live region, tables captioned, charts described', a11y.unlabelled === 0 && a11y.live === 'polite' && a11y.captions && a11y.charts, JSON.stringify(a11y));

  // 15. Overview lists the recent runs and links the lab.
  await click('Overview', 'a', `document.querySelector('nav[aria-label="Actuarial lab workspaces"]')`);
  await waitFor(`location.pathname === '/actuarial' && ${bodyHas('Your recent simulations')} && ${bodyHas('E2E reference')}`);
  const links = await evaluate(`[...document.querySelectorAll('#workspaces a')].map((a) => a.getAttribute('href'))`);
  check('15. overview lists recent simulations and links each workspace to its own page', links.includes('/actuarial/monte-carlo') && links.includes('/actuarial/pricing') && (await evaluate(bodyHas('2 kept'))), links.join(', '));
}

/** Volume-weighted chain ladder written independently of the server: missing cells are skipped. */
function chainLadder(triangle, tail = 1, selected = []) {
  const n = triangle.length;
  const factors = [];
  for (let j = 0; j < n - 1; j += 1) {
    let from = 0;
    let to = 0;
    for (let i = 0; i < n - 1 - j; i += 1) {
      const a = triangle[i][j];
      const b = triangle[i][j + 1];
      if (a === null || b === null) continue;
      from += a;
      to += b;
    }
    factors.push(selected[j] ?? to / from);
  }
  const cdf = (age) => factors.slice(age - 1).reduce((p, f) => p * f, tail);
  const ultimates = triangle.map((row) => row[row.length - 1] * cdf(row.length));
  return { factors, cdf, ultimates, ultimate: ultimates.reduce((s, u) => s + u, 0), latest: triangle.reduce((s, row) => s + row[row.length - 1], 0) };
}
const parseTriangleText = (text) =>
  text
    .trim()
    .split('\n')
    .map((line) =>
      line
        .trim()
        .split(/\s+/)
        .map((t) => (t === '-' ? null : Number(t))),
    );

async function reservingSettled() {
  await sleep(700);
  await waitFor(`!document.querySelector('[aria-busy="true"]') && ${bodyHas('Results match the inputs.')}`);
  await sleep(200);
}
/** Method comparison rows: { label: [ultimate, unpaid, IBNR] } as displayed. */
const methodRows = () =>
  evaluate(`Object.fromEntries([...document.querySelectorAll('#methods tbody tr')].map((r) => [r.querySelector('th').firstChild.textContent.trim(), [...r.querySelectorAll('td')].map((td) => td.textContent.trim())]))`);

async function reserving() {
  // 16. Motor example: the paid chain ladder is checked against an independent calculation.
  await click('Reserving Studio', 'a', `document.querySelector('nav[aria-label="Actuarial lab workspaces"]')`);
  await waitFor(`location.pathname === '/actuarial/reserving' && !!document.querySelector('#rs-paid') && !!document.querySelector('#methods')`);
  await reservingSettled();
  const motorText = await evaluate(`document.querySelector('#rs-paid').value`);
  const motor = chainLadder(parseTriangleText(motorText));
  const m1 = await methodRows();
  const [paidUlt, paidUnpaid] = m1['Chain ladder (paid)'];
  check(
    '16. motor example: paid chain ladder ultimate and unpaid match an independent volume-weighted calculation (to the dinar)',
    Math.abs(num(paidUlt) - motor.ultimate) <= 1 && Math.abs(num(paidUnpaid) - (motor.ultimate - motor.latest)) <= 1,
    `${paidUlt} / ${paidUnpaid} vs ${Math.round(motor.ultimate)} / ${Math.round(motor.ultimate - motor.latest)}`,
  );
  const cashTotal = await evaluate(`[...document.querySelectorAll('#cash-flows tbody tr')].pop().querySelector('td').textContent.trim()`);
  check('   expected payments by calendar year add up to the paid chain ladder unpaid', cashTotal === paidUnpaid, `${cashTotal} vs ${paidUnpaid}`);
  check('   reconciliation reported; five methods compared; no "backend pending" label', (await evaluate(bodyHas('Reconciled: for every method'))) && Object.keys(m1).length === 5 && !(await evaluate(bodyHas('Preview · backend pending'))));
  await click('Completed', 'button', `document.querySelector('[role="group"][aria-label="Triangle view"]')`);
  const projected = await evaluate(`document.querySelectorAll('#triangle td[data-kind="projected"]').length`);
  check('   completed triangle shades the 45 projected cells of a 10-year triangle', projected === 45, `${projected} cells`);
  await shotAll('A05-reserving-motor');
  await shotElement('#triangle', 'A05a-triangle-completed');
  await shotElement('#factors', 'A05b-development-factors');
  await shotElement('#reserves', 'A05c-reserves-by-year');
  await shotElement('#sensitivity', 'A05d-sensitivity');
  await shotElement('#cash-flows', 'A05e-cash-flows');
  await viewport(...VIEWPORTS.mobile);
  await shotElement('#triangle', 'A05f-triangle-mobile');
  await shotElement('#reserving-data', 'A05g-data-entry-mobile');
  await viewport(...VIEWPORTS.desktop);

  // 17. A hand-checked 3 × 3 triangle typed in.
  const paid = [[100, 150, 165], [120, 186], [130]];
  const incurred = [[160, 170, 168], [190, 210], [200]];
  await setValue('#rs-first-origin', '2023');
  await setValue('#rs-paid', paid.map((r) => r.join(' ')).join('\n'));
  await setValue('#rs-incurred', incurred.map((r) => r.join(' ')).join('\n'));
  await setValue('#rs-premiums', '200 220 240');
  await setValue('#rs-loss-ratio', '80');
  await reservingSettled();
  const p = chainLadder(paid);
  const inc = chainLadder(incurred);
  const prior = [160, 176, 192];
  const bf = paid.reduce((s, row, i) => s + row[row.length - 1] + prior[i] * (1 - 1 / p.cdf(row.length)), 0);
  const m2 = await methodRows();
  const whole = (v) => `${Math.round(v).toLocaleString('en-US')} DT`;
  check(
    '17. hand triangle: CL paid 588, CL incurred 590, expected loss ratio 528, BF paid 575 (computed here)',
    m2['Chain ladder (paid)'][0] === whole(p.ultimate) && m2['Chain ladder (incurred)'][0] === whole(inc.ultimate) && m2['Expected loss ratio'][0] === whole(528) && m2['Bornhuetter–Ferguson (paid)'][0] === whole(bf),
    JSON.stringify(Object.fromEntries(Object.entries(m2).map(([k, v]) => [k, v[0]]))),
  );
  check('   unpaid = case reserves + IBNR: 107 = 97 + 10 for the paid chain ladder', m2['Chain ladder (paid)'][1] === '107 DT' && m2['Chain ladder (paid)'][2] === '10 DT' && (await kpi('Case reserves')) === '97 DT', JSON.stringify(m2['Chain ladder (paid)']));

  // 18. Selecting a factor replaces the estimate everywhere.
  await setValue('#rs-factor-paid-0', '1.6');
  await reservingSettled();
  const sel = chainLadder(paid, 1, [1.6]);
  const m3 = await methodRows();
  check('18. selected paid factor 1.6 for years 1–2 gives CL paid ultimate 598', m3['Chain ladder (paid)'][0] === whole(sel.ultimate), `${m3['Chain ladder (paid)'][0]} vs ${whole(sel.ultimate)}`);
  check('   the factor table marks the selection', await evaluate(`document.querySelector('#factors').innerText.includes('Using 1.6')`));
  await shotElement('#factors', 'A05h-selected-factor');

  // 19. Missing cells and recoveries are flagged, not zeroed.
  await setValue('#rs-example', 'small-book-data-issues');
  await reservingSettled();
  const issues = await evaluate(`({
    missing: document.querySelectorAll('#triangle td[data-kind="missing"]').length,
    zeroNote: document.querySelector('#checks').innerText.includes('not treated as zero'),
    recoveries: document.querySelector('#checks').innerText.includes('recoveries'),
  })`);
  await click('Cumulative', 'button', `document.querySelector('[role="group"][aria-label="Triangle view"]')`);
  const missingCells = await evaluate(`document.querySelectorAll('#triangle td[data-kind="missing"]').length`);
  check('19. data-issues example: the missing amount is shown as missing and both issues are explained', missingCells >= 1 && issues.zeroNote && issues.recoveries, JSON.stringify({ ...issues, missingCells }));
  await shotElement('#checks', 'A05i-data-checks');

  // 20. Local parsing error, then a server rejection explained in plain English.
  await setValue('#rs-paid', '100 150 abc\n120 186\n130');
  await sleep(500);
  const local = await evaluate(`({ error: document.querySelector('#rs-paid-error')?.textContent, status: document.querySelector('#rs-status').textContent })`);
  check('20. text that is not a number is caught before any request', /Line 1, amount 3: “abc” is not a number/.test(local.error ?? '') && /Fix the highlighted fields/.test(local.status), JSON.stringify(local));
  await setValue('#rs-paid', '100 150 165\n120 -\n130');
  await setValue('#rs-incurred', '');
  await waitFor(bodyHas('the latest paid amount of accident year'), 10000);
  check('   a missing latest amount is rejected by the server with the accident year named', await evaluate(bodyHas('The results below were computed for earlier inputs')));

  // 21. Save, list on the overview, reload, delete.
  await setValue('#rs-example', 'motor-own-damage');
  await reservingSettled();
  await setValue('#rs-run-label', 'E2E motor year-end');
  await click('Save run');
  await waitFor(`[...document.querySelectorAll('#runs tbody th')].some((t) => t.textContent.startsWith('E2E motor year-end'))`);
  const savedUnpaid = await evaluate(`[...document.querySelectorAll('#runs tbody tr')][0].querySelectorAll('td')[1].textContent.trim()`);
  check('21. run saved and listed with the unpaid the server computed', num(savedUnpaid) > 0 && (await evaluate(bodyHas('Saved “E2E motor year-end”'))), savedUnpaid);
  await click('Overview', 'a', `document.querySelector('nav[aria-label="Actuarial lab workspaces"]')`);
  await waitFor(`location.pathname === '/actuarial' && ${bodyHas('Your recent reserving runs')} && ${bodyHas('E2E motor year-end')}`);
  check('   overview lists the reserving run and links the studio', (await evaluate(`[...document.querySelectorAll('#workspaces a')].map((a) => a.getAttribute('href'))`)).includes('/actuarial/reserving'));
  await click('Reserving Studio', 'a', `document.querySelector('nav[aria-label="Actuarial lab workspaces"]')`);
  await waitFor(`location.pathname === '/actuarial/reserving' && [...document.querySelectorAll('#runs tbody th')].some((t) => t.textContent.startsWith('E2E motor year-end'))`);
  await reservingSettled();
  await setValue('#rs-tail-paid', '1.1');
  await reservingSettled();
  await click('Load E2E motor year-end', 'button', `document.querySelector('#runs')`);
  await waitFor(bodyHas('Loaded “E2E motor year-end”'));
  const restored = await evaluate(`({ tail: document.querySelector('#rs-tail-paid').value, stored: ${bodyHas('Showing the stored results of “E2E motor year-end”')} })`);
  check('   loading the run restores its assumptions and stored results', restored.tail === '1' && restored.stored, JSON.stringify(restored));
  const a11y = await evaluate(`({
    unlabelled: [...document.querySelectorAll('#reserving-data input, #reserving-data select, #reserving-data textarea, #reserving-assumptions input, #factors input, #runs input')].filter((el) => !document.querySelector('label[for="' + el.id + '"]')).length,
    live: document.querySelector('#rs-status')?.getAttribute('aria-live'),
    captions: [...document.querySelectorAll('#triangle table, #factors table, #reserves table, #methods table, #sensitivity table, #cash-flows table, #runs table')].every((t) => !!t.caption),
    charts: [...document.querySelectorAll('svg[role="img"]')].every((s) => (s.getAttribute('aria-label') ?? '').length > 20),
  })`);
  check('   inputs and factor cells labelled, status is a live region, tables captioned, charts described', a11y.unlabelled === 0 && a11y.live === 'polite' && a11y.captions && a11y.charts, JSON.stringify(a11y));
  await evaluate(`window.confirm = () => true`);
  await click('Delete E2E motor year-end', 'button', `document.querySelector('#runs')`);
  await waitFor(`${bodyHas('Deleted “E2E motor year-end”')} && ${bodyHas('No saved runs')}`);
  check('   run deleted after confirmation', true);
}

let exitCode = 0;
try {
  await run();
} catch (error) {
  check('journey ran to completion', false, error.message);
  try {
    await shot('failure');
  } catch {
    /* ignore */
  }
}
exitCode = results.every((r) => r.ok) ? 0 : 1;
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed. Screenshots: ${SHOTS}`);
ws.close();
edge.kill();
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* Edge may still hold the profile briefly */
}
process.exit(exitCode);
