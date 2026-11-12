#!/usr/bin/env node
/**
 * Angular + Spring Actuarial Lab browser journey on PIF_spring_test:
 * overview → pricing (reference) → save scenario → Monte Carlo (seeded) → reserving analyze.
 *
 *   DATABASE_URL=<…/PIF_spring_test> node scripts/migration/angular-actuarial-journey.mjs
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
const SHOTS = resolve(ROOT, process.argv[2] ?? 'docs/migration/screenshots/actuarial-journey');
const DOMAIN = '@spring-actuarial-journey.test';
const RUN = Date.now().toString(36);
const EMAIL = `actuary-${RUN}${DOMAIN}`;
const PASSWORD = 'Journey-Pass-1!';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const { prisma, dbName } = await connect();
if (dbName !== 'PIF_spring_test') throw new Error(`Refusing journey against database ${dbName}`);
mkdirSync(SHOTS, { recursive: true });
const browser = await launchEdge({ port: 9353, name: 'angular-actuarial-journey' });
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

const bodyHas = (s) => `document.body.innerText.includes(${JSON.stringify(s)})`;
async function clickContent(label) {
  const ok = await browser.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(label)}));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  if (!ok) throw new Error(`button containing "${label}" not found or disabled`);
}

async function createUser() {
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: EMAIL,
      firstName: 'Journey',
      lastName: 'Actuary',
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

async function journey() {
  await createUser();

  await browser.go(`${ANGULAR}/login`, `!!document.querySelector('#email') && !!document.querySelector('[ng-version]')`);
  await browser.setValue('#email', EMAIL);
  await browser.setValue('#password', PASSWORD);
  await browser.click('form button[type="submit"]');
  await browser.waitFor(`location.pathname === '/dashboard'`);

  await browser.go(`${ANGULAR}/actuarial`, `${bodyHas('Claims & Pricing')} || ${bodyHas('Actuarial')}`);
  await browser.waitFor(`${bodyHas('89')} || ${bodyHas('Reference')} || ${bodyHas('Gross premium')}`, 15_000);
  check(
    'A1. actuarial overview shows the reference portfolio',
    await browser.evaluate(`${bodyHas('Reference')} && (${bodyHas('89,000')} || ${bodyHas('89000')} || ${bodyHas('89')})`),
  );
  await shot('01-overview');

  await browser.go(`${ANGULAR}/actuarial/pricing`, `!!document.querySelector('[ng-version]')`);
  await browser.waitFor(`${bodyHas('Gross premium')} || ${bodyHas('Pure premium')} || !!document.querySelector('form')`, 15_000);
  // Reference preset should load; wait for Spring pricing result.
  await browser.waitFor(`${bodyHas('89,000')} || ${bodyHas('60,000')} || ${bodyHas('Combined')}`, 20_000);
  check(
    'A2. pricing studio shows reference gross premium / expected claims',
    await browser.evaluate(`(${bodyHas('89,000')} || ${bodyHas('89 000')}) && (${bodyHas('60,000')} || ${bodyHas('60 000')})`),
  );

  const scenarioName = `Journey ${RUN}`;
  await browser.waitFor(`!!document.querySelector('#act-scenario-name')`, 10_000);
  await browser.setValue('#act-scenario-name', scenarioName);
  await browser.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Save current assumptions') && !b.disabled)`, 5_000);
  check('A3. scenario name field available', true, 'act-scenario-name');
  await clickContent('Save current assumptions');
  await browser.waitFor(`${bodyHas(scenarioName)}`, 10_000);
  check(
    'A4. scenario saved (listed or success)',
    await browser.evaluate(`${bodyHas(scenarioName)}`),
  );
  await shot('02-pricing');

  await browser.go(`${ANGULAR}/actuarial/monte-carlo`, `!!document.querySelector('[ng-version]')`);
  await browser.waitFor(`${bodyHas('Run simulation')} || ${bodyHas('Monte Carlo')}`, 15_000);
  await browser.waitFor(`!!document.querySelector('#mc-seed')`, 10_000);
  await browser.setValue('#mc-seed', '20261109');
  check('A5. Monte Carlo seed field set', true, 'mc-seed=20261109');
  await clickContent('Run simulation');
  await browser.waitFor(`${bodyHas('Value at risk')} || ${bodyHas('VaR')} || ${bodyHas('Mean')} || ${bodyHas('Tail')} || ${bodyHas('seed 20261109')}`, 60_000);
  check(
    'A6. Monte Carlo results rendered from Spring',
    await browser.evaluate(`${bodyHas('VaR')} || ${bodyHas('Value at risk')} || ${bodyHas('TVaR')} || ${bodyHas('Tail')} || ${bodyHas('seed 20261109')}`),
  );
  await shot('03-monte-carlo');

  await browser.go(`${ANGULAR}/actuarial/reserving`, `!!document.querySelector('[ng-version]')`);
  await browser.waitFor(`${bodyHas('Reserving Studio')} || ${bodyHas('Claims data')}`, 15_000);
  await browser.waitFor(`!!document.querySelector('#rs-example')`, 10_000);
  await browser.evaluate(`(() => {
    const select = document.querySelector('#rs-example');
    if (!select || select.options.length < 2) throw new Error('no reserving examples');
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await browser.waitFor(`${bodyHas('Chain ladder')} || ${bodyHas('Ultimate')} || ${bodyHas('Unpaid')} || ${bodyHas('IBNR')} || ${bodyHas('Results match')}`, 30_000);
  check(
    'A7. reserving analysis shows method results',
    await browser.evaluate(`${bodyHas('Chain ladder')} || ${bodyHas('Ultimate')} || ${bodyHas('Unpaid')} || ${bodyHas('IBNR')} || ${bodyHas('Results match')}`),
  );
  await shot('04-reserving');

  const login = await fetch(`${SPRING_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ANGULAR },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
  const scenarios = await fetch(`${SPRING_API}/api/actuarial/scenarios`, {
    headers: { Authorization: `Bearer ${login.accessToken}` },
  }).then((r) => r.json());
  check(
    'A8. Spring persisted the pricing scenario',
    (scenarios.scenarios ?? []).some((s) => s.name === scenarioName),
    JSON.stringify(scenarios.scenarios?.map((s) => s.name) ?? scenarios).slice(0, 200),
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
