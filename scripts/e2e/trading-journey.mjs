#!/usr/bin/env node
/**
 * Browser end-to-end journey for virtual trading (Markets, Trading desk, Portfolios), driven through
 * headless Microsoft Edge over the DevTools protocol.
 *
 * Prerequisites (development only):
 *   - API running with MAIL_TRANSPORT=preview against a `_test` database that has the
 *     virtual-trading migration applied
 *   - Web running on E2E_WEB_URL (default http://localhost:3000)
 *
 *   npm run test:e2e:trading [-- <screenshot-dir>]
 *
 * Registers a throwaway @example.test account with a random password that is never printed, then:
 *  1 opens the desk with no portfolio · 2 creates one · 3 browses the chart · 4 previews and buys ·
 *  5 is refused an unaffordable order · 6 places and cancels a resting limit · 7 sets a stop-loss ·
 *  8 sells · 9 follows an instrument · 10 reads performance, risk and reconciliation ·
 *  11 deposits cash · 12 reads the full history · 13 trades from the Markets page.
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
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/trading/screenshots');
const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9344;
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

// ---------- headless Edge ----------
mkdirSync(SHOTS, { recursive: true });
const profile = join(tmpdir(), `mtrs-trading-e2e-${Date.now()}`);
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
  const height = Math.min(Math.ceil(m.cssContentSize.height), 7000);
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
async function setValue(selector, value) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Field ${selector} not found`);
}
async function click(label, tag = 'button', scope = 'document') {
  const ok = await evaluate(`(() => {
    const el = [...${scope}.querySelectorAll(${JSON.stringify(tag)})].find((x) => (x.getAttribute('aria-label') ?? x.innerText).trim().startsWith(${JSON.stringify(label)}));
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`${tag} "${label}" not found or disabled`);
}
const TICKET = `document.querySelector('form[aria-label="Order ticket"]')`;
const REVIEW = `document.querySelector('[aria-label="Order preview"]')`;
const toastText = `([...document.querySelectorAll('[role="status"]')].map((n) => n.innerText).join(' | '))`;
const num = (text) => Number(String(text).replace(/[^0-9.\-\u2212]/g, '').replace('\u2212', '-'));

async function fillTicket({ symbol, side = 'BUY', type = 'MARKET', quantity, price }) {
  await setValue('#ticket-symbol', symbol);
  await click(side === 'BUY' ? 'Buy' : 'Sell', 'button', `${TICKET}`);
  await click({ MARKET: 'Market', LIMIT: 'Limit', STOP: 'Stop-loss' }[type], 'button', `${TICKET}`);
  await setValue('#ticket-quantity', quantity);
  if (price !== undefined) await setValue('#ticket-price', price);
}
async function previewTicket() {
  await click('Preview order', 'button', TICKET);
  await waitFor(`!!${REVIEW}`);
  return evaluate(`(() => {
    const rows = Object.fromEntries([...${REVIEW}.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt').innerText.trim(), d.querySelector('dd').innerText.trim()]));
    return { title: ${REVIEW}.querySelector('h3').innerText, rows, text: ${REVIEW}.innerText };
  })()`);
}
/** Confirms; if the quote rolled to the next 5-minute period in between, the UI re-previews and we confirm again. */
async function confirmTicket(word) {
  const before = await evaluate(toastText);
  await click(`Confirm ${word}`, 'button', TICKET);
  await waitFor(`${toastText} !== ${JSON.stringify(before)} || /price moved to a new quote|portfolio changed/i.test(${TICKET}.innerText)`);
  if (await evaluate(`/price moved to a new quote|portfolio changed/i.test(${TICKET}.innerText) && !!${REVIEW}`)) {
    check('   (the quote rolled over before confirming; the ticket re-previewed at the new price)', true);
    await click(`Confirm ${word}`, 'button', TICKET);
    await waitFor(`${toastText} !== ${JSON.stringify(before)}`);
    return { toast: await evaluate(toastText), rolled: true };
  }
  return { toast: await evaluate(toastText), rolled: false };
}

async function run() {
  // 0. Throwaway trader through the real registration and verification flow.
  const email = `e2e-trading-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}@example.test`;
  const password = `${randomBytes(12).toString('base64url')}a7!`;
  const t0 = Date.now() - 1000;
  const reg = await api('POST', '/auth/register', { firstName: 'Tarek', lastName: 'Trader', email, password, passwordConfirmation: password });
  check('throwaway trader registered', reg.status === 201, `HTTP ${reg.status}`);
  const verified = await api('POST', '/auth/verify-email', { token: await verificationToken(email, t0) });
  check('email verified through the captured link token', verified.status === 200, `HTTP ${verified.status}`);

  // 1. Desk with no portfolio yet.
  await viewport(...VIEWPORTS.desktop);
  await go(`${WEB}/login?returnTo=%2Ftrading`, `!!document.querySelector('input[name="email"]')`);
  await setValue('input[name="email"]', email);
  await setValue('input[name="password"]', password);
  await click('Sign in');
  await waitFor(`location.pathname === '/trading' && ${bodyHas('Start with a virtual portfolio')}`);
  await waitFor(`document.querySelectorAll('ul li[data-selected]').length > 0`);
  const empty = await evaluate(`({
    instruments: document.querySelectorAll('ul li[data-selected]').length,
    provenance: ${bodyHas('Fictional simulated prices')},
    ticket: ${bodyHas('Create a portfolio to trade')},
    live: ${bodyHas('Preview · backend pending')},
  })`);
  check('1. desk lists the 7 fictional instruments and labels prices as fictional', empty.instruments === 7 && empty.provenance, JSON.stringify(empty));
  check('   without a portfolio the ticket asks for one instead of pretending to trade', empty.ticket);
  check('   the desk is not labelled as a pending preview', !empty.live);
  await shotAll('T01-desk-empty');

  // 2. Create a portfolio.
  await setValue('#portfolio-name', 'E2E Core');
  await setValue('#portfolio-capital', '100000');
  await click('Create portfolio');
  await waitFor(`!!document.querySelector('#ticket-quantity')`);
  const equity = await evaluate(`[...document.querySelectorAll('div')].find((d) => d.firstElementChild?.innerText?.trim().toLowerCase() === 'equity')?.innerText ?? ''`);
  check('2. portfolio created with 100,000.000 DT of virtual cash', /100,000\.000 DT/.test(equity), equity.replace(/\s+/g, ' '));

  // 3. Chart and quote details.
  await click('CTB', 'button');
  await waitFor(`${bodyHas('Carthage Bank')} && !!document.querySelector('figure svg path')`);
  await click('5D', 'button');
  await waitFor(`[...document.querySelectorAll('[aria-label="Chart range"] button')].find((b) => b.innerText === '5D')?.getAttribute('aria-pressed') === 'true' && /5D/.test(document.querySelector('figure')?.innerText + document.body.innerText)`);
  const quote = await evaluate(`Object.fromEntries([...document.querySelectorAll('dl')].flatMap((dl) => [...dl.querySelectorAll(':scope > div')]).map((d) => [d.querySelector('dt')?.innerText.trim(), d.querySelector('dd')?.innerText.trim()]))`);
  check('3. instrument chart renders with bid, ask, spread and size at best price', !!quote.Bid && !!quote.Ask && /bps/.test(quote.Spread ?? '') && !!quote['Size at best price'], `bid ${quote.Bid} ask ${quote.Ask} ${quote.Spread}`);

  // 4. Invalid input never reaches the server; then a priced preview and a market buy.
  await fillTicket({ symbol: 'CTB', quantity: '1.5' });
  await click('Preview order', 'button', TICKET);
  await waitFor(bodyHas('Enter a whole number of units, at least 1.'));
  check('4. a fractional quantity is refused by the form', !(await evaluate(`!!${REVIEW}`)));
  await fillTicket({ symbol: 'CTB', quantity: '50' });
  const review = await previewTicket();
  const ask = num(review.rows['Ask price now']);
  const notional = num(review.rows['Estimated amount']);
  const fee = num(review.rows['Estimated fee']);
  const total = num(review.rows['Estimated total cost']);
  const expectedNotional = Math.round(ask * 50 * 1000) / 1000;
  const expectedFee = Math.max(0.5, Math.round(expectedNotional * 0.0025 * 1000) / 1000);
  check(
    '   server preview: amount = 50 × ask, fee = max(0.25 %, 0.500 DT), total = amount + fee',
    review.title === 'Review: buy 50 CTB · Market' && Math.abs(notional - expectedNotional) < 0.0005 && Math.abs(fee - expectedFee) < 0.0015 && Math.abs(total - (notional + fee)) < 0.0005,
    `ask ${ask}, amount ${notional}, fee ${fee}, total ${total}`,
  );
  await shotAll('T02-desk-preview');
  const bought = await confirmTicket('buy');
  const fill = /Bought 50 CTB at ([\d,.]+) DT on average \(fees ([\d,.]+) DT\)/.exec(bought.toast);
  check('   market buy filled by the server', !!fill, bought.toast.slice(0, 140));
  if (fill && !bought.rolled) check('   the fill matches the preview: same price and same fee', num(fill[1]) === ask && num(fill[2]) === fee, `fill ${fill[1]} / fee ${fill[2]}`);
  await waitFor(`[...document.querySelectorAll('table caption')].some((c) => /Open positions/.test(c.innerText)) && /CTB/.test([...document.querySelectorAll('table')].find((t) => /Open positions/.test(t.caption?.innerText ?? ''))?.innerText ?? '')`);
  const position = await evaluate(`(() => {
    const row = [...[...document.querySelectorAll('table')].find((t) => /Open positions/.test(t.caption?.innerText ?? '')).querySelectorAll('tbody tr')].find((r) => /CTB/.test(r.querySelector('th').innerText));
    return row ? [...row.querySelectorAll('td')].map((c) => c.innerText.trim()) : null;
  })()`);
  check('   the position appears with 50 units at an average cost that includes the fee', position?.[0] === '50' && fill && Math.abs(num(position[1]) - Math.round(((num(fill[1]) * 50 + num(fill[2])) / 50) * 1000) / 1000) <= 0.001, JSON.stringify(position?.slice(0, 2)));

  // 5. Unaffordable order: the server preview rejects it and there is nothing to confirm.
  await fillTicket({ symbol: 'OLV', quantity: '900000' });
  const refused = await previewTicket();
  check('5. an unaffordable buy is shown as rejected by the server, with no confirm button', /would be rejected/i.test(refused.title) && !(await evaluate(`[...${TICKET}.querySelectorAll('button')].some((b) => /^Confirm/.test(b.innerText))`)), refused.text.split('\n').slice(0, 2).join(' '));

  // 6. Resting limit buy, then cancel it.
  const olvMid = await evaluate(`Number([...document.querySelectorAll('ul li[data-selected]')].find((li) => /OLV/.test(li.innerText)).querySelector('.num').innerText.replace(/[^0-9.]/g, ''))`);
  const limit = (Math.floor(olvMid * 0.8 * 1000) / 1000).toFixed(3);
  await fillTicket({ symbol: 'OLV', type: 'LIMIT', quantity: '10', price: limit });
  const resting = await previewTicket();
  check('6. a limit below the market previews as waiting, with cash reserved at the limit', /No, it waits/.test(resting.text) && num(resting.rows['Limit price (the most you pay)']) === Number(limit), resting.rows['Limit price (the most you pay)']);
  const working = await confirmTicket('buy');
  check('   the limit order is accepted and working', /limit buy of 10 OLV at [\d,.]+ DT is working/i.test(working.toast), working.toast.slice(0, 120));
  await waitFor(`/Cancel/.test([...document.querySelectorAll('section')].find((s) => /Working orders/.test(s.innerText))?.innerText ?? '')`);
  check('   cash is reserved for it', await evaluate(`/reserved for orders/.test(document.body.innerText)`));
  await click('Cancel');
  await waitFor(`/Cancelled your buy order for OLV/.test(${toastText})`);
  await waitFor(`/No working orders/.test(document.body.innerText)`);
  check('   cancelling it releases the order and the reservation', await evaluate(`/Nothing reserved/.test(document.body.innerText)`));

  // 7. Stop-loss on the CTB position.
  const ctbBid = num(quote.Bid);
  const stop = (Math.floor(ctbBid * 0.9 * 1000) / 1000).toFixed(3);
  await click('Stop-loss', 'button', TICKET);
  await click('Buy', 'button', TICKET);
  await setValue('#ticket-symbol', 'CTB');
  await setValue('#ticket-quantity', '20');
  await setValue('#ticket-price', stop);
  await click('Preview order', 'button', TICKET);
  await waitFor(bodyHas('Stop orders are protective sells'));
  check('7. a buy stop is refused by the form (stops protect positions)', true);
  await fillTicket({ symbol: 'CTB', side: 'SELL', type: 'STOP', quantity: '20', price: stop });
  await previewTicket();
  const stopped = await confirmTicket('sell');
  check('   a sell stop-loss below the bid is accepted and working', /Stop-loss set: 20 CTB will be sold at the bid if it falls to/.test(stopped.toast), stopped.toast.slice(0, 120));

  // 8. Market sell of part of the position.
  await fillTicket({ symbol: 'CTB', side: 'SELL', type: 'MARKET', quantity: '10' });
  const sellReview = await previewTicket();
  check('8. selling previews the proceeds after fees and the units held', /Estimated proceeds/.test(sellReview.text) && sellReview.rows['Units held'] === '50', JSON.stringify(sellReview.rows['Units held']));
  const sold = await confirmTicket('sell');
  check('   market sell filled by the server', /Sold 10 CTB at [\d,.]+ DT on average/.test(sold.toast), sold.toast.slice(0, 120));
  await sleep(800);
  await shotAll('T03-desk-after-trades');

  // 9. Watchlist.
  await click('Add SFX to watchlist');
  await waitFor(`document.querySelector('[aria-label="Remove SFX from watchlist"]')?.getAttribute('aria-pressed') === 'true'`);
  await setValue('#desk-filter', 'WATCHLIST');
  await sleep(200);
  check('9. the watchlist filter shows only the followed instrument', await evaluate(`[...document.querySelectorAll('ul li[data-selected]')].map((li) => li.querySelector('strong').innerText).join(',') === 'SFX'`));
  await setValue('#desk-filter', 'ALL');

  // 10. Portfolio analytics.
  await click('Performance & risk', 'a');
  await waitFor(`location.pathname === '/portfolios' && ${bodyHas('Reconciliation')} && ${bodyHas('Cash matches the ledger')}`);
  const recon = await evaluate(`Object.fromEntries([...[...document.querySelectorAll('section')].find((s) => /^Reconciliation/.test(s.querySelector('h2')?.innerText ?? '')).querySelectorAll('dl > div')].map((d) => [d.querySelector('dt').innerText.trim(), d.querySelector('dd').innerText.trim()]))`);
  const eq = num(recon.Equity);
  const contrib = num(recon['− Net contributions']);
  const profit = num(recon['= Profit']);
  const realized = num(recon['Realized P&L']);
  const unrealized = num(recon['+ Unrealized P&L']);
  check(
    '10. reconciliation: equity − contributions = profit = realized + unrealized, to the millime',
    recon.Difference === '0.000 DT' && recon['Cash matches the ledger'] === 'Yes' && Math.abs(eq - contrib - profit) < 0.0005 && Math.abs(realized + unrealized - profit) < 0.0005,
    `equity ${eq}, contributions ${contrib}, profit ${profit}, realized ${realized}, unrealized ${unrealized}`,
  );
  const risk = await evaluate(`[...document.querySelectorAll('section')].find((s) => /^Risk/.test(s.querySelector('h2')?.innerText ?? '')).innerText`);
  check('   VaR and expected shortfall are computed from instrument history', /1-day VaR \(95%\)\s*\n\s*[\d,.]+ DT/.test(risk) && /expected shortfall \(95%\)\s*\n\s*[\d,.]+ DT/i.test(risk), risk.split('\n').slice(0, 4).join(' | '));
  check('   realized volatility is explicitly unavailable for a new portfolio, not shown as zero', /Realized volatility \(annualized\)\s*\n\s*\u2014\s*\n\s*Not available: The portfolio has 0 complete days/.test(risk));
  check('   stress tests are labelled hypothetical and list four scenarios', await evaluate(`${bodyHas('Hypothetical instant shocks')} && document.querySelectorAll('tr[class*="stressRow"]').length === 4`));

  // 11. Deposit: contributions move, profit does not count it.
  await click('Deposit', 'button', `document.querySelector('form[aria-label="Deposit or withdraw virtual cash"]')`);
  await setValue('#cash-amount', '5000');
  await click('Deposit', 'button[type="submit"]');
  await waitFor(`/Deposited 5,000\\.000 DT/.test(${toastText})`);
  await waitFor(`/= Profit/.test(document.body.innerText) && [...document.querySelectorAll('section')].some((s) => /^Reconciliation/.test(s.querySelector('h2')?.innerText ?? '') && s.innerText.includes(${JSON.stringify((contrib + 5000).toLocaleString('en-US', { minimumFractionDigits: 3 }))}))`);
  check('11. a 5,000 DT deposit raises net contributions by exactly 5,000 DT', true, `contributions ${contrib} → ${contrib + 5000}`);
  check('    the time-weighted return is shown as a rate or an explicit reason', await evaluate(`/Time-weighted return\\s*\\n\\s*([+\\u2212]?[\\d.]+%|\\u2014)/.test(document.body.innerText)`));

  // 12. Full history.
  const orders = await evaluate(`[...document.querySelectorAll('table')].find((t) => t.caption?.innerText === 'Orders').innerText`);
  const statuses = await evaluate(`[...[...document.querySelectorAll('table')].find((t) => t.caption?.innerText === 'Orders').querySelectorAll('tbody tr')].map((r) => r.querySelector('.badge').textContent.trim())`);
  check(
    '12. order history lists the cancelled limit, the working stop and the two fills; the refused preview never became an order',
    statuses.length === 4 && statuses.filter((s) => s === 'Filled').length === 2 && statuses.includes('Cancelled') && statuses.includes('Working') && !/Rejected/.test(orders),
    statuses.join(', '),
  );
  await click('Trades', 'button');
  await waitFor(`!!document.querySelector('table caption') && [...document.querySelectorAll('table caption')].some((c) => c.innerText === 'Executed trades')`);
  check('    trade history shows both fills with fees and cash impact', await evaluate(`[...document.querySelectorAll('table')].find((t) => t.caption?.innerText === 'Executed trades').querySelectorAll('tbody tr').length === 2`));
  await click('Cash', 'button');
  await waitFor(`[...document.querySelectorAll('table caption')].some((c) => c.innerText === 'Cash ledger')`);
  check('    the cash ledger has the initial capital, both trades and the deposit', await evaluate(`[...document.querySelectorAll('table')].find((t) => t.caption?.innerText === 'Cash ledger').querySelectorAll('tbody tr').length === 4`));
  await click('Orders', 'button');
  await sleep(300);
  await shotAll('T04-portfolios');

  // 13. Markets page, then trade from it.
  await go(`${WEB}/markets`, `${bodyHas('All instruments')} && document.querySelectorAll('table tbody tr').length > 0`);
  const markets = await evaluate(`({
    all: [...document.querySelectorAll('table')].find((t) => t.caption?.innerText === 'All instruments')?.querySelectorAll('tbody tr').length ?? 0,
    watch: [...document.querySelectorAll('table')].find((t) => t.caption?.innerText === 'Watchlist')?.innerText ?? '',
  })`);
  check('13. markets lists all 7 instruments and the watchlist holds SFX', markets.all === 7 && /SFX/.test(markets.watch), `${markets.all} instruments`);
  const changes = await evaluate(`[...[...document.querySelectorAll('table')].find((t) => t.caption?.innerText === 'All instruments').querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[4].innerText.replace(/[^0-9.]/g, '')).map(Number)`);
  check('    daily changes are plausible percentages (the API sends percent, the page divides by 100)', changes.every((c) => c < 25), changes.map((c) => `${c}%`).join(' '));
  await shotAll('T05-markets');
  await evaluate(`document.querySelector('a[href="/trading?symbol=OLV"]').click()`);
  await waitFor(`location.pathname === '/trading' && document.querySelector('#ticket-symbol')?.value === 'OLV'`);
  check('    "Trade" on the markets page opens the desk with that instrument in the ticket', true);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
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
