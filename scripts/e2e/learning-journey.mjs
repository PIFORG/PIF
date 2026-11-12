#!/usr/bin/env node
/**
 * Browser end-to-end journey for the learning module (MarketQuest, Time Machine, FinStories), driven
 * through headless Microsoft Edge over the DevTools protocol.
 *
 * Prerequisites (development only):
 *   - API running with MAIL_TRANSPORT=preview, ideally against a `_test` database
 *   - Web running on E2E_WEB_URL (default http://localhost:3000)
 *
 *   npm run test:e2e:learning [-- <screenshot-dir>]
 *
 * Registers a throwaway @example.test account with a random password that is never printed,
 * confirms it through the captured verification link, then plays the journey in the real UI:
 *  1 open the Learning Hub · 2 start a beginner mission · 3 trade · 4 complete it ·
 *  5 read the assessment · 6 rewind it in the Time Machine · 7 see the competency profile ·
 *  8 open FinStories · 9 watch the episode · 10 resume where you left off ·
 *  11 trade in the calibration mission, where every order needs a confidence rating.
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
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/learning/screenshots');
const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9343;
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
const profile = join(tmpdir(), `mtrs-learning-e2e-${Date.now()}`);
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

// innerText follows CSS text-transform, so labels styled in capitals are compared case-insensitively.
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
  const height = Math.min(Math.ceil(m.cssContentSize.height), 6000);
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
}
async function shotAll(name) {
  for (const [label, [w, h]] of Object.entries(VIEWPORTS)) {
    await viewport(w, h);
    // On mobile emulation the layout viewport widens to fit overflowing content, so innerWidth is checked too.
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
async function click(label, tag = 'button') {
  const ok = await evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find((x) => (x.getAttribute('aria-label') ?? x.innerText).trim().startsWith(${JSON.stringify(label)}));
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`${tag} "${label}" not found or disabled`);
}
const path = () => evaluate('location.pathname');

async function placeOrder(symbol, budget, rationale, confidence) {
  await setValue('#ticket-symbol', symbol);
  const quote = await evaluate(`(() => {
    const row = [...document.querySelectorAll('#quotes tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(symbol)}));
    const cells = [...row.querySelectorAll('td')].map((c) => c.innerText.replace(/[^0-9.]/g, ''));
    return { ask: Number(cells[2]), depth: Number(cells[4]) };
  })()`);
  const quantity = Math.min(quote.depth, Math.floor(budget / quote.ask));
  await setValue('#ticket-qty', quantity);
  await setValue('#ticket-rationale', rationale);
  await setValue('#ticket-confidence', confidence);
  const before = await evaluate(`document.querySelectorAll('#orders tbody tr').length`);
  await click('Place buy order');
  await waitFor(`document.querySelectorAll('#orders tbody tr').length > ${before}`);
  return quantity;
}

async function run() {
  // 0. Throwaway learner through the real registration and verification flow.
  const email = `e2e-learning-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}@example.test`;
  const password = `${randomBytes(12).toString('base64url')}a7!`;
  const t0 = Date.now() - 1000;
  const reg = await api('POST', '/auth/register', { firstName: 'Mara', lastName: 'Learner', email, password, passwordConfirmation: password });
  check('throwaway learner registered', reg.status === 201, `HTTP ${reg.status}`);
  const verified = await api('POST', '/auth/verify-email', { token: await verificationToken(email, t0) });
  check('email verified through the captured link token', verified.status === 200, `HTTP ${verified.status}`);

  // 1. Learning Hub.
  await viewport(...VIEWPORTS.desktop);
  await go(`${WEB}/login?returnTo=%2Flearn`, `!!document.querySelector('input[name="email"]')`);
  await setValue('input[name="email"]', email);
  await setValue('input[name="password"]', password);
  await click('Sign in');
  await waitFor(`location.pathname === '/learn' && ${bodyHas('Competency profile')} && !!document.querySelector('[data-availability]')`);
  const hub = await evaluate(`({
    missions: document.querySelectorAll('#missions [data-availability]').length,
    links: document.querySelectorAll('#missions a[data-availability]').length,
    planned: document.querySelectorAll('#missions [data-availability="PLANNED"]').length,
    levels: [...document.querySelectorAll('#missions h3')].map((h) => h.innerText),
  })`);
  check('1. Learning Hub lists 10 missions across the three levels', hub.missions === 10 && hub.levels.join('|') === 'Rookie Trader|Market Strategist|Risk Commander', JSON.stringify(hub.levels));
  check('   every mission is playable and opens its briefing', hub.links === 10 && hub.planned === 0, `${hub.links} links, ${hub.planned} planned`);
  await shotAll('01-hub');

  // 2. Beginner mission: briefing, then start.
  await go(`${WEB}/learn/missions/my-first-trade`, bodyHas('How you are assessed'));
  check('2. briefing shows objectives, rules and the 40/25/20/15 weights', await evaluate(`${bodyHas('Buy your first shares')} && ${bodyHas('Risk management')} && ${bodyHas('40 %')}`));
  await shotAll('02-briefing');
  await click('Start mission');
  await waitFor(`/^\\/learn\\/sessions\\/[^/]+$/.test(location.pathname) && !!document.querySelector('#ticket-qty')`);
  const sessionPath = await path();
  check('   mission session started', true, sessionPath);

  // 3. Trading: a rejected-by-form attempt, then two reasoned buys.
  await setValue('#ticket-qty', '10');
  await click('Place buy order');
  await waitFor(bodyHas('Say why you are placing this order.'));
  check('3. ticket refuses an order without a reason', true);
  const previewText = `document.querySelector('#ticket-preview').innerText`;
  await setValue('#ticket-symbol', 'OLV');
  await setValue('#ticket-qty', '5000');
  await setValue('#ticket-rationale', 'LONG_TERM_VIEW');
  await waitFor(`/This order needs [\\d,.]+ DT including fees; [\\d,.]+ DT is available\\./.test(${previewText})`);
  await click('Place buy order');
  await sleep(500);
  check('   the server pre-trade check refuses an unaffordable order before it is sent', await evaluate(`document.querySelectorAll('#orders tbody tr').length === 0`));
  await setValue('#ticket-qty', '10');
  await waitFor(`!/This order needs/.test(${previewText}) && /Estimated cost\\s*[\\d,.]+/i.test(${previewText})`);
  check('   the ticket shows the server estimate for a valid order', true, (await evaluate(previewText)).replace(/\s+/g, ' ').slice(0, 120));
  const olv = await placeOrder('OLV', 2600, 'LONG_TERM_VIEW', '70');
  const ctb = await placeOrder('CTB', 2600, 'DIVERSIFY', '60');
  const filled = await evaluate(`[...document.querySelectorAll('#orders tbody tr')].filter((r) => /\\bfilled\\b/i.test(r.innerText)).length`);
  check('   two market buys executed by the server', filled === 2, `OLV ${olv}, CTB ${ctb}`);
  check('   positions and cash reflect the fills', await evaluate(`document.querySelectorAll('#positions tbody tr').length === 2`));
  check('   decision day starts at day 0 of 5', await evaluate(bodyHas('Day 0 of 5')));
  await click('Next day');
  await waitFor(bodyHas('Day 1 of 5'));
  await click('Ask');
  await waitFor(`!!document.querySelector('#mentor [aria-live]') && ${bodyHas('Rule-based mentor (no AI provider configured)')}`);
  check('   mentor answers, labelled as rule-based, and marks the attempt assisted', await evaluate(bodyHas('Assisted')));
  await shotAll('03-player');

  // 4. Complete the mission.
  for (let day = 2; day <= 5; day += 1) {
    await click('Next day');
    await waitFor(bodyHas(`Day ${day} of 5`));
  }
  await waitFor(bodyHas('Finish and get assessed'));
  check('   market closes after the last day', await evaluate(bodyHas('The market has closed for this mission.')));
  check('   market news appears on its day only', await evaluate(bodyHas('Olivia Foods reports steady sales growth')));
  await click('Finish and get assessed');
  await waitFor(`${bodyHas('Mission complete.')} || ${bodyHas('Mission failed.')}`);
  check('4. mission completed and closed by the server', await evaluate(bodyHas('Mission complete.')));

  // 5. Assessment.
  await click('See your assessment', 'a');
  await waitFor(`/review$/.test(location.pathname) && ${bodyHas('How the score was built')}`);
  const assessment = await evaluate(`({ components: document.querySelectorAll('#components section').length, passed: ${bodyHas('Passed')} })`);
  check('5. assessment shows four evidenced components', assessment.components === 4, JSON.stringify(assessment));
  const calibration = await evaluate(`document.querySelector('#calibration')?.innerText ?? ''`);
  check(
    '   the confidence check is market-adjusted and says two outcomes are too few to judge confidence',
    /Beat the market by the end/i.test(calibration) && /2 outcome\(s\) compared\. At least 10 are needed/.test(calibration) && /not evidence of overconfidence/.test(calibration),
    calibration.replace(/\s+/g, ' ').slice(0, 160),
  );
  await click('Show debrief');
  await waitFor(`!!document.querySelector('#debrief') && /rule-based mentor/i.test(document.querySelector('#debrief').innerText)`);
  check('   debrief generated from session evidence', true);

  // 6. Time Machine: rewind the first decision with the hold strategy, then compare.
  await evaluate(`document.querySelector('input[name="branch-point"]').click()`);
  await setValue('#branch-strategy', 'HOLD');
  await click('Rewind to decision');
  await waitFor(`!!document.querySelector('#comparison [role="table"]')`, 30000);
  const compared = await evaluate(`({ rows: document.querySelectorAll('#comparison [role="row"]').length, branches: ${bodyHas('Replays of this attempt')} })`);
  check('6. replay branch created and compared side by side', compared.rows > 1 && compared.branches, JSON.stringify(compared));
  await shotAll('04-review');

  // 6b. Time Machine, manual branch: rewind the first decision and trade differently in a practice replay.
  const reviewPath = await path();
  await evaluate(`document.querySelector('input[name="branch-point"]').click()`);
  await setValue('#branch-strategy', 'MANUAL');
  await click('Rewind to decision');
  await waitFor(`/^\\/learn\\/sessions\\/[^/]+$/.test(location.pathname) && location.pathname !== ${JSON.stringify(sessionPath)} && !!document.querySelector('#ticket-qty')`, 30000);
  check('6b. a manual branch opens a practice replay before the first decision', await evaluate(`${bodyHas('Time Machine replay · practice only')} && document.querySelectorAll('#orders tbody tr').length === 0 && ${bodyHas('Day 0 of 5')}`));
  await placeOrder('CTB', 5000, 'LONG_TERM_VIEW', '70');
  check('   the alternative order is executed in the replay', await evaluate(`[...document.querySelectorAll('#orders tbody tr')].filter((r) => /\\bfilled\\b/i.test(r.innerText)).length === 1`));
  for (let day = 1; day <= 5; day += 1) {
    await click('Next day');
    await waitFor(bodyHas(`Day ${day} of 5`));
  }
  await waitFor(bodyHas('Finish and get assessed'));
  await click('Finish and get assessed');
  await waitFor(`${bodyHas('Mission complete.')} || ${bodyHas('Mission failed.')}`);
  await click('See your assessment', 'a');
  await waitFor(`/review$/.test(location.pathname) && ${bodyHas('How the score was built')}`);
  check('   the replay is assessed and labelled as practice', await evaluate(bodyHas('Time Machine replay · practice only')));
  await click('Compare with original');
  await waitFor(`document.querySelectorAll('#comparison [role="row"]').length > 1`, 30000);
  check('   the manual replay is compared with the original attempt', true, `${await evaluate(`document.querySelectorAll('#comparison [role="row"]').length`)} comparison rows`);
  await shotAll('04b-manual-replay-review');
  await go(`${WEB}${reviewPath}`, bodyHas('Replays of this attempt'));
  check('   the original attempt lists both replays', await evaluate(`[...document.querySelectorAll('button')].filter((b) => /^Compare/.test(b.innerText.trim())).length >= 2`));

  // 7. Profile updated.
  await go(`${WEB}/learn`, `${bodyHas('Competency profile')} && !!document.querySelector('[role="meter"]')`);
  const scored = await evaluate(`[...document.querySelectorAll('#competencies [role="meter"]')].filter((m) => m.getAttribute('aria-valuenow') !== null).length`);
  check('7. competency profile now has evidence', scored >= 1, `${scored} competencies scored`);
  check('   recent result listed with a review link', await evaluate(bodyHas('Recent results')));
  const kpi = (label) => `[...document.querySelectorAll('div')].find((d) => d.children.length >= 2 && d.firstElementChild?.innerText?.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())})?.innerText ?? ''`;
  const assessed = await evaluate(kpi('Assessed attempts'));
  const calibrationKpi = await evaluate(kpi('Confidence calibration'));
  check('   practice replays leave the profile unchanged: one assessed attempt, two rated outcomes', /\n\s*1\s*\n/.test(`${assessed}\n`) && /2 of 10 outcomes needed/.test(calibrationKpi), `${assessed.replace(/\s+/g, ' ')} | ${calibrationKpi.replace(/\s+/g, ' ')}`);
  await shot('05-hub-after-desktop');

  await go(`${WEB}/dashboard`, `!!document.querySelector('#learning') && ${bodyHas('missions passed')}`);
  const dash = await evaluate(`(() => {
    const panel = document.querySelector('#learning');
    return { text: panel.innerText, briefLinks: panel.querySelectorAll('a[href^="/learn/missions/"]').length };
  })()`);
  check('   dashboard learning panel shows live progress and recommended missions', /1 of 10 missions passed/i.test(dash.text) && /live/i.test(dash.text) && dash.briefLinks > 0 && !/on its way/i.test(dash.text), dash.text.split('\n').slice(0, 3).join(' | '));
  check('   dashboard reports the learning module as available', await evaluate(`[...document.querySelectorAll('#modules a[href="/learn"]')].some((a) => /live/i.test(a.innerText))`));
  await shotAll('05-dashboard');

  await click('Explore sample workspace');
  await waitFor(bodyHas('Carthage Bank'));
  const sample = await evaluate(`({ text: document.body.innerText, old: /Northwind|Contoso|Woodgrove|Fabrikam|Litware|Tailspin/.test(document.body.innerText) })`);
  check('sample workspace uses the mission universe in dinars, written DT as in the missions', /\d DT\b/.test(sample.text) && !/TND \d/.test(sample.text) && /TunisTech/.test(sample.text) && !sample.old);
  check('   the sample banner says amounts are not converted to the display currency', await evaluate(bodyHas('not converted to your display currency (USD)')));
  const table = (await send('Runtime.evaluate', { expression: `document.querySelector('#positions table')` })).result.objectId;
  const ax = (await send('Accessibility.getPartialAXTree', { objectId: table, fetchRelatives: false })).nodes[0];
  const caption = await evaluate(`(() => { const r = document.querySelector('#positions caption').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
  check('   the visually hidden table caption is still the table name for screen readers', ax.role?.value === 'table' && ax.name?.value === 'Sample positions in fictitious instruments' && caption.w <= 1 && caption.h <= 1, `${ax.role?.value}: "${ax.name?.value}"`);
  await shotAll('05b-dashboard-sample');
  await click('Exit sample workspace');

  // 8–9. FinStories: open the showcase and watch.
  await go(`${WEB}/stories?story=sarah-and-the-market-crash`, `!!document.querySelector('[aria-roledescription="story player"]') && ${bodyHas('Meet Sarah')}`);
  check('8. FinStories opens the Sarah showcase', true);
  const stageOf = `[...document.querySelectorAll('[aria-roledescription="story player"]')].find((s) => /sarah/i.test(s.getAttribute('aria-label') ?? ''))`;
  const firstCaption = await evaluate(`${stageOf}.querySelector('p[class*="caption"]').innerText`);
  await sleep(14500);
  const watching = await evaluate(`(() => {
    const stage = ${stageOf};
    return { caption: stage.querySelector('p[class*="caption"]')?.innerText ?? '', reel: stage.innerText.match(/Reel \\d[^\\n]*/i)?.[0] ?? '', abButtons: [...stage.querySelectorAll('button')].filter((b) => /^(A|B)$/.test(b.innerText.trim())).length };
  })()`);
  check('9. episode plays by itself into the decision reel', watching.caption !== firstCaption && /Reel 1/i.test(watching.reel), `${watching.reel} — "${watching.caption.slice(0, 60)}…"`);
  check('   no A/B answer buttons anywhere in the player', watching.abButtons === 0);
  await shotAll('06-finstories');
  await viewport(...VIEWPORTS.mobile);
  const fit = await evaluate(`(async () => {
    document.querySelector('[aria-label="FinStories feed"]').scrollIntoView({ block: 'start' });
    await new Promise((r) => setTimeout(r, 500));
    const stage = ${stageOf}.getBoundingClientRect();
    const controls = ${stageOf}.querySelector('button[aria-label="Next scene"]').getBoundingClientRect();
    return { stageTop: Math.round(stage.top), controlsBottom: Math.round(controls.bottom), visibleTop: 64, visibleBottom: innerHeight - 60 };
  })()`);
  check('   on a 375px phone the whole player fits between the top bar and the bottom navigation', fit.stageTop >= fit.visibleTop && fit.controlsBottom <= fit.visibleBottom, JSON.stringify(fit));
  const view = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, '07-finstories-mobile-viewport.png'), Buffer.from(view.data, 'base64'));
  await viewport(...VIEWPORTS.desktop);
  await click('Pause');
  await sleep(1200);
  const storyA11y = await evaluate(`(() => {
    const s = ${stageOf};
    return { live: s.querySelector('p[class*="caption"]')?.getAttribute('aria-live'), pressed: s.querySelector('button[aria-label="Captions"]')?.getAttribute('aria-pressed'), keys: /K to play or pause/.test(s.getAttribute('aria-label') ?? '') };
  })()`);
  check('   paused captions are announced politely, the captions toggle is pressed and keyboard help is labelled', storyA11y.live === 'polite' && storyA11y.pressed === 'true' && storyA11y.keys, JSON.stringify(storyA11y));
  await evaluate(`${stageOf}.querySelector('button[aria-label="Captions"]').click()`);
  await sleep(300);
  const captionsOff = await evaluate(`(() => { const s = ${stageOf}; return { pressed: s.querySelector('button[aria-label="Captions"]').getAttribute('aria-pressed'), caption: !!s.querySelector('p[class*="caption"]') }; })()`);
  check('   captions can be turned off and on', captionsOff.pressed === 'false' && !captionsOff.caption, JSON.stringify(captionsOff));
  await evaluate(`${stageOf}.querySelector('button[aria-label="Captions"]').click()`);

  // 10. Resume, with reduced motion requested by the system.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await go(`${WEB}/stories?story=sarah-and-the-market-crash`, bodyHas('resumes at'));
  const resumeAt = await evaluate(`document.body.innerText.match(/resumes at (\\d+:\\d\\d)/i)?.[1] ?? ''`);
  check('10. progress was saved and the story offers to resume', /^0:(0[5-9]|[1-5]\d)$/.test(resumeAt), resumeAt);
  await sleep(2000);
  check('    with reduced motion the episode waits for the learner instead of autoplaying', await evaluate(`!!${stageOf}.querySelector('button[aria-label="Play"]')`));
  await send('Emulation.setEmulatedMedia', { features: [] });

  await viewport(...VIEWPORTS.mobile);
  await go(`${WEB}${sessionPath}`, `!!document.querySelector('#orders')`);
  await sleep(800);
  const fresh = await evaluate(`({ inner: innerWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
  check('player loaded fresh at 375px has no horizontal overflow', fresh.sw - fresh.cw <= 1 && fresh.inner === 375, JSON.stringify(fresh));
  await viewport(...VIEWPORTS.desktop);

  // 11. The Overconfident Trader: confidence is required on every order, checked by the form and the server.
  await go(`${WEB}/learn/missions/overconfident-trader`, bodyHas('How you are assessed'));
  check('11. calibration mission briefing states the confidence rule', await evaluate(bodyHas('Rate your confidence from 0 to 100 on every order')));
  await click('Start mission');
  await waitFor(`/^\\/learn\\/sessions\\/[^/]+$/.test(location.pathname) && !!document.querySelector('#ticket-qty')`);
  check('    the ticket marks confidence as required', await evaluate(`document.querySelector('label[for="ticket-confidence"]').innerText === 'Confidence (required)'`));
  await setValue('#ticket-symbol', 'CTB');
  await setValue('#ticket-qty', '100');
  await setValue('#ticket-rationale', 'DIVERSIFY');
  await click('Place buy order');
  await waitFor(bodyHas('Rate how confident you are'));
  check('    an unrated order is refused before it is sent', await evaluate(`document.querySelectorAll('#orders tbody tr').length === 0`));
  await placeOrder('CTB', 8500, 'DIVERSIFY', '90');
  await placeOrder('OLV', 7900, 'DIVERSIFY', '90');
  await placeOrder('SFX', 6400, 'DIVERSIFY', '80');
  check('    rated orders are executed by the server', await evaluate(`[...document.querySelectorAll('#orders tbody tr')].filter((r) => /\\bfilled\\b/i.test(r.innerText)).length === 3`));
  await setValue('#mentor-mode', 'SOCRATIC');
  await click('Ask');
  await waitFor(`/What do you know that the rest of the market does not/i.test(document.querySelector('#mentor')?.innerText ?? '')`);
  check('    the mentor questions near-certain confidence from what the learner stated', true);

  await viewport(...VIEWPORTS.mobile);
  await evaluate('scrollTo(0, 0)');
  const jump = await evaluate(`(() => { const a = [...document.querySelectorAll('a[href="#ticket"]')][0]; return a ? { visible: a.offsetParent !== null } : null; })()`);
  await click('Order ticket', 'a');
  await sleep(600);
  const ticketTop = await evaluate(`Math.round(document.querySelector('#ticket').getBoundingClientRect().top)`);
  check('    on a phone, the toolbar jumps to the order ticket', jump?.visible === true && ticketTop >= 0 && ticketTop < 200, `ticket top ${ticketTop}px`);
  await evaluate('scrollTo(0, 0)');
  await viewport(...VIEWPORTS.desktop);
  check('    the jump link is hidden when the ticket is beside the market', await evaluate(`document.querySelector('a[href="#ticket"]').offsetParent === null`));
  await shotAll('08-calibration-mission');
  await click('Abandon');
  await click('Yes, abandon');
  await waitFor(bodyHas('Mission abandoned.'));

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
