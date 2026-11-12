// Differential contract test of the 20 actuarial and reserving endpoints: NestJS (3001) vs Spring Boot (3002), both
// on the isolated *_test database. Each API gets its OWN disposable user, so every scenario, Monte Carlo run and
// reserving run is written by exactly one backend; nothing is shared or mutated by both. The same request sequence
// is replayed on both sides, then every response and the resulting rows are compared.
//
// Reference portfolio (checked on both sides, and against the closed form): 1,000 policies, claim probability 5%,
// deterministic severity 1,200 TND. E[S] = 60,000. sd = sqrt(1,200^2 * 1,000 * 0.05 * 0.95) = 8,270.428646…, which
// money() reports to the millime as 8,270.429 (tolerance below is half a millime, for one ULP in the square root).
// Gross premium = 60,000 * 1.15 + 20,000 = 89,000. P(underwriting loss) = P(S > 69,000) = P(N >= 58) ≈ 13.8919%
// (five decimal places, the same tolerance as the Nest e2e). Nest and Spring must also match each other exactly.
//
// A missing nested object passes class-validator (ValidateNested skips undefined) and the Nest service then throws.
// Spring answers 400 for the pricing models. A fraction whose JavaScript text is exponent form without a dot (1e-7)
// crashes class-validator's maxDecimalPlaces check (500); Spring reports the constraint as failed (400). Both are
// recorded as intentional divergences. Reserving rethrows that TypeError as 500 on purpose, so those stay equal.
//
// Counters and clocks are taken once per request, never inside the per-side opts callback.
//
//   DATABASE_URL=<…/PIF_spring_test> node contract/differential-actuarial.mjs
import { NEST, SPRING, prisma, PASSWORD, email, call, record, compare, createUser, finish, run, normalize, diff } from './differential-lib.mjs';
import { stripDurationMs, domainAwareDiff, rawNumericDiff } from './numerical-parity.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SIDES = ['nest', 'spring'];
const BASE = { nest: NEST, spring: SPRING };
const token = {};
const user = {};
const auth = (side) => ({ authorization: `Bearer ${token[side]}` });
const rawAudit = [];

async function pair(name, method, path, opts = () => ({}), cmp = {}) {
  const nest = await call(NEST, method, typeof path === 'function' ? path('nest') : path, opts('nest'));
  const spring = await call(SPRING, method, typeof path === 'function' ? path('spring') : path, opts('spring'));
  // durationMs only — numeric equality uses domain-aware policies (not blanket toPrecision).
  const prior = cmp.bodyNormalizer ?? ((b) => b);
  const nestBody = stripDurationMs(prior(normalize(nest.json)));
  const springBody = stripDurationMs(prior(normalize(spring.json)));
  rawAudit.push(...rawNumericDiff(nestBody, springBody, `live:${name}`).map((d) => ({ check: name, ...d })));
  return compare(name, nest, spring, {
    ...cmp,
    bodyNormalizer: (b) => stripDurationMs(prior(b)),
    bodyDiff: domainAwareDiff,
  });
}

const get = (name, path, cmp) => pair(name, 'GET', path, (s) => ({ headers: auth(s) }), cmp);
const send = (name, method, path, body, cmp) => pair(name, method, path, (s) => ({ headers: auth(s), body: typeof body === 'function' ? body(s) : body }), cmp);
const post = (name, path, body, cmp) => send(name, 'POST', path, body, cmp);
const sim = (name, method, path, body) => send(name, method, path, body, { bodyNormalizer: stripDurationMs });
const overview = (name) => get(name, '/api/actuarial/overview', { bodyNormalizer: stripDurationMs });

const reference = {
  frequency: { family: 'BINOMIAL', policies: 1000, years: 1, probability: 0.05 },
  severity: { family: 'DETERMINISTIC', mean: 1200 },
  inflation: { annualRate: 0, years: 0 },
  expenses: { fixed: 20_000, perPolicy: 0, variableRate: 0 },
  profitMarginRate: 0,
  riskLoading: { method: 'EXPECTED_VALUE', parameter: 0.15 },
};
const motor = {
  ...reference,
  frequency: { family: 'POISSON', policies: 5000, years: 1, intensity: 0.08 },
  severity: { family: 'GAMMA', mean: 1800, cv: 0.9 },
  expenses: { fixed: 60_000, perPolicy: 12, variableRate: 0.15 },
  profitMarginRate: 0.05,
  riskLoading: { method: 'NONE', parameter: 0 },
};
const hand = {
  data: {
    firstOrigin: 2020,
    paid: [[100, 150, 165], [120, 186], [130]],
    incurred: [[160, 170, 168], [190, 210], [200]],
    premiums: [200, 220, 240],
  },
  assumptions: { average: 'VOLUME_WEIGHTED', tail: { paid: 1, incurred: 1 }, expectedLossRatio: 0.8 },
};
const taylorAshe = [
  [357848, 1124788, 1735330, 2218270, 2745596, 3319994, 3466336, 3606286, 3833515, 3901463],
  [352118, 1236139, 2170033, 3353322, 3799067, 4120063, 4647867, 4914039, 5339085],
  [290507, 1292306, 2218525, 3235179, 3985995, 4132918, 4628910, 4909315],
  [310608, 1418858, 2195047, 3757447, 4029929, 4381982, 4588268],
  [443160, 1136350, 2128333, 2897821, 3402672, 3873311],
  [396132, 1333217, 2180715, 2985752, 3691712],
  [440832, 1288463, 2419861, 3483130],
  [359480, 1421128, 2864498],
  [376686, 1363294],
  [344014],
];

const EXPECTED_MEAN = 60_000;
const EXPECTED_SD = 8270.429;
const EXPECTED_GROSS = 89_000;
const EXPECTED_LOSS = 0.138919;
const SD_TOLERANCE = 0.001;
const LOSS_TOLERANCE = 5e-6;
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

function near(actual, expected, tolerance) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
}

/** Closed form of the reference portfolio. `gross` and `loss` are omitted when the route does not return them. */
function expectReference(name, read) {
  const rows = {};
  let ok = true;
  for (const s of SIDES) {
    const row = read(s);
    rows[s] = row;
    if (row.mean !== EXPECTED_MEAN || !near(row.sd, EXPECTED_SD, SD_TOLERANCE)) ok = false;
    if ('gross' in row && row.gross !== EXPECTED_GROSS) ok = false;
    if ('loss' in row && !near(row.loss, EXPECTED_LOSS, LOSS_TOLERANCE)) ok = false;
  }
  record(name, ok, rows);
}

function unpaid(body, method) {
  return body?.results?.methods?.find((m) => m.method === method)?.totals?.unpaid;
}

/**
 * NestJS 500 INTERNAL_ERROR where class-validator throws, or where a skipped nested object is read by the service.
 * Spring answers 400 VALIDATION_ERROR. Recorded, not treated as a regression.
 */
async function divergence(name, method, path, body) {
  const nest = await call(NEST, method, path, { headers: auth('nest'), body });
  const spring = await call(SPRING, method, path, { headers: auth('spring'), body });
  record(
    `divergence (documented): ${name} → NestJS 500, Spring 400`,
    nest.status === 500 && nest.json?.errorCode === 'INTERNAL_ERROR' && spring.status === 400 && spring.json?.errorCode === 'VALIDATION_ERROR',
    { nest: [nest.status, nest.json?.errorCode], spring: [spring.status, spring.json?.errorCode] },
  );
}

const scenarioId = {};
const simulationId = {};
const reservingId = {};

async function actuarialState(side) {
  const userId = user[side].id;
  const scenarios = await prisma.actuarialScenario.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const simulations = await prisma.actuarialSimulationRun.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const reserving = await prisma.actuarialReservingRun.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return {
    scenarios: scenarios.map((s) => ({ name: s.name, kind: s.kind, modelVersion: s.modelVersion, currency: s.currency, inputs: s.inputs, results: s.results })),
    simulations: simulations.map((s) => ({ label: s.label, engineVersion: s.engineVersion, currency: s.currency, seed: s.seed, simulations: s.simulations, inputs: s.inputs, results: s.results })),
    reserving: reserving.map((r) => ({
      label: r.label,
      modelVersion: r.modelVersion,
      currency: r.currency,
      firstOrigin: r.firstOrigin,
      originCount: r.originCount,
      valuationYear: r.valuationYear,
      dataChecksum: r.dataChecksum,
      inputs: r.inputs,
      results: r.results,
    })),
  };
}

run(async () => {
  for (const side of SIDES) {
    user[side] = await createUser(`actuary-${side}`);
    const res = await call(BASE[side], 'POST', '/api/auth/login', { body: { email: email(`actuary-${side}`), password: PASSWORD } });
    if (res.status !== 200 || !res.json?.accessToken) throw new Error(`login failed on ${side}: ${res.status}`);
    token[side] = res.json.accessToken;
  }

  // ------------------------------------------------------------ authentication on all 20 routes
  await pair('overview: without a token', 'GET', '/api/actuarial/overview');
  await pair('presets: without a token', 'GET', '/api/actuarial/presets');
  await pair('frequency: without a token', 'POST', '/api/actuarial/frequency/analyze', () => ({ body: { frequency: reference.frequency } }));
  await pair('severity: without a token', 'POST', '/api/actuarial/severity/analyze', () => ({ body: { severity: reference.severity } }));
  await pair('aggregate: without a token', 'POST', '/api/actuarial/aggregate/analyze', () => ({ body: { frequency: reference.frequency, severity: reference.severity } }));
  await pair('pricing: without a token', 'POST', '/api/actuarial/pricing/calculate', () => ({ body: reference }));
  await pair('scenarios: list without a token', 'GET', '/api/actuarial/scenarios');
  await pair('scenarios: save without a token', 'POST', '/api/actuarial/scenarios', () => ({ body: { name: 'Unauth', assumptions: reference } }));
  await pair('scenarios: get without a token', 'GET', `/api/actuarial/scenarios/${UNKNOWN}`);
  await pair('scenarios: delete without a token', 'DELETE', `/api/actuarial/scenarios/${UNKNOWN}`);
  await pair('simulations: list without a token', 'GET', '/api/actuarial/simulations');
  await pair('simulations: create without a token', 'POST', '/api/actuarial/simulations', () => ({ body: { assumptions: reference, simulations: 1000, seed: 1, initialCapital: 0 } }));
  await pair('simulations: get without a token', 'GET', `/api/actuarial/simulations/${UNKNOWN}`);
  await pair('simulations: delete without a token', 'DELETE', `/api/actuarial/simulations/${UNKNOWN}`);
  await pair('reserving: examples without a token', 'GET', '/api/actuarial/reserving/examples');
  await pair('reserving: analyze without a token', 'POST', '/api/actuarial/reserving/analyze', () => ({ body: hand }));
  await pair('reserving: list without a token', 'GET', '/api/actuarial/reserving/runs');
  await pair('reserving: save without a token', 'POST', '/api/actuarial/reserving/runs', () => ({ body: { ...hand, label: 'Unauth' } }));
  await pair('reserving: get without a token', 'GET', `/api/actuarial/reserving/runs/${UNKNOWN}`);
  await pair('reserving: delete without a token', 'DELETE', `/api/actuarial/reserving/runs/${UNKNOWN}`);

  // ------------------------------------------------------------ overview and presets
  const emptyOverview = await overview('overview: new actuary');
  expectReference('overview: reference portfolio matches the closed form', (s) => {
    const pricing = emptyOverview[s].json?.reference?.pricing;
    return { mean: pricing?.aggregate?.mean, sd: pricing?.aggregate?.sd, gross: pricing?.premium?.totals?.grossPremium, loss: pricing?.probabilities?.underwritingLoss };
  });
  const presets = await get('presets: fictional portfolios', '/api/actuarial/presets');
  record(
    'presets: reference headline is 89,000 / 89 per policy and 60,000 expected claims',
    SIDES.every((s) => {
      const headline = presets[s].json?.presets?.[0]?.headline;
      return presets[s].json?.presets?.map((p) => p.id).join() === 'reference-deterministic,motor-gamma,home-lognormal'
        && headline?.grossPremium === EXPECTED_GROSS
        && headline?.grossPremiumPerPolicy === 89
        && headline?.expectedClaims === EXPECTED_MEAN;
    }),
    SIDES.map((s) => presets[s].json?.presets?.[0]?.headline),
  );

  // ------------------------------------------------------------ frequency, severity, aggregate, pricing
  const binomial = await post('frequency: binomial reference', '/api/actuarial/frequency/analyze', { frequency: reference.frequency });
  record('frequency: mean claim count is 50', SIDES.every((s) => binomial[s].json?.frequency?.mean === 50), SIDES.map((s) => binomial[s].json?.frequency?.mean));
  await post('frequency: policies accepted as a numeric string', '/api/actuarial/frequency/analyze', { frequency: { ...reference.frequency, policies: '1000' } });
  await post('frequency: Poisson', '/api/actuarial/frequency/analyze', { frequency: { family: 'POISSON', policies: 200, years: 1, intensity: 0.01 } });
  await post('frequency: binomial without a probability', '/api/actuarial/frequency/analyze', { frequency: { family: 'BINOMIAL', policies: 1000, years: 1 } });
  await post('frequency: too many decimal places on the term', '/api/actuarial/frequency/analyze', { frequency: { ...reference.frequency, years: 1.234 } });
  await post('frequency: null is not an object', '/api/actuarial/frequency/analyze', { frequency: null });
  await post('frequency: an array fails in the model', '/api/actuarial/frequency/analyze', { frequency: [] });
  await post('frequency: unknown property', '/api/actuarial/frequency/analyze', { frequency: { ...reference.frequency, extra: 1 } });
  await post('frequency: too many policies', '/api/actuarial/frequency/analyze', { frequency: { ...reference.frequency, policies: 2_000_000 } });

  const gamma = await post('severity: gamma with one threshold', '/api/actuarial/severity/analyze', { severity: { family: 'GAMMA', mean: 1000, cv: 1 }, thresholds: [1000] });
  record(
    'severity: exponential tail P(X > mean) is e^-1',
    SIDES.every((s) => near(gamma[s].json?.severity?.exceedance?.[0]?.probability, Math.exp(-1), 1e-9)),
    SIDES.map((s) => gamma[s].json?.severity?.exceedance?.[0]?.probability),
  );
  await post('severity: deterministic reference', '/api/actuarial/severity/analyze', { severity: reference.severity });
  await post('severity: a four-decimal threshold is allowed', '/api/actuarial/severity/analyze', { severity: reference.severity, thresholds: [1.2345] });
  await post('severity: at most five thresholds', '/api/actuarial/severity/analyze', { severity: reference.severity, thresholds: [1, 2, 3, 4, 5, 6] });
  await post('severity: negative threshold', '/api/actuarial/severity/analyze', { severity: reference.severity, thresholds: [-1] });
  await post('severity: threshold that is not a number', '/api/actuarial/severity/analyze', { severity: reference.severity, thresholds: ['x'] });
  await post('severity: gamma without a coefficient of variation', '/api/actuarial/severity/analyze', { severity: { family: 'GAMMA', mean: 1000 } });
  await post('severity: normal is not offered', '/api/actuarial/severity/analyze', { severity: { family: 'NORMAL', mean: 1000 } });

  const aggregate = await post('aggregate: reference portfolio', '/api/actuarial/aggregate/analyze', { frequency: reference.frequency, severity: reference.severity, thresholds: [60_000, 69_000] });
  expectReference('aggregate: reference mean and standard deviation', (s) => ({ mean: aggregate[s].json?.aggregate?.mean, sd: aggregate[s].json?.aggregate?.sd }));
  record(
    'aggregate: P(S > 69,000) is the published 13.8919%',
    SIDES.every((s) => near(aggregate[s].json?.aggregate?.exceedance?.find((e) => e.threshold === 69_000)?.probability, EXPECTED_LOSS, LOSS_TOLERANCE)),
    SIDES.map((s) => aggregate[s].json?.aggregate?.exceedance),
  );
  await post('aggregate: unknown property', '/api/actuarial/aggregate/analyze', { frequency: reference.frequency, severity: reference.severity, extra: true });

  const priced = await post('pricing: reference portfolio', '/api/actuarial/pricing/calculate', reference);
  expectReference('pricing: reference mean, standard deviation, gross premium and underwriting loss', (s) => {
    const body = priced[s].json;
    return { mean: body?.aggregate?.mean, sd: body?.aggregate?.sd, gross: body?.premium?.totals?.grossPremium, loss: body?.probabilities?.underwritingLoss };
  });
  record(
    'pricing: gross premium per policy is 89',
    SIDES.every((s) => priced[s].json?.premium?.perPolicy?.grossPremium === 89),
    SIDES.map((s) => priced[s].json?.premium?.perPolicy?.grossPremium),
  );
  await post('pricing: variable expenses, margin and a gamma Panjer distribution', '/api/actuarial/pricing/calculate', motor);
  await post('pricing: standard-deviation loading', '/api/actuarial/pricing/calculate', { ...reference, riskLoading: { method: 'STANDARD_DEVIATION', parameter: 0.5 } });
  await post('pricing: binomial without a probability', '/api/actuarial/pricing/calculate', { ...reference, frequency: { family: 'BINOMIAL', policies: 1000, years: 1 } });
  await post('pricing: normal severity', '/api/actuarial/pricing/calculate', { ...reference, severity: { family: 'NORMAL', mean: 1000 } });
  await post('pricing: gamma without a coefficient of variation', '/api/actuarial/pricing/calculate', { ...reference, severity: { family: 'GAMMA', mean: 1000 } });
  await post('pricing: too many policies', '/api/actuarial/pricing/calculate', { ...reference, frequency: { ...reference.frequency, policies: 2_000_000 } });
  await post('pricing: unknown property', '/api/actuarial/pricing/calculate', { ...reference, unexpected: true });
  await post('pricing: empty body', '/api/actuarial/pricing/calculate', {});
  await post('pricing: expected-value loading above 1 is a model error', '/api/actuarial/pricing/calculate', { ...reference, riskLoading: { method: 'EXPECTED_VALUE', parameter: 2 } });

  // ------------------------------------------------------------ documented Nest 500 / Spring 400 crashes
  await divergence('missing frequency body', 'POST', '/api/actuarial/frequency/analyze', {});
  await divergence('missing severity body', 'POST', '/api/actuarial/severity/analyze', {});
  await divergence('missing aggregate body', 'POST', '/api/actuarial/aggregate/analyze', {});
  await divergence('years written as 1e-7 crashes class-validator', 'POST', '/api/actuarial/pricing/calculate', { ...reference, frequency: { ...reference.frequency, years: 1e-7 } });
  await divergence('profit margin written as 1e-7 crashes class-validator', 'POST', '/api/actuarial/pricing/calculate', { ...reference, profitMarginRate: 1e-7 });

  // ------------------------------------------------------------ scenarios
  const saved = await post('scenario: save the reference case', '/api/actuarial/scenarios', { name: '  Reference base case  ', assumptions: reference });
  for (const s of SIDES) scenarioId[s] = saved[s].json?.id;
  if (!scenarioId.nest || !scenarioId.spring) throw new Error('scenario save failed; cannot continue');
  record('scenario: the name is trimmed and the gross premium per policy is 89', SIDES.every((s) => saved[s].json?.name === 'Reference base case' && saved[s].json?.headline?.grossPremiumPerPolicy === 89), null);
  await post('scenario: duplicate name', '/api/actuarial/scenarios', { name: 'Reference base case', assumptions: reference });
  await post('scenario: name rejected', '/api/actuarial/scenarios', { name: '<script>', assumptions: reference });
  await post('scenario: client results are rejected', '/api/actuarial/scenarios', { name: 'Tampered', assumptions: reference, results: { grossPremium: 1 } });
  await post('scenario: empty body', '/api/actuarial/scenarios', {});
  await get('scenarios: one saved', '/api/actuarial/scenarios');
  await get('scenario: get', (s) => `/api/actuarial/scenarios/${scenarioId[s]}`);
  await pair("scenario: another user's scenario is not found", 'GET', (s) => `/api/actuarial/scenarios/${scenarioId[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));
  await pair("scenario: another user cannot delete it", 'DELETE', (s) => `/api/actuarial/scenarios/${scenarioId[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));
  await get('scenario: still present', (s) => `/api/actuarial/scenarios/${scenarioId[s]}`);
  await get('scenario: malformed id', '/api/actuarial/scenarios/not-a-uuid');
  await get('scenario: unknown id', `/api/actuarial/scenarios/${UNKNOWN}`);
  for (const s of SIDES) await prisma.actuarialScenario.update({ where: { id: scenarioId[s] }, data: { modelVersion: 'pif-actuarial-0.9.0' } });
  await get('scenario: an older model version is stale', (s) => `/api/actuarial/scenarios/${scenarioId[s]}`);
  await send('scenario: delete', 'DELETE', (s) => `/api/actuarial/scenarios/${scenarioId[s]}`);
  await get('scenario: deleted', (s) => `/api/actuarial/scenarios/${scenarioId[s]}`);
  const motorSaved = await post('scenario: save the motor book', '/api/actuarial/scenarios', { name: 'Motor gamma book', assumptions: motor });
  for (const s of SIDES) scenarioId[s] = motorSaved[s].json?.id;
  if (!scenarioId.nest || !scenarioId.spring) throw new Error('second scenario save failed');
  await overview('overview: one scenario');

  // ------------------------------------------------------------ simulations (small, seeded). At most 12 POSTs per minute on this route.
  const seeded = { assumptions: reference, simulations: 1000, seed: 42, initialCapital: 5_000 };
  await sim('simulation: below the minimum size', 'POST', '/api/actuarial/simulations', { ...seeded, simulations: 999 });
  await sim('simulation: seed 0', 'POST', '/api/actuarial/simulations', { ...seeded, seed: 0 });
  await sim('simulation: client results are rejected', 'POST', '/api/actuarial/simulations', { ...seeded, results: { mean: 1 } });
  await sim('simulation: above the claim-draw budget', 'POST', '/api/actuarial/simulations', {
    ...seeded,
    simulations: 200_000,
    assumptions: { ...reference, frequency: { family: 'POISSON', policies: 10_000, years: 1, intensity: 0.1 }, severity: { family: 'LOGNORMAL', mean: 1000, cv: 1 } },
  });
  await post('simulation: empty body', '/api/actuarial/simulations', {});
  const first = await sim('simulation: seeded reference, 1,000 draws', 'POST', '/api/actuarial/simulations', { ...seeded, label: 'Reference, 5k capital' });
  for (const s of SIDES) simulationId[s] = first[s].json?.id;
  if (!simulationId.nest || !simulationId.spring) throw new Error('simulation failed; cannot continue');
  expectReference('simulation: analytic mean, standard deviation, model premium and P(S > budget)', (s) => {
    const results = first[s].json?.results;
    return { mean: results?.analytic?.mean, sd: results?.analytic?.sd, gross: results?.thresholds?.modelGrossPremium, loss: results?.probabilities?.claimsExceedBudget?.exact };
  });
  record(
    'simulation: the histogram accounts for every draw and the body stays a summary',
    SIDES.every((s) => {
      const results = first[s].json?.results;
      const total = results?.histogram?.counts?.reduce((a, b) => a + b, 0) + results?.histogram?.above;
      return total === 1000 && JSON.stringify(first[s].json).length < 40_000 && first[s].json?.results?.thresholds?.claimsBudget === 69_000;
    }),
    null,
  );
  await sim('simulation: get', 'GET', (s) => `/api/actuarial/simulations/${simulationId[s]}`);
  await get('simulation: malformed id', '/api/actuarial/simulations/not-a-uuid');
  await get('simulation: unknown id', `/api/actuarial/simulations/${UNKNOWN}`);
  await pair("simulation: another user's run is not found", 'GET', (s) => `/api/actuarial/simulations/${simulationId[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));
  await pair("simulation: another user cannot delete it", 'DELETE', (s) => `/api/actuarial/simulations/${simulationId[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));

  // 1 stored run + 25 older rows = 26. The next save keeps the newest 25 and drops the two oldest inserts.
  const oldest = Date.now() - 3_600_000;
  for (const s of SIDES) {
    const row = await prisma.actuarialSimulationRun.findUniqueOrThrow({ where: { id: simulationId[s] } });
    await prisma.actuarialSimulationRun.createMany({
      data: Array.from({ length: 25 }, (_, k) => ({
        userId: user[s].id,
        label: `Older run ${k}`,
        engineVersion: k === 24 ? 'pif-actuarial-mc-0.9.0' : row.engineVersion,
        seed: k + 1,
        simulations: row.simulations,
        durationMs: 1,
        inputs: row.inputs,
        results: row.results,
        createdAt: new Date(oldest + k * 1000),
      })),
    });
  }
  const latest = await sim('simulation: one more run trims the history to 25', 'POST', '/api/actuarial/simulations', { ...seeded, seed: 7, label: 'Latest' });
  const latestId = {};
  for (const s of SIDES) latestId[s] = latest[s].json?.id;
  if (!latestId.nest || !latestId.spring) throw new Error('retention simulation failed');
  const simList = await sim('simulations: 25 newest', 'GET', '/api/actuarial/simulations');
  record(
    'simulations: the two oldest inserts were dropped and the stale engine is flagged',
    SIDES.every((s) => {
      const runs = simList[s].json?.runs ?? [];
      const labels = runs.map((r) => r.label);
      return simList[s].json?.kept === 25 && runs.length === 25 && runs[0].id === latestId[s]
        && !labels.includes('Older run 0') && !labels.includes('Older run 1') && labels.includes('Older run 2')
        && runs.find((r) => r.label === 'Older run 24')?.stale === true;
    }),
    SIDES.map((s) => simList[s].json?.runs?.map((r) => r.label)),
  );
  await sim('simulation: delete the latest', 'DELETE', (s) => `/api/actuarial/simulations/${latestId[s]}`);
  await sim('simulation: deleted', 'GET', (s) => `/api/actuarial/simulations/${latestId[s]}`);
  const again = await sim('simulation: the same seed reproduces the summary', 'POST', '/api/actuarial/simulations', { ...seeded, label: 'Reference, 5k capital' });
  const withoutIdentity = ({ id, createdAt, durationMs, ...rest }) => rest;
  record(
    'simulation: each side reproduces its own seeded summary',
    SIDES.every((s) => JSON.stringify(withoutIdentity(again[s].json)) === JSON.stringify(withoutIdentity(first[s].json))),
    null,
  );
  await sim('simulation: a charged premium overrides the model premium', 'POST', '/api/actuarial/simulations', { assumptions: reference, simulations: 1000, seed: 42, initialCapital: 0, premiumCharged: 80_000 });
  await sim('simulation: small seeded lognormal book', 'POST', '/api/actuarial/simulations', {
    assumptions: {
      frequency: { family: 'POISSON', policies: 50, years: 1, intensity: 0.04 },
      severity: { family: 'LOGNORMAL', mean: 1000, cv: 1 },
      inflation: { annualRate: 0, years: 0 },
      expenses: { fixed: 0, perPolicy: 0, variableRate: 0 },
      profitMarginRate: 0,
      riskLoading: { method: 'NONE', parameter: 0 },
    },
    simulations: 1000,
    seed: 7,
    initialCapital: 1000,
    label: 'Small lognormal',
  });
  await divergence('simulation whose assumptions object is missing', 'POST', '/api/actuarial/simulations', { simulations: 1000, initialCapital: 0 });
  await overview('overview: simulations recorded');

  // ------------------------------------------------------------ reserving
  const examples = await get('reserving: examples', '/api/actuarial/reserving/examples');
  const exampleList = examples.nest.json?.examples;
  if (!Array.isArray(exampleList) || exampleList.length !== 3) throw new Error('reserving examples failed; cannot continue');
  for (const example of exampleList) {
    await post(`reserving: analyze example ${example.id}`, '/api/actuarial/reserving/analyze', { data: example.data, assumptions: example.assumptions });
  }
  const analyzed = await post('reserving: hand triangle', '/api/actuarial/reserving/analyze', hand);
  record(
    'reserving: hand triangle paid chain-ladder reserve is 107 and the reconciliation holds',
    SIDES.every((s) => Math.abs(unpaid(analyzed[s].json, 'CHAIN_LADDER_PAID') - 107) < 1e-9 && analyzed[s].json?.results?.reconciliation?.holds === true),
    SIDES.map((s) => unpaid(analyzed[s].json, 'CHAIN_LADDER_PAID')),
  );
  const benchmark = await post('reserving: Taylor & Ashe benchmark', '/api/actuarial/reserving/analyze', { data: { firstOrigin: 2001, paid: taylorAshe }, assumptions: { average: 'VOLUME_WEIGHTED', tail: { paid: 1, incurred: 1 } } });
  record(
    'reserving: Taylor & Ashe paid chain-ladder reserve rounds to 18,680,856',
    SIDES.every((s) => Math.round(unpaid(benchmark[s].json, 'CHAIN_LADDER_PAID')) === 18_680_856),
    SIDES.map((s) => unpaid(benchmark[s].json, 'CHAIN_LADDER_PAID')),
  );
  await post('reserving: latest diagonals', '/api/actuarial/reserving/analyze', { ...hand, assumptions: { ...hand.assumptions, average: 'LATEST_DIAGONALS', latestDiagonals: 2 } });
  const gap = await post('reserving: a missing cell is not read as zero', '/api/actuarial/reserving/analyze', {
    data: { firstOrigin: 2020, paid: [[100, 150, 165, 170], [120, null, 200], [130, 190], [140]] },
    assumptions: { average: 'VOLUME_WEIGHTED', tail: { paid: 1, incurred: 1 } },
  });
  record(
    'reserving: the gapped link ratio uses the two complete pairs only',
    SIDES.every((s) => gap[s].json?.results?.chainLadder?.paid?.factors?.[0]?.pairs === 2 && gap[s].json?.results?.chainLadder?.paid?.factors?.[0]?.selected === 340 / 230),
    SIDES.map((s) => gap[s].json?.results?.chainLadder?.paid?.factors?.[0]),
  );
  await post('reserving: selected factors replace an undefined development', '/api/actuarial/reserving/analyze', {
    data: { firstOrigin: 2020, paid: [[0, 0, 10], [0, 5], [7]] },
    assumptions: { average: 'VOLUME_WEIGHTED', tail: { paid: 1, incurred: 1 }, selectedFactors: { paid: [2, 1.5] } },
  });
  await post('reserving: client results are rejected', '/api/actuarial/reserving/analyze', { ...hand, results: { total: 1 } });
  await post('reserving: premiums must be numbers', '/api/actuarial/reserving/analyze', { ...hand, data: { ...hand.data, premiums: ['200', 220, 240] } });
  await post('reserving: origin year out of range', '/api/actuarial/reserving/analyze', { ...hand, data: { ...hand.data, firstOrigin: 1800 } });
  await post('reserving: unknown average', '/api/actuarial/reserving/analyze', { ...hand, assumptions: { average: 'MEDIAN', tail: { paid: 1, incurred: 1 } } });
  await post('reserving: latest diagonals without a count', '/api/actuarial/reserving/analyze', { ...hand, assumptions: { average: 'LATEST_DIAGONALS', tail: { paid: 1, incurred: 1 } } });
  await post('reserving: tail factor out of range', '/api/actuarial/reserving/analyze', { ...hand, assumptions: { average: 'VOLUME_WEIGHTED', tail: { paid: 9, incurred: 1 } } });
  await post('reserving: ragged triangle', '/api/actuarial/reserving/analyze', { ...hand, data: { ...hand.data, paid: [[100, 150, 165], [120, 186, 190], [130]] } });
  await post('reserving: a cell that is not a number', '/api/actuarial/reserving/analyze', { ...hand, data: { ...hand.data, paid: [[100, 'x', 165], [120, 186], [130]] } });
  await post('reserving: the latest cell of a row is required', '/api/actuarial/reserving/analyze', { ...hand, data: { ...hand.data, paid: [[100, 150, 165], [120, null], [130]] } });
  await post('reserving: an undefined development factor', '/api/actuarial/reserving/analyze', { data: { firstOrigin: 2020, paid: [[0, 0, 10], [0, 5], [7]] }, assumptions: { average: 'VOLUME_WEIGHTED', tail: { paid: 1, incurred: 1 } } });
  await post('reserving: empty body', '/api/actuarial/reserving/runs', {});
  await post('reserving: label rejected', '/api/actuarial/reserving/runs', { ...hand, label: '<script>' });
  await post('reserving: a save cannot carry client results', '/api/actuarial/reserving/runs', { ...hand, label: 'Hand', results: { methods: [] } });
  // Missing data and a missing tail pass validation and the service throws. Spring returns the same 500.
  await post('reserving: missing triangle is an internal error', '/api/actuarial/reserving/analyze', {});
  await post('reserving: missing tail is an internal error', '/api/actuarial/reserving/analyze', { data: hand.data, assumptions: { average: 'VOLUME_WEIGHTED' } });

  const firstRun = await post('reserving: save the hand triangle', '/api/actuarial/reserving/runs', { ...hand, label: '  Hand triangle, volume-weighted  ' });
  for (const s of SIDES) reservingId[s] = firstRun[s].json?.id;
  if (!reservingId.nest || !reservingId.spring) throw new Error('reserving save failed; cannot continue');
  record(
    'reserving: checksums match across sides and the simple name is trimmed',
    firstRun.nest.json?.dataChecksum === firstRun.spring.json?.dataChecksum
      && /^[0-9a-f]{64}$/.test(firstRun.nest.json?.dataChecksum ?? '')
      && SIDES.every((s) => firstRun[s].json?.label === 'Hand triangle, volume-weighted'),
    { nest: firstRun.nest.json?.dataChecksum, spring: firstRun.spring.json?.dataChecksum },
  );
  const secondRun = await post('reserving: save the simple average', '/api/actuarial/reserving/runs', { ...hand, label: 'Hand triangle, simple average', assumptions: { ...hand.assumptions, average: 'SIMPLE_AVERAGE' } });
  record(
    'reserving: the same triangles keep the checksum and the simple-average link is 1.525',
    secondRun.nest.json?.dataChecksum === firstRun.nest.json?.dataChecksum
      && secondRun.spring.json?.dataChecksum === firstRun.spring.json?.dataChecksum
      && SIDES.every((s) => secondRun[s].json?.results?.chainLadder?.paid?.factors?.[0]?.selected === 1.525),
    null,
  );
  await get('reserving: get', (s) => `/api/actuarial/reserving/runs/${reservingId[s]}`);
  await get('reserving: malformed id', '/api/actuarial/reserving/runs/not-a-uuid');
  await get('reserving: unknown id', `/api/actuarial/reserving/runs/${UNKNOWN}`);
  await pair("reserving: another user's run is not found", 'GET', (s) => `/api/actuarial/reserving/runs/${reservingId[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));
  await pair("reserving: another user cannot delete it", 'DELETE', (s) => `/api/actuarial/reserving/runs/${reservingId[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));

  // 2 stored runs + 24 older rows = 26. The next save keeps 25 and drops the two oldest inserts.
  for (const s of SIDES) {
    const row = await prisma.actuarialReservingRun.findUniqueOrThrow({ where: { id: reservingId[s] } });
    await prisma.actuarialReservingRun.createMany({
      data: Array.from({ length: 24 }, (_, k) => ({
        userId: user[s].id,
        label: `Older run ${k}`,
        modelVersion: k === 23 ? 'pif-reserving-0.9.0' : row.modelVersion,
        firstOrigin: row.firstOrigin,
        originCount: row.originCount,
        valuationYear: row.valuationYear,
        dataChecksum: row.dataChecksum,
        inputs: row.inputs,
        results: row.results,
        createdAt: new Date(oldest + k * 1000),
      })),
    });
  }
  const latestRun = await post('reserving: one more run trims the history to 25', '/api/actuarial/reserving/runs', { ...hand, label: 'Latest' });
  const latestRunId = {};
  for (const s of SIDES) latestRunId[s] = latestRun[s].json?.id;
  if (!latestRunId.nest || !latestRunId.spring) throw new Error('reserving retention save failed');
  const runList = await get('reserving: 25 newest', '/api/actuarial/reserving/runs');
  record(
    'reserving: the two oldest inserts were dropped and the stale model is flagged',
    SIDES.every((s) => {
      const runs = runList[s].json?.runs ?? [];
      const labels = runs.map((r) => r.label);
      return runList[s].json?.kept === 25 && runs.length === 25 && runs[0].id === latestRunId[s]
        && !labels.includes('Older run 0') && !labels.includes('Older run 1') && labels.includes('Older run 2')
        && runs.find((r) => r.label === 'Older run 23')?.stale === true;
    }),
    SIDES.map((s) => runList[s].json?.runs?.map((r) => r.label)),
  );
  await send('reserving: delete the latest', 'DELETE', (s) => `/api/actuarial/reserving/runs/${latestRunId[s]}`);
  await get('reserving: deleted', (s) => `/api/actuarial/reserving/runs/${latestRunId[s]}`);
  await overview('overview: final');

  // ------------------------------------------------------------ persisted rows (checksums compared raw; normalize folds every 64-hex string)
  const [nestState, springState] = await Promise.all(SIDES.map(actuarialState));
  record(
    'db: reserving checksums are identical',
    nestState.reserving.length > 0 && nestState.reserving.every((row, i) => row.dataChecksum === springState.reserving[i]?.dataChecksum),
    { nest: nestState.reserving.map((r) => r.dataChecksum), spring: springState.reserving.map((r) => r.dataChecksum) },
  );
  const foldChecksum = (state) => ({ ...state, reserving: state.reserving.map((r) => ({ ...r, dataChecksum: '<checksum>' })) });
  const nestDb = stripDurationMs(normalize(foldChecksum(nestState)));
  const springDb = stripDurationMs(normalize(foldChecksum(springState)));
  rawAudit.push(...rawNumericDiff(nestDb, springDb, 'db').map((d) => ({ check: 'db:state', ...d })));
  const differences = domainAwareDiff(nestDb, springDb, 'db');
  record('db: scenarios, simulations and reserving runs are identical', differences.length === 0, differences.slice(0, 12));
  record(
    'db: each side kept a scenario, a seeded simulation and a reserving run',
    SIDES.every((s) => (s === 'nest' ? nestState : springState).scenarios.length >= 1)
      && nestState.simulations.some((r) => r.seed === 42) && springState.simulations.some((r) => r.seed === 42)
      && nestState.reserving.length >= 2 && springState.reserving.length >= 2,
    { nest: [nestState.scenarios.length, nestState.simulations.length, nestState.reserving.length], spring: [springState.scenarios.length, springState.simulations.length, springState.reserving.length] },
  );

  try {
    mkdirSync(join(process.cwd(), 'target'), { recursive: true });
    writeFileSync(join(process.cwd(), 'target', 'numerical-parity-raw.json'), JSON.stringify({
      capturedAt: new Date().toISOString(),
      rawNumericMismatches: rawAudit,
      accepted: rawAudit.filter((d) => d.accepted).length,
      rejected: rawAudit.filter((d) => !d.accepted).length,
    }, null, 2));
  } catch { /* non-fatal */ }

  await finish('differential-actuarial');
});
