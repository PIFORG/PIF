#!/usr/bin/env node
/**
 * Browser journey for the phase-3 trading slice on the Angular app backed by the Spring API:
 * Login → Dashboard → Markets → select an instrument → order preview → place a virtual order → verify the
 * execution → check the updated portfolio → review the order history → logout, plus a rejected order, a working
 * limit order that is cancelled, and repeated submissions of one order (double click and an API replay).
 *
 * Every figure shown in the browser is compared with the rows Spring wrote to PostgreSQL.
 *
 * Prerequisites (development only):
 *   - Angular on JOURNEY_ANGULAR_URL (default http://localhost:4200) using the Spring API (http://localhost:3002)
 *   - DATABASE_URL pointing at the `*_test` database Spring uses (the script refuses anything else)
 *
 *   node scripts/migration/angular-trading-journey.mjs [<screenshot-dir>]
 *
 * The account is disposable (@spring-trading-journey.test) and removed at the end with its portfolios. Only the
 * Spring API writes its financial records; the NestJS API never reads or writes them during this journey.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../tools/db-harness/index.mjs';
import { connect } from '../../apps/api/contract/visual-account.mjs';
import { launchEdge, sleep } from './headless-edge.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ANGULAR = process.env.JOURNEY_ANGULAR_URL ?? 'http://localhost:4200';
const SPRING_API = process.env.SPRING_URL ?? 'http://localhost:3002';
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/migration/screenshots/trading-journey');
const DOMAIN = '@spring-trading-journey.test';
const RUN = Date.now().toString(36);
const EMAIL = `trader-${RUN}${DOMAIN}`;
const PASSWORD = 'Journey-Pass-1!';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const { prisma, dbName } = await connect();
mkdirSync(SHOTS, { recursive: true });
const browser = await launchEdge({ port: 9351, name: 'angular-trading-journey' });
await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await browser.viewport(1440, 900);

// ---------------------------------------------------------------- helpers

async function shot(name) {
  const m = await browser.send('Page.getLayoutMetrics');
  const height = Math.min(Math.ceil(m.cssContentSize.height), 6000);
  const res = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.cssLayoutViewport.clientWidth, height, scale: 1 } });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
}

const path = () => browser.evaluate('location.pathname + location.search');
/** Clicks a button by its text content (innerText follows CSS: upper-cased badges, collapsed screen-reader text). */
async function clickContent(label) {
  const ok = await browser.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`button "${label}" not found or disabled`);
}
const rowsOf = (caption) => `([...document.querySelectorAll('table')].find((t) => t.querySelector('caption')?.textContent === ${JSON.stringify(caption)})?.querySelectorAll('tbody tr').length ?? 0)`;
const text = (selector) => browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText?.trim() ?? ''`);
const kpi = (label) =>
  browser.evaluate(`[...document.querySelectorAll('.ws-kpi')].find((k) => k.querySelector('.ws-kpiLabel')?.textContent === ${JSON.stringify(label)})?.querySelector('.ws-kpiValue')?.innerText.trim() ?? ''`);
/** In-app navigation through the sidebar: no full page load, so no extra session refresh. */
const nav = async (href, ready) => {
  await browser.click(`a.link[href="${href}"]`);
  await browser.waitFor(`location.pathname === ${JSON.stringify(href)}`);
  if (ready) await browser.waitFor(ready);
};

/** Formatting of apps/web(-angular) trading pages: DT amounts with 3 decimals and a true minus sign. */
const dt = (millimes) => `${millimes < 0n ? '\u2212' : ''}${(Number(millimes < 0n ? -millimes : millimes) / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;
const price3 = (millimes) => (Number(millimes) / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Server responses and order submissions seen by the page (bodies only; request headers are never recorded). */
const previews = [];
const submissions = [];
const statuses = [];
browser.on('Network.requestWillBeSent', ({ request }) => {
  if (request.method === 'POST' && /\/api\/portfolios\/[^/]+\/orders$/.test(new URL(request.url).pathname)) submissions.push(JSON.parse(request.postData ?? '{}'));
});
browser.on('Network.responseReceived', async ({ requestId, response }) => {
  const { pathname } = new URL(response.url);
  if (!pathname.startsWith('/api/')) return;
  statuses.push({ path: pathname, status: response.status });
  if (!/\/orders\/preview$/.test(pathname)) return;
  await sleep(50);
  try {
    previews.push(JSON.parse((await browser.send('Network.getResponseBody', { requestId })).body));
  } catch {
    /* body evicted; the check that needs it reports the gap */
  }
});

async function createUser() {
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: EMAIL,
      firstName: 'Journey',
      lastName: 'Trader',
      passwordHash: await hashPassword(PASSWORD),
      emailVerified: true,
      emailVerifiedAt: now,
      status: 'ACTIVE',
    },
  });
  await prisma.userPreferences.create({ data: { id: randomUUID(), userId: user.id, updatedAt: now } });
  return user;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await prisma.auditEvent.deleteMany({ where: { OR: [{ subjectUserId: { in: ids } }, { actorUserId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function apiLogin() {
  const res = await fetch(`${SPRING_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ANGULAR },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.accessToken) throw new Error(`API sign-in failed: ${res.status} ${body.errorCode ?? ''}`);
  return body.accessToken;
}

async function ledger(portfolioId) {
  const [portfolio, orders, executions, entries, positions] = await Promise.all([
    prisma.tradingPortfolio.findUnique({ where: { id: portfolioId } }),
    prisma.tradingOrder.findMany({ where: { portfolioId }, orderBy: { sequence: 'asc' }, include: { instrument: true } }),
    prisma.tradingExecution.findMany({ where: { portfolioId }, orderBy: { sequence: 'asc' }, include: { instrument: true } }),
    prisma.portfolioCashEntry.findMany({ where: { portfolioId }, orderBy: { sequence: 'asc' } }),
    prisma.portfolioPosition.findMany({ where: { portfolioId }, include: { instrument: true } }),
  ]);
  const sum = entries.reduce((s, e) => s + e.amountMillimes, 0n);
  return { portfolio, orders, executions, entries, positions, consistent: sum === portfolio.cashMillimes && entries.at(-1)?.balanceAfterMillimes === portfolio.cashMillimes };
}

// ---------------------------------------------------------------- journey

async function journey() {
  const user = await createUser();

  // 1. Login → Dashboard
  await browser.go(`${ANGULAR}/login`, `!!document.querySelector('#email') && !!document.querySelector('[ng-version]')`);
  await browser.setValue('#email', EMAIL);
  await browser.setValue('#password', PASSWORD);
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`location.pathname === '/dashboard' && !!document.querySelector('.db-modules')`);
  check('T1. login lands on the Angular dashboard', (await text('h1')) === 'Welcome back, Journey', await text('h1'));
  check('    the dashboard shows no simulated figures until the sample is requested', (await kpi('Simulated portfolio value')).startsWith('—') && !(await browser.evaluate(`!!document.querySelector('[data-demo="true"]')`)));
  await browser.waitFor(`!!document.querySelector('#learning .db-progress')`);
  // One API login for the whole journey: after browser sign-out, this session alone must remain.
  const token = await apiLogin();
  const learningResponse = await fetch(`${SPRING_API}/api/learning/profile`, { headers: { Authorization: `Bearer ${token}` } });
  if (!learningResponse.ok) throw new Error(`Learning profile returned ${learningResponse.status}`);
  const learningProfile = await learningResponse.json();
  // The Learning panel is backed by GET /api/learning/profile on Spring: it must show the real counters, be
  // marked as live-integrated, and never fall back to a "not migrated" / placeholder notice.
  const learningPanel = await browser.evaluate(`(() => {
    const panel = document.querySelector('#learning');
    return {
      text: panel?.innerText ?? '',
      status: panel?.querySelector('.ws-status')?.getAttribute('data-status') ?? null,
      empty: /Learning progress unavailable/i.test(panel?.innerText ?? ''),
    };
  })()`);
  const learningProgress = `${learningProfile.stats.missionsPassed} of ${learningProfile.stats.playableMissions} missions passed`;
  check('    dashboard learning panel shows real progress from Spring (missions passed, Live integrated, no "not migrated")',
    learningPanel.text.includes(learningProgress)
    && learningProfile.stats.missionsPassed === 0 && learningProfile.stats.playableMissions > 0
    && learningPanel.status === 'LIVE_INTEGRATED'
    && !/not migrated|on its way|coming soon/i.test(learningPanel.text)
    && !learningPanel.empty,
    `${learningProgress}; status ${learningPanel.status}`);
  await shot('T1-dashboard');

  // 2. Markets
  await nav('/markets', `${rowsOf('All instruments')} > 0`);
  const instruments = await prisma.instrument.findMany({ orderBy: { symbol: 'asc' } });
  const rows = await browser.evaluate(rowsOf('All instruments'));
  check('    a new account starts with an empty watchlist', await browser.evaluate(`document.body.innerText.includes('Your watchlist is empty')`));
  check('T2. markets lists every instrument of the fictional universe', rows === instruments.length && rows > 0, `${rows} rows / ${instruments.length} instruments`);
  check('    prices are labelled fictional and simulated', (await text('.tr-provenance')).includes('Fictional simulated prices'));
  check('    every instrument in the database is marked fictional', instruments.every((i) => i.fictional), instruments.map((i) => i.symbol).join(' '));
  await shot('T2-markets');

  // 3. Select an instrument → trading desk (no portfolio yet → create one)
  const equity = instruments.find((i) => i.assetClass === 'EQUITY' && i.status === 'ACTIVE');
  const other = instruments.find((i) => i.status === 'ACTIVE' && i.id !== equity.id);
  await browser.click(`a[href="/trading?symbol=${equity.symbol}"]`);
  await browser.waitFor(`location.pathname === '/trading' && document.body.innerText.includes('Start with a virtual portfolio')`);
  check('T3. selecting an instrument opens the trading desk for it', (await path()) === `/trading?symbol=${equity.symbol}` && (await browser.evaluate(`document.querySelector('.tr-instrumentRow[data-selected="true"] strong')?.textContent`)) === equity.symbol, await path());
  check('    without a portfolio the desk offers to create one', (await text('mtr-order-ticket')).includes('Create a portfolio to trade'));
  await shot('T3-desk-no-portfolio');
  await browser.setValue('#portfolio-name', 'Journey core');
  await browser.click('mtr-create-portfolio-form button[type="submit"]');
  await browser.waitFor(`!!document.querySelector('mtr-order-ticket form') && !!document.querySelector('.tr-kpis')`);
  const created = await prisma.tradingPortfolio.findFirst({ where: { userId: user.id } });
  check('    creating a portfolio records 100,000 DT of opening capital once', created?.cashMillimes === 100_000_000n && (await prisma.portfolioCashEntry.count({ where: { portfolioId: created.id } })) === 1);
  check('    the KPI shows the stored cash', (await kpi('Cash available')) === dt(created.cashMillimes), await kpi('Cash available'));
  const storage = await browser.evaluate(`JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)) + document.cookie`);
  check('    Web Storage holds only the active portfolio id, never a token', storage === JSON.stringify({ 'pif.activePortfolioId': created.id }) + '{}', storage.replace(/[0-9a-f-]{36}/g, '<id>'));

  // 4. Order preview
  const before = await ledger(created.id);
  await browser.setValue('#ticket-quantity', '10');
  await browser.clickText('Preview order');
  await browser.waitFor(`!!document.querySelector('.tr-review h3')`);
  await sleep(200);
  const preview = previews.at(-1);
  check('T4. preview shows the server review for the chosen order', (await text('.tr-review h3')) === `Review: buy 10 ${equity.symbol} · Market`, await text('.tr-review h3'));
  const shown = await browser.evaluate(`Object.fromEntries([...document.querySelectorAll('.tr-review .tr-reviewRows > div')].map((d) => [d.querySelector('dt').innerText.trim(), d.querySelector('dd').innerText.trim()]))`);
  const toMillimes = (v) => BigInt(Math.round(v * 1000));
  check('    fee and total shown are the server estimate', !!preview && shown['Estimated fee'] === dt(toMillimes(preview.estimate.fee)) && shown['Estimated total cost'] === dt(toMillimes(preview.estimate.total)), JSON.stringify(shown));
  const afterPreview = await ledger(created.id);
  check('    a preview writes nothing', afterPreview.orders.length === 0 && afterPreview.portfolio.version === before.portfolio.version);
  await shot('T4-preview');

  // 5. Place the virtual order (two clicks in the same instant: one order)
  await browser.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Confirm buy'); b.click(); b.click(); return true; })()`);
  await browser.waitFor(`!!document.querySelector('.tr-toast')`);
  await sleep(500);
  const placed = await ledger(created.id);
  const fill = placed.executions[0];
  check('T5. placing the order fills it once at the quoted ask', placed.orders.length === 1 && placed.orders[0].status === 'FILLED' && placed.executions.length === 1, `${placed.orders.length} order(s), ${placed.executions.length} fill(s), ${submissions.length} submission(s)`);
  const toast = (await text('.tr-toast')).replace(/\s*Dismiss$/, '');
  const filledText = `Bought 10 ${equity.symbol} at ${price3(fill.priceMillimes)} DT on average (fees ${dt(fill.feeMillimes)}).`;
  check('    the confirmation states the stored fill', toast === filledText || toast === `This order was already placed; here is its result. ${filledText}`, toast);
  check('    a double click sends one order reference; the repeat is replayed, not executed again', submissions.length >= 1 && new Set(submissions.map((s) => s.clientOrderId)).size === 1, `${submissions.length} request(s)`);
  check('    the cash ledger matches the portfolio and debits notional plus fee', placed.consistent && placed.portfolio.cashMillimes === before.portfolio.cashMillimes - fill.notionalMillimes - fill.feeMillimes);
  await shot('T5-filled');

  // 6. Verify the execution on the desk
  await browser.waitFor(`document.querySelectorAll('mtr-trades-table tbody tr').length === 1`);
  check('T6. the trade appears in recent trades', (await text('mtr-trades-table tbody tr')).includes(`Buy ${equity.symbol}`));
  check('    the position shows 10 units', (await text('mtr-positions-table tbody tr')).includes(equity.symbol) && (await browser.evaluate(`document.querySelector('mtr-positions-table tbody tr td').innerText.trim()`)) === '10');
  check('    the cash KPI equals the stored cash', (await kpi('Cash available')) === dt(placed.portfolio.cashMillimes), await kpi('Cash available'));

  // 7. Repeated request through the API with the same reference: replayed, nothing new written
  const replay = await fetch(`${SPRING_API}/api/portfolios/${created.id}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, Origin: ANGULAR },
    body: JSON.stringify(submissions[0]),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const afterReplay = await ledger(created.id);
  check('T7. resending the same order is replayed with the original result', replay.status === 201 && replay.body.replayed === true && replay.body.order.id === placed.orders[0].id, `${replay.status} replayed=${replay.body.replayed}`);
  check('    the replay writes nothing', afterReplay.orders.length === 1 && afterReplay.executions.length === 1 && afterReplay.portfolio.version === placed.portfolio.version);
  const conflict = await fetch(`${SPRING_API}/api/portfolios/${created.id}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, Origin: ANGULAR },
    body: JSON.stringify({ ...submissions[0], quantity: 11 }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  check('    the same reference with different terms is refused', conflict.status === 409 && conflict.body.errorCode === 'IDEMPOTENCY_KEY_REUSED', `${conflict.status} ${conflict.body.errorCode}`);

  // 8. Rejected order: the preview refuses to confirm; a submitted one is stored as REJECTED without moving cash
  await browser.evaluate(`[...document.querySelectorAll('.tr-instrumentButton')].find((b) => b.querySelector('strong')?.textContent === ${JSON.stringify(other.symbol)})?.click()`);
  await browser.waitFor(`document.querySelector('#ticket-symbol')?.value === ${JSON.stringify(other.symbol)}`);
  await browser.clickText('Sell');
  await browser.setValue('#ticket-quantity', '5');
  await browser.clickText('Preview order');
  await browser.waitFor(`document.querySelector('.tr-review h3')?.innerText === 'This order would be rejected'`);
  check('T8. selling an instrument not held is refused at preview, with no confirm button', !(await browser.evaluate(`[...document.querySelectorAll('button')].some((b) => b.innerText.startsWith('Confirm'))`)), await text('.tr-review p'));
  await shot('T8-rejected-preview');
  await sleep(200);
  const rejectedPreview = previews.at(-1);
  const rejected = await fetch(`${SPRING_API}/api/portfolios/${created.id}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, Origin: ANGULAR },
    body: JSON.stringify({ symbol: other.symbol, side: 'SELL', type: 'MARKET', quantity: 5, clientOrderId: `journey-reject-${RUN}`, expectedVersion: rejectedPreview.portfolioVersion, quoteAsOf: rejectedPreview.quote.asOf }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const afterReject = await ledger(created.id);
  check('    a submitted rejected order is stored as REJECTED and moves no cash', ['REJECTED'].includes(rejected.body.order?.status) && afterReject.portfolio.cashMillimes === afterReplay.portfolio.cashMillimes && afterReject.executions.length === 1, `${rejected.status} ${rejected.body.order?.status ?? rejected.body.errorCode}`);

  // 9. Working limit order, then cancel it
  await browser.clickText('Buy');
  await browser.clickText('Limit');
  const limit = (Math.floor(rejectedPreview.quote.mid * 0.8 * 1000) / 1000).toFixed(3);
  await browser.setValue('#ticket-quantity', '5');
  await browser.setValue('#ticket-price', limit);
  await browser.clickText('Preview order');
  await browser.waitFor(`(document.querySelector('.tr-review h3')?.innerText ?? '').startsWith('Review: buy 5')`);
  await browser.clickText('Confirm buy');
  await browser.waitFor(`(document.querySelector('.tr-toast')?.innerText ?? '').includes('is working')`);
  await browser.waitFor(`document.querySelectorAll('mtr-orders-table tbody tr').length === 1`);
  const resting = (await ledger(created.id)).portfolio;
  check('T9. a limit buy below the market rests as a working order', (await browser.evaluate(`document.querySelector('mtr-orders-table tbody tr [mtr-order-status]')?.textContent.trim()`)) === 'Working', await text('.tr-toast'));
  check('    its cash is reserved, not spent', (await kpi('Cash available')) !== dt(resting.cashMillimes) && resting.cashMillimes === afterReject.portfolio.cashMillimes);
  await shot('T9-working-order');
  await clickContent(`Cancel Buy ${other.symbol}`);
  await browser.waitFor(`(document.querySelector('.tr-toast')?.innerText ?? '').startsWith('Cancelled your buy order')`);
  await browser.waitFor(`!!document.querySelector('mtr-orders-table .ws-empty')`);
  const cancelled = await ledger(created.id);
  check('    cancelling releases the reservation and stores CANCELLED', cancelled.orders.at(-1).status === 'CANCELLED' && (await kpi('Cash available')) === dt(cancelled.portfolio.cashMillimes));

  // 10. Updated portfolio and order history
  await nav('/portfolios', `!!document.querySelector('.tr-reviewRows') && !!document.querySelector('mtr-orders-table tbody')`);
  const final = await ledger(created.id);
  const view = await fetch(`${SPRING_API}/api/portfolios/${created.id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  check('T10. the portfolio page shows the server equity and cash', (await kpi('Equity')) === dt(toMillimes(view.equity)) && (await text('.tr-kpis .ws-kpi .ws-kpiHint')).startsWith(`Cash ${dt(final.portfolio.cashMillimes)}`), `${await kpi('Equity')} · ${await text('.tr-kpis .ws-kpi .ws-kpiHint')}`);
  check('     the reconciliation says the cash matches the ledger', (await browser.evaluate(`[...document.querySelectorAll('.tr-reviewRows > div')].find((d) => d.innerText.startsWith('Cash matches the ledger'))?.querySelector('dd').innerText`)) === 'Yes' && final.consistent);
  const orderRows = await browser.evaluate(`[...document.querySelectorAll('mtr-orders-table tbody tr [mtr-order-status]')].map((s) => s.textContent.trim())`);
  check('     the order history lists every stored order with its status', orderRows.length === final.orders.length && orderRows.includes('Filled') && orderRows.includes('Rejected') && orderRows.includes('Cancelled'), orderRows.join(', '));
  await shot('T10-portfolio');
  await browser.clickText('Trades');
  await browser.waitFor(`!!document.querySelector('mtr-trades-table')`);
  check('     the trades tab lists the single fill', (await browser.evaluate(`document.querySelectorAll('mtr-trades-table tbody tr').length`)) === final.executions.length);
  await browser.clickText('Cash');
  await browser.waitFor(`!!document.querySelector('mtr-cash-ledger-table')`);
  const cashRows = await browser.evaluate(`[...document.querySelectorAll('mtr-cash-ledger-table tbody tr th strong')].map((s) => s.innerText)`);
  check('     the cash tab lists the opening deposit and the buy', cashRows.length === final.entries.length && cashRows.includes('Deposit') && cashRows.includes('Buy'), cashRows.join(', '));
  await shot('T10-cash-ledger');

  // 11. Logout
  await browser.click('button[aria-haspopup="menu"]');
  await browser.waitFor(`!!document.querySelector('[role="menu"]')`);
  await browser.clickText('Sign out');
  await browser.waitFor(`location.pathname === '/login'`);
  await browser.go(`${ANGULAR}/trading`, `location.pathname === '/login'`);
  check('T11. after logout the trading desk requires sign-in again', (await path()) === '/login?returnTo=%2Ftrading', await path());
  const live = await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } });
  check('     logout revoked the browser session (only the separate API session of step 7 remains)', live === 1, `${live} live session(s)`);
}

try {
  console.log(`Database: ${dbName}`);
  await cleanup();
  await journey();
} catch (error) {
  check(`journey aborted: ${error.message}`, false);
  await shot('aborted').catch(() => undefined);
} finally {
  await sleep(200);
  browser.close();
  await cleanup().catch((e) => check(`cleanup failed: ${e.message}`, false));
  await prisma.$disconnect();
}
if (browser.allPageErrors.length) check('no uncaught page errors', false, browser.allPageErrors.join(' | '));
const failures = statuses.filter((s) => s.status >= 500 || s.status === 429);
check('no server error or rate limit during the journey', failures.length === 0, failures.map((s) => `${s.status} ${s.path}`).join(', '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
writeFileSync(join(SHOTS, 'results.json'), JSON.stringify({ ranAt: new Date().toISOString(), database: dbName, results }, null, 2));
process.exit(failed ? 1 : 0);
