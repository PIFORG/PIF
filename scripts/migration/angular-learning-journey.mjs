#!/usr/bin/env node
/**
 * Angular + Spring MarketQuest / Time Machine / FinStories browser journey.
 * Creates a disposable verified user on PIF_spring_test, then:
 *   Learning Hub → start my-first-trade → trade → finish → assessment → HOLD rewind → stories feed.
 *
 *   DATABASE_URL=<…/PIF_spring_test> node scripts/migration/angular-learning-journey.mjs
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
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/migration/screenshots/learning-journey');
const DOMAIN = '@spring-learning-journey.test';
const RUN = Date.now().toString(36);
const EMAIL = `learner-${RUN}${DOMAIN}`;
const PASSWORD = 'Journey-Pass-1!';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const { prisma, dbName } = await connect();
if (dbName !== 'PIF_spring_test') throw new Error(`Refusing journey against database ${dbName}`);
mkdirSync(SHOTS, { recursive: true });
const browser = await launchEdge({ port: 9352, name: 'angular-learning-journey' });
await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await browser.viewport(1440, 900);

async function shot(name) {
  const m = await browser.send('Page.getLayoutMetrics');
  const height = Math.min(Math.ceil(m.cssContentSize.height), 6000);
  const res = await browser.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: m.cssLayoutViewport.clientWidth, height, scale: 1 },
  });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(res.data, 'base64'));
}

const text = (selector) => browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText?.trim() ?? ''`);
const bodyHas = (s) => `document.body.innerText.includes(${JSON.stringify(s)})`;
async function clickContent(label, tag = 'button', { includes = false } = {}) {
  const ok = await browser.evaluate(`(() => {
    const b = [...document.querySelectorAll(${JSON.stringify(tag)})].find((x) => {
      const t = x.textContent.replace(/\\s+/g, ' ').trim();
      return ${includes ? `t.includes(${JSON.stringify(label)})` : `t === ${JSON.stringify(label)}`};
    });
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  if (!ok) throw new Error(`${tag} "${label}" not found or disabled`);
}
async function setValue(selector, value) {
  await browser.setValue(selector, value);
}

async function createUser() {
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: EMAIL,
      firstName: 'Journey',
      lastName: 'Learner',
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

async function placeOrder(symbol, qty, rationale) {
  await setValue('#ticket-symbol', symbol);
  await setValue('#ticket-qty', String(qty));
  await setValue('#ticket-rationale', rationale);
  await browser.waitFor(`/Estimated cost/i.test(document.querySelector('#ticket-preview')?.innerText ?? '')`);
  await clickContent('Place buy order');
  await sleep(400);
}

async function journey() {
  await createUser();

  await browser.go(`${ANGULAR}/login`, `!!document.querySelector('#email') && !!document.querySelector('[ng-version]')`);
  await setValue('#email', EMAIL);
  await setValue('#password', PASSWORD);
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`location.pathname === '/dashboard'`);

  await browser.go(`${ANGULAR}/learn`, `${bodyHas('Competency profile')} && !!document.querySelector('[data-availability]')`);
  const hub = await browser.evaluate(`({
    missions: document.querySelectorAll('#missions [data-availability]').length,
    links: document.querySelectorAll('#missions a[data-availability]').length,
    planned: document.querySelectorAll('#missions [data-availability="PLANNED"]').length,
  })`);
  check('L1. Learning Hub lists 10 playable missions', hub.missions === 10 && hub.links === 10 && hub.planned === 0, JSON.stringify(hub));
  await shot('01-hub');

  await browser.go(`${ANGULAR}/learn/missions/my-first-trade`, bodyHas('How you are assessed'));
  check('L2. briefing shows assessment weights', await browser.evaluate(`${bodyHas('40 %')} && ${bodyHas('Risk management')}`));
  await clickContent('Start mission');
  await browser.waitFor(`/^\\/learn\\/sessions\\/[^/]+$/.test(location.pathname) && !!document.querySelector('#ticket-qty')`);
  const sessionPath = await browser.evaluate('location.pathname');
  check('L3. mission session started on Angular', /^\/learn\/sessions\//.test(sessionPath), sessionPath);

  await setValue('#ticket-qty', '10');
  await clickContent('Place buy order');
  await browser.waitFor(bodyHas('Say why you are placing this order.'));
  check('L4. ticket refuses an order without a reason', true);

  await placeOrder('OLV', 10, 'LONG_TERM_VIEW');
  await placeOrder('CTB', 10, 'DIVERSIFY');
  const filled = await browser.evaluate(`[...document.querySelectorAll('#orders tbody tr')].filter((r) => /\\bfilled\\b/i.test(r.innerText)).length`);
  check('L5. two market buys executed by Spring', filled === 2, `filled=${filled}`);
  check('L6. positions reflect the fills', await browser.evaluate(`document.querySelectorAll('#positions tbody tr').length === 2`));

  await clickContent('Ask');
  await browser.waitFor(
    `(${bodyHas('Rule-based mentor')} && ${bodyHas('Based on')}) || ${bodyHas('Mentor used')} || !!document.querySelector('.lr-mentor[aria-live]')`,
    20_000,
  );
  check(
    'L7. rule-based mentor answers',
    await browser.evaluate(`${bodyHas('Rule-based mentor')} || ${bodyHas('Mentor used')} || ${bodyHas('Assisted')}`),
  );

  for (let day = 1; day <= 5; day += 1) {
    await clickContent('Next day');
    await browser.waitFor(bodyHas(`Day ${day} of 5`));
  }
  await browser.waitFor(bodyHas('Finish and get assessed'));
  await clickContent('Finish and get assessed');
  await browser.waitFor(`${bodyHas('Mission complete.')} || ${bodyHas('Mission failed.')}`);
  check('L8. mission completed by Spring', await browser.evaluate(bodyHas('Mission complete.')));

  await clickContent('See your assessment', 'a');
  await browser.waitFor(`/review$/.test(location.pathname) && ${bodyHas('How the score was built')}`);
  const components = await browser.evaluate(`document.querySelectorAll('#components section').length`);
  check('L9. assessment shows four components', components === 4, `components=${components}`);

  await browser.waitFor(`!!document.querySelector('input[name="branch-point"]')`, 10_000);
  // Visually-hidden radios: click the wrapping label so Angular's (change) sets fromSeq.
  await browser.evaluate(`document.querySelector('label.lr-small')?.click()`);
  await browser.waitFor(`[...document.querySelectorAll('button')].some((b) => /Rewind to decision #\\d+/.test(b.textContent.replace(/\\s+/g, ' ')))`, 5_000);
  await browser.evaluate(`(() => {
    const select = document.querySelector('#branch-strategy');
    if (!select) return;
    select.value = 'HOLD';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await clickContent('Rewind to decision #', 'button', { includes: true });
  await browser.waitFor(`${bodyHas('Replays of this attempt')} || !!document.querySelector('#comparison')`, 30_000);
  if (!(await browser.evaluate(`!!document.querySelector('#comparison')`))) {
    await clickContent('Compare', 'button', { includes: true });
    await browser.waitFor(`!!document.querySelector('#comparison') || ${bodyHas('Side by side')}`, 20_000);
  }
  check(
    'L10. Time Machine HOLD rewind compared side by side in Angular',
    await browser.evaluate(`(${bodyHas('Replays of this attempt')} || ${bodyHas('Side by side')}) && (!!document.querySelector('#comparison') || ${bodyHas('Same market')})`),
  );
  await shot('02-review');

  await browser.go(`${ANGULAR}/stories`, `!!document.querySelector('[ng-version]')`);
  await browser.waitFor(`!!document.querySelector('.st-feed') || ${bodyHas('No stories yet')} || ${bodyHas('unavailable')}`, 20_000);
  const stories = await browser.evaluate(`({
    cards: document.querySelectorAll('.st-feed > *, .st-card, [data-slug]').length,
    empty: ${bodyHas('No stories yet')},
    title: document.querySelector('h1')?.innerText?.trim() ?? '',
    feed: !!document.querySelector('.st-feed'),
  })`);
  check(
    'L11. FinStories feed renders without a placeholder',
    !/not migrated/i.test(stories.title) && (stories.feed || stories.empty || stories.cards > 0),
    JSON.stringify(stories),
  );
  await shot('03-stories');

  const tokenRes = await fetch(`${SPRING_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ANGULAR },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const tokenBody = await tokenRes.json();
  const profile = await fetch(`${SPRING_API}/api/learning/profile`, {
    headers: { Authorization: `Bearer ${tokenBody.accessToken}` },
  }).then((r) => r.json());
  const passed = profile.stats?.missionsPassed ?? 0;
  const evidenced = (profile.competencies ?? []).filter((c) => (c.evidence ?? 0) > 0 || c.score != null).length;
  check(
    'L12. Spring learning profile has an assessed attempt',
    passed >= 1 || evidenced >= 1,
    JSON.stringify({ passed, evidenced, stats: profile.stats }).slice(0, 200),
  );
}

try {
  await journey();
} catch (error) {
  check(`fatal: ${error instanceof Error ? error.message : String(error)}`, false);
} finally {
  try { await cleanup(); } catch { /* ignore */ }
  try { browser.close(); } catch { /* ignore */ }
  try { await prisma.$disconnect(); } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
writeFileSync(join(SHOTS, 'report.json'), JSON.stringify({ email: EMAIL, results }, null, 2));
process.exit(failed ? 1 : 0);
