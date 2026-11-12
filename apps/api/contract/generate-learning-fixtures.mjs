// Generates the golden fixture for com.pif.api.learning by running the real TypeScript learning engine
// (apps/api/src/learning: simulator, market paths, metrics, objectives, assessment, mentor, mastery,
// recommendations, views and FinStories progress) over every mission with scripted and seeded random command
// sequences.
//
// Usage (from the repository root):
//   node apps/api-spring/contract/generate-learning-fixtures.mjs
//
// The compiled engine in apps/api/dist is used when it is at least as recent as its sources. Otherwise the sources
// are transpiled with the TypeScript compiler of apps/api into a temporary directory outside the repository, loaded
// from there and deleted afterwards. Nothing under apps/api is written.
//
// Encoding as in the other generators: every number is its Number.prototype.toString() text ("-0" kept), dates are
// toISOString() text, objects keep JS property order. Digests are sha256 over JSON.stringify of the encoded value.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../api');
const srcDir = join(apiDir, 'src');
const distDir = join(apiDir, 'dist');

const ENTRIES = [
  'learning/engine/simulator.ts', 'learning/engine/market.ts', 'learning/engine/metrics.ts',
  'learning/engine/objectives.ts', 'learning/engine/assessment.ts', 'learning/engine/mentor.ts',
  'learning/engine/mastery.ts', 'learning/engine/recommendations.ts', 'learning/engine/money.ts',
  'learning/engine/types.ts', 'learning/engine/testing/fixtures.ts', 'learning/missions/catalog.ts',
  'learning/missions/validate.ts', 'learning/learning.view.ts', 'learning/stories/catalog.ts',
  'learning/stories/progress.ts',
];

// Transitive closure of relative imports, so the freshness check and the fallback cover every source file used.
const files = new Set();
const pending = [...ENTRIES];
while (pending.length) {
  const file = pending.pop();
  if (files.has(file)) continue;
  files.add(file);
  const text = readFileSync(join(srcDir, file), 'utf8');
  for (const [, spec] of text.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
    let target = posix.normalize(posix.join(posix.dirname(file), spec));
    if (existsSync(join(srcDir, `${target}.ts`))) target = `${target}.ts`;
    else if (existsSync(join(srcDir, target, 'index.ts'))) target = `${target}/index.ts`;
    else throw new Error(`Cannot resolve ${spec} from ${file}`);
    pending.push(target);
  }
}
const sources = [...files].sort();
const sourceHashes = Object.fromEntries(sources.map((f) => [f, createHash('sha256').update(readFileSync(join(srcDir, f))).digest('hex')]));

const distFresh = sources.every((f) => {
  const js = join(distDir, f.replace(/\.ts$/, '.js'));
  return existsSync(js) && statSync(js).mtimeMs >= statSync(join(srcDir, f)).mtimeMs;
});

let rootDir = distDir;
let tempDir = null;
if (!distFresh) {
  const ts = createRequire(join(apiDir, 'package.json'))('typescript');
  const tsconfig = ts.readConfigFile(join(apiDir, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.convertCompilerOptionsFromJson(tsconfig.config.compilerOptions, apiDir);
  const compilerOptions = { ...options, sourceMap: false, declaration: false, incremental: false, outDir: undefined };
  tempDir = mkdtempSync(join(tmpdir(), 'pif-learning-ts-'));
  for (const file of sources) {
    const text = readFileSync(join(srcDir, file), 'utf8');
    const { outputText, diagnostics } = ts.transpileModule(text, { compilerOptions, fileName: file, reportDiagnostics: true });
    if (diagnostics?.length) throw new Error(`${file}: ${diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`);
    mkdirSync(join(tempDir, dirname(file)), { recursive: true });
    writeFileSync(join(tempDir, file.replace(/\.ts$/, '.js')), outputText);
  }
  writeFileSync(join(tempDir, 'package.json'), '{ "type": "commonjs" }\n');
  rootDir = tempDir;
}
console.log(`engine: ${distFresh ? 'apps/api/dist' : 'transpiled sources'} (${sources.length} files)`);

const req = createRequire(join(rootDir, 'index.js'));
const S = req('./learning/engine/simulator.js');
const M = req('./learning/engine/market.js');
const { computeMetrics } = req('./learning/engine/metrics.js');
const { evaluateObjectives } = req('./learning/engine/objectives.js');
const { assessSession } = req('./learning/engine/assessment.js');
const { mentorDuringSession, mentorDebrief } = req('./learning/engine/mentor.js');
const { computeMastery } = req('./learning/engine/mastery.js');
const { recommend, unlockedLevel } = req('./learning/engine/recommendations.js');
const { fromMillimes } = req('./learning/engine/money.js');
const { RATIONALES } = req('./learning/engine/types.js');
const { testMission, shock } = req('./learning/engine/testing/fixtures.js');
const { MISSIONS } = req('./learning/missions/catalog.js');
const { validateCatalog, validateMission } = req('./learning/missions/validate.js');
const V = req('./learning/learning.view.js');
const { STORIES, storyDuration } = req('./learning/stories/catalog.js');
const P = req('./learning/stories/progress.js');

// ---------------------------------------------------------------- encoding
const num = (x) => (Object.is(x, -0) ? '-0' : String(x));
function enc(v) {
  if (typeof v === 'number') return num(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
}
const digest = (v) => createHash('sha256').update(JSON.stringify(enc(v))).digest('hex');

// Driver randomness: a separate mulberry32 stream, never the one under test.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261111);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const round3 = (x) => Math.round(x * 1000) / 1000;

const SESSION_MODES = ['GUIDED', 'SOCRATIC', 'CRITICAL'];

// ---------------------------------------------------------------- scenarios
function session(mission) {
  const ctx = S.createContext(mission);
  let state = S.initialState(ctx);
  const log = [];
  const steps = [];
  const price = (symbol, side) => fromMillimes(M.quoteAt(ctx.market, state.step, symbol)[side]);
  const held = (symbol) => state.positions[symbol]?.quantity ?? 0;
  const run = (command, seqOverride) => {
    const seq = seqOverride ?? state.lastCommandSeq + 1;
    const entry = { command: enc(command) };
    if (seqOverride !== undefined) entry.seq = num(seqOverride);
    if (command.type === 'PLACE_ORDER') entry.preview = enc(V.orderPreviewView(S.previewOrder(ctx, state, command)));
    try {
      const result = S.applyCommand(ctx, state, command, seq);
      state = result.state;
      log.push({ seq, command });
      entry.ok = enc({ outcome: result.outcome, message: result.message, events: result.events });
    } catch (error) {
      if (!(error instanceof S.SimulationError)) throw error;
      entry.error = { code: error.code, message: error.message };
    }
    entry.state = digest(state);
    entry.view = digest(V.sessionState(ctx, state));
    if (state.status === 'ACTIVE') entry.mentor = SESSION_MODES.map((mode) => digest(mentorDuringSession(ctx, state, mode)));
    steps.push(entry);
  };
  const finish = () => {
    while (state.status === 'ACTIVE' && !S.isMarketClosed(ctx, state)) run({ type: 'ADVANCE' });
    if (state.status === 'ACTIVE') run({ type: 'FINISH' });
  };
  return { ctx, get state() { return state; }, log, steps, run, finish, price, held };
}

/** Commands of a Financial Time Machine branch, exactly as LearningService.branch builds them. */
function branchCommands(ctx, log, fromSeq, strategy) {
  const kept = log.filter((c) => c.seq < fromSeq).map((c) => c.command);
  const commands = [...kept];
  if (strategy === 'HOLD') {
    let probe = S.initialState(ctx);
    for (const c of kept) probe = S.applyCommand(ctx, probe, c, probe.lastCommandSeq + 1).state;
    while (probe.status === 'ACTIVE' && !S.isMarketClosed(ctx, probe)) {
      probe = S.applyCommand(ctx, probe, { type: 'ADVANCE' }, probe.lastCommandSeq + 1).state;
      commands.push({ type: 'ADVANCE' });
    }
    if (probe.status === 'ACTIVE') commands.push({ type: 'FINISH' });
  }
  return commands;
}

/** Replays commands while the session is active, as LearningService.createSession does. */
function replayBranch(ctx, commands) {
  let state = S.initialState(ctx);
  let applied = 0;
  for (const command of commands) {
    if (state.status !== 'ACTIVE') break;
    state = S.applyCommand(ctx, state, command, state.lastCommandSeq + 1).state;
    applied++;
  }
  return { state, applied };
}

function finalOf(sim) {
  const { ctx, state, log } = sim;
  const ended = state.status !== 'ACTIVE';
  const out = {
    state: enc(state),
    view: enc(V.sessionState(ctx, state)),
    metrics: enc(computeMetrics(ctx, state)),
    objectives: enc(evaluateObjectives(ctx, state)),
    replayed: digest(S.replay(ctx, log)) === digest(state),
    describe: log.map((l) => V.describeCommand(l.command)),
  };
  if (ended) {
    const assessment = assessSession(ctx, state);
    out.assessment = enc(assessment);
    out.debrief = enc(mentorDebrief(ctx, state, assessment));
    const points = [...new Set([1, Math.ceil(log.length / 2), log.length].filter((s) => s >= 1))];
    out.branches = [];
    for (const fromSeq of points) {
      for (const strategy of ['MANUAL', 'HOLD']) {
        const commands = branchCommands(ctx, log, fromSeq, strategy);
        const replayed = replayBranch(ctx, commands);
        const branch = { fromSeq: num(fromSeq), strategy, commands: enc(commands), applied: num(replayed.applied), state: digest(replayed.state), status: replayed.state.status };
        if (replayed.state.status !== 'ACTIVE') branch.assessment = digest(assessSession(ctx, replayed.state));
        out.branches.push(branch);
      }
    }
  } else {
    out.mentor = SESSION_MODES.map((mode) => enc(mentorDuringSession(ctx, state, mode)));
  }
  return out;
}

const order = (symbol, side, orderType, quantity, extra = {}) => ({
  type: 'PLACE_ORDER', symbol, side, orderType, quantity,
  rationale: side === 'BUY' ? 'DIVERSIFY' : 'LIMIT_DOWNSIDE', confidence: 60, ...extra,
});
const affordable = (sim, symbol, share) => Math.max(1, Math.floor((fromMillimes(sim.state.cash) * share) / sim.price(symbol, 'ask')));

/** The three strategies of golden.spec.ts, plus an all-in bet on the worst performer and seeded random play. */
const scripted = {
  hold: (sim, m) => {
    const owned = new Set(m.initialPositions.map((p) => p.symbol));
    const target = m.scenario.assets.find((a) => !owned.has(a.symbol)) ?? m.scenario.assets[0];
    sim.run(order(target.symbol, 'BUY', 'MARKET', affordable(sim, target.symbol, 0.2)));
  },
  active: (sim, m) => {
    const [a, b, c] = [m.scenario.assets[0], m.scenario.assets[1] ?? m.scenario.assets[0], m.scenario.assets.at(-1) ?? m.scenario.assets[0]];
    sim.run(order(a.symbol, 'BUY', 'MARKET', affordable(sim, a.symbol, 0.25)));
    sim.run(order(b.symbol, 'BUY', 'LIMIT', affordable(sim, b.symbol, 0.15), { limitPrice: Math.round(sim.price(b.symbol, 'mid') * 0.98 * 1000) / 1000 }));
    if (sim.held(a.symbol) > 1) {
      sim.run(order(a.symbol, 'SELL', 'STOP', Math.ceil(sim.held(a.symbol) / 2), { stopPrice: Math.round(sim.price(a.symbol, 'bid') * 0.95 * 1000) / 1000 }));
    }
    if (m.scenario.stressScenarios[0]) sim.run({ type: 'RUN_STRESS_TEST', scenarioId: m.scenario.stressScenarios[0].id });
    sim.run({ type: 'ADVANCE' });
    sim.run({ type: 'ADVANCE' });
    if (sim.held(a.symbol) > 1) sim.run(order(a.symbol, 'SELL', 'MARKET', Math.floor(sim.held(a.symbol) / 3), { rationale: 'TAKE_PROFIT' }));
    sim.run(order(c.symbol, 'BUY', 'LIMIT', affordable(sim, c.symbol, 0.1), { limitPrice: Math.round(sim.price(c.symbol, 'ask') * 1.01 * 1000) / 1000 }));
    const resting = sim.state.orders.find((o) => o.status === 'OPEN' && o.type === 'LIMIT');
    if (resting) sim.run({ type: 'CANCEL_ORDER', orderId: resting.id });
    sim.run({ type: 'ADVANCE' });
    for (const p of m.initialPositions) {
      if (sim.held(p.symbol) > 3) sim.run(order(p.symbol, 'SELL', 'MARKET', Math.floor(sim.held(p.symbol) / 4), { rationale: 'REBALANCE' }));
    }
    sim.run({ type: 'REQUEST_HINT' });
  },
  rejections: (sim, m) => {
    const a = m.scenario.assets[0];
    sim.run(order(a.symbol, 'BUY', 'MARKET', 900_000));
    sim.run(order(a.symbol, 'SELL', 'MARKET', sim.held(a.symbol) + 10));
    sim.run(order(a.symbol, 'BUY', 'STOP', 10, { stopPrice: 1 }));
    sim.run(order(a.symbol, 'BUY', 'LIMIT', 10, { limitPrice: sim.price(a.symbol, 'mid') * 3 }));
    sim.run(order('ZZZ', 'BUY', 'MARKET', 1));
    sim.run(order(a.symbol, 'BUY', 'MARKET', Math.max(1, Math.floor(a.depth * 1.5))));
    const cheapest = [...m.scenario.assets].sort((x, y) => x.initialPrice * x.depth - y.initialPrice * y.depth)[0];
    sim.run(order(cheapest.symbol, 'BUY', 'MARKET', cheapest.depth + 5));
    sim.run({ type: 'FINISH' });
    sim.run({ type: 'CANCEL_ORDER', orderId: 'o999' });
    sim.run({ type: 'RUN_STRESS_TEST', scenarioId: 'no-such-scenario' });
    sim.run(order(a.symbol, 'BUY', 'MARKET', 1, { confidence: 101 }));
    sim.run(order(a.symbol, 'BUY', 'MARKET', 2.5));
    sim.run(order(a.symbol, 'BUY', 'MARKET', 0));
    sim.run({ type: 'ADVANCE' }, sim.state.lastCommandSeq + 2);
  },
  allin: (sim, m) => {
    const last = m.scenario.steps;
    const change = (a) => M.quoteAt(sim.ctx.market, last, a.symbol).mid / M.quoteAt(sim.ctx.market, 0, a.symbol).mid;
    const worst = [...m.scenario.assets].sort((x, y) => change(x) - change(y))[0];
    sim.run(order(worst.symbol, 'BUY', 'MARKET', Math.min(worst.depth, affordable(sim, worst.symbol, 0.95)), { rationale: 'FOLLOW_MOMENTUM', confidence: 95 }));
    for (const p of m.initialPositions) sim.run(order(p.symbol, 'BUY', 'MARKET', Math.min(p.quantity, affordable(sim, p.symbol, 0.9)), { rationale: 'FOLLOW_MOMENTUM', confidence: 90 }));
  },
};

function randomCommand(sim, m) {
  const { state } = sim;
  const r = rnd();
  if (r < 0.2) return { type: 'ADVANCE' };
  if (r < 0.23) return { type: 'FINISH' };
  if (r < 0.26) return { type: 'REQUEST_HINT' };
  if (r < 0.31) return { type: 'RUN_STRESS_TEST', scenarioId: rnd() < 0.85 && m.scenario.stressScenarios.length ? pick(m.scenario.stressScenarios).id : 'unknown' };
  if (r < 0.38) return { type: 'CANCEL_ORDER', orderId: state.orders.length && rnd() < 0.9 ? pick(state.orders).id : `o${int(0, 999)}` };
  const symbols = m.scenario.assets.map((a) => a.symbol);
  const symbol = rnd() < 0.04 ? 'ZZZ' : pick(symbols);
  const known = symbols.includes(symbol);
  const held = sim.held(symbol);
  const side = held > 0 && rnd() < 0.45 ? 'SELL' : 'BUY';
  const orderType = pick(['MARKET', 'MARKET', 'LIMIT', 'LIMIT', 'STOP']);
  const ask = known ? sim.price(symbol, 'ask') : 10;
  const bid = known ? sim.price(symbol, 'bid') : 10;
  const mid = known ? sim.price(symbol, 'mid') : 10;
  const q = rnd();
  let quantity;
  if (side === 'SELL') quantity = q < 0.6 ? Math.max(1, Math.floor(held * (0.2 + rnd() * 0.8))) : q < 0.8 ? held : q < 0.9 ? held + int(1, 20) : int(1, 30);
  else quantity = q < 0.65 ? Math.max(1, Math.floor((fromMillimes(state.cash) * (0.05 + rnd() * 0.3)) / ask)) : q < 0.8 ? int(1, 40) : q < 0.9 ? Math.floor((fromMillimes(state.cash) * 1.2) / ask) + 1 : pick([0, 2.5, 1_000_000]);
  const command = { type: 'PLACE_ORDER', symbol, side, orderType, quantity };
  if (orderType === 'LIMIT') {
    const p = rnd();
    command.limitPrice = p < 0.8 ? round3(mid * (1 + (rnd() - 0.5) * 0.06)) : p < 0.9 ? round3(mid * 1.6) : mid * 1.0123457;
  }
  if (orderType === 'STOP') command.stopPrice = round3((side === 'SELL' ? bid : ask) * (0.9 + rnd() * 0.12));
  command.rationale = pick(RATIONALES);
  const c = rnd();
  if (c < 0.8) command.confidence = pick([0, 20, 45, 60, 75, 80, 90, 100]);
  else if (c < 0.83) command.confidence = 55.5;
  return command;
}

function playRandom(sim, m, budget) {
  for (let i = 0; i < budget && sim.state.status === 'ACTIVE'; i++) sim.run(randomCommand(sim, m));
}

const scenarios = [];
function record(name, missionRef, mission, script) {
  const sim = session(mission);
  script(sim, mission);
  sim.finish();
  if (sim.state.status === 'ACTIVE') throw new Error(`${name} did not end`);
  scenarios.push({ name, mission: missionRef, steps: sim.steps, final: finalOf(sim) });
}

// Sessions left open: the in-session mentor in every mode and the state of an unfinished mission.
const openSessions = [];
function recordOpen(name, missionRef, mission, script) {
  const sim = session(mission);
  script(sim, mission);
  openSessions.push({ name, mission: missionRef, steps: sim.steps, final: finalOf(sim) });
}

// ---------------------------------------------------------------- catalog missions
const catalog = {
  validation: validateCatalog(MISSIONS),
  missions: MISSIONS.map((m) => {
    const market = S.createContext(m).market;
    const quotes = [];
    for (let step = 0; step <= m.scenario.steps; step++) {
      quotes.push(m.scenario.assets.map((a) => {
        const q = M.quoteAt(market, step, a.symbol);
        return [q.mid, q.bid, q.ask, q.depth];
      }));
    }
    return {
      slug: m.slug,
      validation: validateMission(m),
      briefing: enc(V.missionBriefing(m)),
      quotes: enc(quotes),
      history: enc(m.scenario.assets.map((a) => M.midSeriesUpTo(market, m.scenario.steps, a.symbol))),
    };
  }),
};

for (const m of MISSIONS) {
  for (const name of Object.keys(scripted)) record(`${m.slug} · ${name}`, m.slug, m, scripted[name]);
  for (let i = 0; i < 3; i++) record(`${m.slug} · random ${i}`, m.slug, m, (sim) => playRandom(sim, m, 45));
  recordOpen(`${m.slug} · open`, m.slug, m, (sim) => playRandom(sim, m, 6));
}

// ---------------------------------------------------------------- fixture missions (engine/testing/fixtures.ts)
const base = testMission();
const testMissions = [
  testMission({}, [shock('s1', 2, 'AAA', -0.3)]),
  testMission({
    slug: 'test-concentration',
    rules: { ...base.rules, maxPositionWeightPct: 30 },
    objectives: [
      { id: 'limit', kind: 'EXECUTE_ORDER', label: 'Limit buy', required: true, side: 'BUY', orderType: 'LIMIT', minCount: 1 },
      { id: 'stop', kind: 'PROTECTIVE_STOP', label: 'Stop', required: false },
      { id: 'dd', kind: 'MAX_DRAWDOWN', label: 'Drawdown', required: true, limitPct: 5 },
      { id: 'loss', kind: 'MAX_LOSS', label: 'Loss', required: false, limitPct: 3 },
      { id: 'weight', kind: 'MAX_POSITION_WEIGHT', label: 'Weight', required: true, limitPct: 40, fromStep: 2 },
      { id: 'assets', kind: 'MIN_ASSETS_HELD', label: 'Assets', required: true, count: 2 },
      { id: 'invested', kind: 'MIN_INVESTED', label: 'Invested', required: false, pct: 50 },
      { id: 'stress', kind: 'RUN_STRESS_TEST', label: 'Stress', required: true, beforeStep: 3 },
      { id: 'react', kind: 'REACT_TO_EVENT', label: 'React', required: true, eventId: 'dn', withinSteps: 1 },
      { id: 'trades', kind: 'MAX_TRADES', label: 'Trades', required: false, count: 4 },
    ],
    scoring: { ...base.scoring, concentrationLimitPct: 35 },
  }, [shock('up', 1, 'BBB', 0.1), shock('dn', 3, 'AAA', -0.15)]),
  testMission({
    slug: 'test-confidence',
    rules: { ...base.rules, requireConfidence: true },
    scenario: { ...base.scenario, steps: 8, historySteps: 3, assets: base.scenario.assets.map((a) => ({ ...a, volPerStep: 0.02, driftPerStep: 0.001, beta: 0.5 })) },
  }, []),
  testMission({
    slug: 'test-market-only',
    rules: { allowedOrderTypes: ['MARKET'], feeBps: 25, minFee: 0.5, allowStressTest: false },
    initialPositions: [{ symbol: 'AAA', quantity: 200 }],
    initialCash: 2_000,
    failure: [{ kind: 'MAX_LOSS', limitPct: 4 }],
  }, [shock('drop', 2, 'AAA', -0.08)]),
];
const regimeBase = testMission({ slug: 'test-regime' });
testMissions.push({
  ...regimeBase,
  scenario: {
    ...regimeBase.scenario,
    steps: 10,
    historySteps: 4,
    seed: 7,
    assets: regimeBase.scenario.assets.map((a, i) => ({ ...a, volPerStep: 0.015 + i * 0.01, driftPerStep: -0.002, beta: 0.8 })),
    events: [
      { id: 'rumour', step: 2, kind: 'NEWS', sentiment: 'NEGATIVE', headline: 'Rumour', body: 'Fixture', unconfirmed: true, shocks: [{ symbol: '*', move: -0.05 }] },
      { id: 'liquidity', step: 4, kind: 'LIQUIDITY', sentiment: 'NEGATIVE', headline: 'Thin books', body: 'Fixture', shocks: [], regime: { steps: 3, volMultiplier: 2.5, spreadMultiplier: 3, depthMultiplier: 0.2, symbols: ['AAA'] } },
      { id: 'rally', step: 7, kind: 'EARNINGS', sentiment: 'POSITIVE', headline: 'Rally', body: 'Fixture', shocks: [{ symbol: 'BBB', move: 0.12 }], regime: { steps: 2, driftShiftPerStep: 0.01 } },
    ],
  },
});

const fixtureScripts = {
  scripted: (sim, m) => {
    sim.run(order('AAA', 'BUY', 'MARKET', 150, { confidence: m.rules.requireConfidence ? 70 : 60 }));
    sim.run(order('BBB', 'BUY', 'LIMIT', 20, { limitPrice: 49.9 }));
    sim.run(order('AAA', 'SELL', 'STOP', 50, { stopPrice: 9.5 }));
    sim.run({ type: 'RUN_STRESS_TEST', scenarioId: 'crash' });
    sim.run({ type: 'BOGUS' });
    sim.run(order('BBB', 'BUY', 'MARKET', 10, { rationale: 'REACT_TO_NEWS' }));
    sim.run({ type: 'ADVANCE' });
    sim.run(order('BBB', 'SELL', 'LIMIT', 5, { limitPrice: 50.5, rationale: 'TAKE_PROFIT', confidence: 85 }));
    sim.run({ type: 'ADVANCE' });
    sim.run({ type: 'REQUEST_HINT' });
    sim.run({ type: 'ADVANCE' });
    sim.run(order('AAA', 'SELL', 'MARKET', 10, { rationale: 'DIVERSIFY' }));
  },
};
testMissions.forEach((m, index) => {
  record(`fixture ${m.slug} · scripted`, { test: index }, m, fixtureScripts.scripted);
  for (let i = 0; i < 3; i++) record(`fixture ${m.slug} · random ${i}`, { test: index }, m, (sim) => playRandom(sim, m, 30));
  recordOpen(`fixture ${m.slug} · open`, { test: index }, m, (sim) => playRandom(sim, m, 4));
});

// ---------------------------------------------------------------- mastery and recommendations
const COMPETENCIES = ['MARKET_UNDERSTANDING', 'TRADING_EXECUTION', 'RISK_MANAGEMENT', 'DIVERSIFICATION', 'STRATEGIC_REASONING'];
const mastery = [];
mastery.push({ observations: [], result: enc(computeMastery([])) });
for (let n = 0; n < 40; n++) {
  const observations = [];
  const count = int(1, 14);
  for (let i = 0; i < count; i++) {
    observations.push({
      competency: pick(COMPETENCIES),
      score: pick([0, 100, int(0, 100), Math.round(rnd() * 1000) / 10, rnd() * 100]),
      weight: pick([1, 0.3, 0.6, 0.5, 0.8, 0.25]),
      assisted: rnd() < 0.3,
      at: 1_700_000_000_000 + int(0, 8) * 60_000,
    });
  }
  mastery.push({ observations: enc(observations), result: enc(computeMastery(observations)) });
}

const recommendations = [];
const EXPERIENCE = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
for (let n = 0; n < 40; n++) {
  const progress = new Map();
  for (const m of MISSIONS) {
    if (rnd() < (n < 10 ? 0.9 : 0.5)) {
      const attempts = int(1, 4);
      const passed = rnd() < (n < 10 ? 0.95 : 0.5);
      progress.set(m.slug, { slug: m.slug, attempts, passed, bestScore: rnd() < 0.1 ? null : Math.round(rnd() * 1000) / 10 });
    }
  }
  const observations = [];
  for (let i = int(0, 10); i > 0; i--) {
    observations.push({ competency: pick(COMPETENCIES), score: Math.round(rnd() * 1000) / 10, weight: pick([1, 0.3]), assisted: rnd() < 0.2, at: 1_700_000_000_000 + i * 1000 });
  }
  const masteryResult = computeMastery(observations);
  const experience = pick(EXPERIENCE);
  const limit = pick([3, 3, 1, 5]);
  recommendations.push({
    experience,
    limit: num(limit),
    progress: enc([...progress.values()]),
    observations: enc(observations),
    unlocked: unlockedLevel(MISSIONS, progress, experience),
    result: enc(recommend(MISSIONS, progress, masteryResult, experience, limit)),
  });
}

// ---------------------------------------------------------------- FinStories
const NOW = new Date('2026-11-11T10:00:00.000Z');
const EARLIER = new Date('2026-10-01T08:30:00.000Z');
const edits = (story) => [
  story,
  { ...story, version: story.version + 1, scenes: [{ ...story.scenes[0], durationMs: story.scenes[0].durationMs + 2000 }, ...story.scenes.slice(1)] },
  { ...story, version: story.version + 1, scenes: story.scenes.slice(1) },
];
const stories = { stories: enc(STORIES), cases: [] };
for (const story of STORIES) {
  for (const [variant, edited] of edits(story).entries()) {
    const duration = storyDuration(edited);
    const starts = [];
    let t = 0;
    for (const s of edited.scenes) {
      starts.push(t);
      t += s.durationMs;
    }
    const positions = [0, 1, ...starts.flatMap((s) => [s - 1, s, s + 1]).filter((p) => p >= 0), duration - 1, duration, duration + 5000, Math.floor(duration * 0.95), Math.ceil(duration * 0.95) - 1];
    const sceneAt = positions.map((p) => [num(p), P.sceneIdAt(edited, p)]);
    const sceneStart = [...story.scenes.map((s) => s.id), 'missing', ''].map((id) => [id, enc(P.sceneStartMs(edited, id))]);
    const rows = [null];
    for (let i = 0; i < 12; i++) {
      const completed = rnd() < 0.4;
      rows.push({
        storyVersion: pick([1, 2, 3]),
        positionMs: int(0, duration + 3000),
        sceneId: pick([...story.scenes.map((s) => s.id), null, 'gone']),
        completed,
        completedAt: completed && rnd() < 0.85 ? EARLIER : null,
        completedVersion: pick([null, null, 1, 2]),
        reflection: pick([null, 'WOULD_CHOOSE_A', 'WOULD_CHOOSE_B', 'UNSURE']),
      });
    }
    const updates = [];
    for (let i = 0; i < 6; i++) {
      const update = { positionMs: pick([0, int(0, duration), duration, duration + 100, Math.floor(duration * 0.95), 3_600_000]) };
      const c = rnd();
      if (c < 0.3) update.completed = true;
      else if (c < 0.5) update.completed = false;
      const r = rnd();
      if (r < 0.3) update.reflection = pick(['WOULD_CHOOSE_A', 'WOULD_CHOOSE_B', 'UNSURE']);
      else if (r < 0.45) update.reflection = null;
      updates.push(update);
    }
    const progress = rows.map((row) => ({
      row: enc(row),
      view: enc(P.progressView(edited, row)),
      next: updates.map((update) => ({ update: enc(update), result: enc(P.nextProgress(edited, row, update, NOW)) })),
    }));
    stories.cases.push({ slug: story.slug, variant: num(variant), duration: num(duration), sceneAt, sceneStart, progress });
  }
}

// ---------------------------------------------------------------- output
const fixture = {
  meta: {
    generator: 'apps/api-spring/contract/generate-learning-fixtures.mjs',
    sources: sourceHashes,
    now: NOW.toISOString(),
    earlier: EARLIER.toISOString(),
  },
  catalog,
  testMissions: enc(testMissions),
  scenarios,
  openSessions,
  mastery,
  recommendations,
  stories,
};
const target = resolve(here, '../src/test/resources/fixtures/learning-golden.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(fixture)}\n`);
if (tempDir) rmSync(tempDir, { recursive: true, force: true });
const commandCount = [...scenarios, ...openSessions].reduce((s, x) => s + x.steps.length, 0);
console.log(`wrote ${target}`);
console.log(`scenarios ${scenarios.length}, open sessions ${openSessions.length}, commands ${commandCount}, mastery ${mastery.length}, recommendations ${recommendations.length}, story cases ${stories.cases.length}`);
