// Generates golden fixtures for com.pif.api.market and com.pif.api.trading by running the real TypeScript code
// (apps/api/src/market-data, apps/api/src/trading/{engine,rules,analytics}.ts and the finance core they import)
// over deterministic inputs.
//
// Usage (from the repository root; no build step and no extra package needed):
//   node apps/api-spring/contract/generate-trading-fixtures.mjs
//
// The sources are transpiled with the TypeScript compiler in apps/api/node_modules into a temporary directory
// outside the repository (same layout, so relative imports resolve), loaded with require(), then deleted.
// Encoding as in generate-finance-fixtures.mjs: every number is its Number.prototype.toString() text, dates are
// toISOString() text, Record outputs are [key, value] pairs in JS property order.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../api');
const srcDir = join(apiDir, 'src');
const ts = createRequire(join(apiDir, 'package.json'))('typescript');

const tsconfig = ts.readConfigFile(join(apiDir, 'tsconfig.json'), ts.sys.readFile);
const { options } = ts.convertCompilerOptionsFromJson(tsconfig.config.compilerOptions, apiDir);
const compilerOptions = { ...options, sourceMap: false, declaration: false, incremental: false, outDir: undefined };

const FILES = [
  'finance/execution.ts', 'finance/index.ts', 'finance/ledger.ts', 'finance/money.ts', 'finance/orders.ts',
  'finance/performance.ts', 'finance/pretrade.ts', 'finance/risk.ts', 'finance/valuation.ts',
  'market-data/rng.ts', 'market-data/fictional-universe.ts', 'market-data/provider.ts', 'market-data/clock.ts',
  'market-data/simulated-provider.ts', 'trading/rules.ts', 'trading/engine.ts', 'trading/analytics.ts',
];
const jsDir = mkdtempSync(join(tmpdir(), 'pif-trading-ts-'));
const sourceHashes = {};
for (const file of FILES) {
  let text;
  try {
    text = readFileSync(join(srcDir, file), 'utf8');
  } catch {
    continue;
  }
  sourceHashes[file] = createHash('sha256').update(text).digest('hex');
  const { outputText, diagnostics } = ts.transpileModule(text, { compilerOptions, fileName: file, reportDiagnostics: true });
  if (diagnostics?.length) throw new Error(`${file}: ${diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`);
  mkdirSync(join(jsDir, dirname(file)), { recursive: true });
  writeFileSync(join(jsDir, file.replace(/\.ts$/, '.js')), outputText);
}
writeFileSync(join(jsDir, 'package.json'), '{ "type": "commonjs" }\n');
const req = createRequire(join(jsDir, 'index.js'));
const RNG = req('./market-data/rng.js');
const { FICTIONAL_UNIVERSE } = req('./market-data/fictional-universe.js');
const { SimulatedMarketProvider, SIMULATION_EPOCH, BUCKET_MS } = req('./market-data/simulated-provider.js');
const E = req('./trading/engine.js');
const R = req('./trading/rules.js');
const A = req('./trading/analytics.js');

// ---------------------------------------------------------------- encoding
const num = (x) => (Object.is(x, -0) ? '-0' : String(x));
function enc(v) {
  if (typeof v === 'number') return num(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
}

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
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const DAY = 86_400_000;
const EPOCH = SIMULATION_EPOCH.getTime();
const provider = new SimulatedMarketProvider();
const SYMBOLS = Object.keys(FICTIONAL_UNIVERSE);

// ---------------------------------------------------------------- market data
const market = { seeds: [], rng: [], closes: {}, intraday: [], calls: [] };
for (const text of ['', 'a', 'pif-sim-v1:factor:0', 'pif-sim-v1:CTB:day:313', 'pif-sim-v1:GOV:intraday:419', 'é€😀\u0000', 'x'.repeat(300)]) {
  market.seeds.push([text, num(RNG.seedFromString(text))]);
}
for (const seed of [0, 1, 4294967295, 2166136261, 123456789, RNG.seedFromString('pif-sim-v1:TEK:day:42')]) {
  const u = RNG.createRng(seed);
  const n = RNG.createRng(seed);
  market.rng.push({ seed: num(seed), uniform: Array.from({ length: 16 }, () => num(u.uniform())), normal: Array.from({ length: 17 }, () => num(n.normal())) });
}
const LAST_DAY = 420;
for (const symbol of SYMBOLS) {
  market.closes[symbol] = provider.dailyCloses(symbol, SIMULATION_EPOCH, new Date(EPOCH + LAST_DAY * DAY)).map((p) => num(p.mid));
}
for (const symbol of SYMBOLS) {
  for (const day of [0, 1, 2, 100, 313, 314, 315, LAST_DAY - 1]) {
    const quotes = [];
    for (let j = 0; j < 288; j++) {
      const q = provider.quoteAtBucket(symbol, day * 288 + j);
      quotes.push([num(q.mid), num(q.bid), num(q.ask)]);
    }
    market.intraday.push({ symbol, day, depth: num(FICTIONAL_UNIVERSE[symbol].depth), quotes });
  }
}
const quoteOut = (q) => (q === null ? null : { symbol: q.symbol, asOf: q.asOf.toISOString(), mid: num(q.mid), bid: num(q.bid), ask: num(q.ask), depth: num(q.depth) });
const pointOut = (p) => ({ at: p.at.toISOString(), mid: num(p.mid) });
for (let i = 0; i < 160; i++) {
  const symbol = pick(SYMBOLS);
  const a = EPOCH + int(-2, 400) * DAY + int(0, DAY - 1);
  const b = a + pick([0, 1, BUCKET_MS - 1, BUCKET_MS, int(1, 3) * DAY, int(0, 40) * DAY + int(0, DAY)]);
  const kind = pick(['quote', 'quotesBetween', 'dailyCloses', 'intraday1', 'intraday6']);
  let output;
  if (kind === 'quote') output = quoteOut(provider.quote(symbol, new Date(a)));
  else if (kind === 'quotesBetween') output = provider.quotesBetween(symbol, new Date(a), new Date(Math.min(b, a + 3 * DAY))).map(quoteOut);
  else if (kind === 'dailyCloses') output = provider.dailyCloses(symbol, new Date(a), new Date(b)).map(pointOut);
  else output = provider.intraday(symbol, new Date(a), new Date(Math.min(b, a + 5 * DAY)), kind === 'intraday1' ? 1 : 6).map(pointOut);
  market.calls.push({ kind, symbol, from: new Date(a).toISOString(), to: new Date(b).toISOString(), output });
}

// ---------------------------------------------------------------- engine scenarios
const termsFor = (symbol, status, lotSize) => {
  const assetClass = symbol === 'GOV' ? 'FUND' : 'EQUITY';
  return { symbol, assetClass, sector: FICTIONAL_UNIVERSE[symbol].sector, status, lotSize, fees: R.FEE_SCHEDULES[assetClass] };
};
const orderOut = (o) => ({
  id: o.id, symbol: o.symbol, side: o.side, type: o.type, quantity: num(o.quantity), filledQuantity: num(o.filledQuantity),
  filledValue: num(o.filledValue), limitPrice: o.limitPrice === null ? null : num(o.limitPrice), stopPrice: o.stopPrice === null ? null : num(o.stopPrice),
  triggered: o.triggered, status: o.status, statusReason: o.statusReason, submittedAt: o.submittedAt.toISOString(),
  expiresAt: o.expiresAt?.toISOString() ?? null, closedAt: o.closedAt?.toISOString() ?? null, changed: o.changed,
  averagePrice: E.averagePrice(o) === null ? null : num(E.averagePrice(o)),
});
const ledgerOut = (l) => ({
  cash: num(l.cash), positions: Object.entries(l.positions).map(([k, h]) => [k, num(h.quantity), num(h.costBasis)]),
  realizedPnl: num(l.realizedPnl), feesPaid: num(l.feesPaid), spreadCostPaid: num(l.spreadCostPaid),
});
const fillOut = (f) => ({
  orderId: f.orderId, symbol: f.symbol, side: f.side, quantity: num(f.quantity), price: num(f.price), notional: num(f.notional), fee: num(f.fee),
  spreadCost: num(f.spreadCost), realizedPnl: num(f.realizedPnl), quote: quoteOut(f.quote), cashAfter: num(f.cashAfter),
});
const evalOut = (e) => ({
  rejection: e.rejection, referencePrice: num(e.referencePrice), estimate: enc(e.estimate), executesNow: e.executesNow,
  fillableNow: num(e.fillableNow), availableCash: num(e.availableCash), held: num(e.held), equity: num(e.equity), warnings: e.warnings,
});

function randomRequest(book, quoteOf) {
  const held = Object.keys(book.ledger.positions);
  const symbol = held.length && rnd() < 0.45 ? pick(held) : pick(SYMBOLS);
  const q = quoteOf(symbol);
  const side = rnd() < 0.55 ? 'BUY' : 'SELL';
  const type = pick(['MARKET', 'MARKET', 'LIMIT', 'LIMIT', 'STOP']);
  let quantity = pick([int(1, 50), int(1, 400), int(1, 2500), int(1, 20) * 10]);
  if (rnd() < 0.06) quantity = pick([0, 1.5, 2_000_000, -3]);
  let limitPrice = null;
  let stopPrice = null;
  if (type === 'LIMIT' && rnd() > 0.04) {
    const r = rnd();
    limitPrice = r < 0.1 ? Math.round(q.mid * pick([0.3, 1.8])) : r < 0.45 ? (side === 'BUY' ? q.ask + int(0, 200) : q.bid - int(0, 200)) : q.mid + int(-Math.floor(q.mid * 0.04), Math.floor(q.mid * 0.04));
    limitPrice = Math.max(1, limitPrice);
  }
  if (type === 'STOP' && rnd() > 0.04) stopPrice = Math.max(1, rnd() < 0.15 ? q.bid + int(0, 50) : q.bid - int(1, Math.max(2, Math.floor(q.bid * 0.03))));
  return { symbol, side, type, quantity, limitPrice, stopPrice };
}

const engine = [];
for (let s = 0; s < 90; s++) {
  const halted = new Set(SYMBOLS.filter(() => rnd() < 0.06));
  const lots = Object.fromEntries(SYMBOLS.map((sym) => [sym, rnd() < 0.15 ? 10 : 1]));
  const termsOf = (sym) => termsFor(sym, halted.has(sym) ? 'HALTED' : 'ACTIVE', lots[sym]);
  const positions = {};
  const initialPositions = [];
  for (const sym of SYMBOLS) {
    if (rnd() < 0.35) {
      const quantity = int(1, 3000);
      const costBasis = quantity * int(5_000, 120_000) + int(0, 999);
      positions[sym] = { symbol: sym, quantity, costBasis };
      initialPositions.push([sym, num(quantity), num(costBasis)]);
    }
  }
  const cash = pick([int(0, 50_000), int(1_000_000, 100_000_000), int(100_000_000, 2_000_000_000)]);
  const maxPositionWeightPct = pick([10, 25, 50, 100]);
  const book = { ledger: { cash, positions, realizedPnl: 0, feesPaid: 0, spreadCostPaid: 0 }, orders: [], maxPositionWeightPct };
  let now = EPOCH + int(5, 400) * DAY + int(0, DAY - 1);
  let matchedThrough = now;
  let nextId = 1;
  const steps = [];
  // Every 15th scenario fills the book with resting limit buys until the open-order cap refuses one.
  const crowded = s % 15 === 0;
  for (let k = 0; k < (crowded ? 56 : 28); k++) {
    now += rnd() < 0.08 ? int(1, 35) * DAY : int(0, 40) * BUCKET_MS + int(0, BUCKET_MS - 1);
    const at = new Date(now);
    const quoteOf = (sym) => ({ ...provider.quote(sym, at), symbol: sym });
    const working = book.orders.filter((o) => E.isWorking(o.status));
    let op = crowded ? 'submit' : pick(['submit', 'submit', 'submit', 'match', 'match', 'cancel']);
    if (op === 'cancel' && working.length === 0) op = 'submit';    const step = { op, now: at.toISOString() };
    if (op === 'match') {
      const periods = new Map();
      for (const sym of new Set(working.map((o) => o.symbol))) {
        for (const q of provider.quotesBetween(sym, new Date(matchedThrough), at)) {
          let period = periods.get(q.asOf.getTime());
          if (!period) periods.set(q.asOf.getTime(), (period = { asOf: q.asOf, quotes: new Map() }));
          period.quotes.set(sym, { ...q, symbol: sym });
        }
      }
      step.matchedThrough = new Date(matchedThrough).toISOString();
      const fills = E.matchWorkingOrders(book, [...periods.values()].sort((a, b) => a.asOf.getTime() - b.asOf.getTime()), termsOf);
      step.fills = fills.map(fillOut);
      step.executedAt = fills.map((f) => E.executedAt(f, book.orders.find((o) => o.id === f.orderId)).toISOString());
      matchedThrough = now;
    } else if (op === 'cancel') {
      const order = pick(working);
      step.orderId = order.id;
      E.cancelWorkingOrder(order, at);
    } else {
      const request = crowded
        ? { symbol: 'GOV', side: 'BUY', type: 'LIMIT', quantity: 1, limitPrice: Math.ceil(quoteOf('GOV').mid * 0.6), stopPrice: null }
        : randomRequest(book, quoteOf);
      const quote = quoteOf(request.symbol);
      const depthUsed = rnd() < 0.7 ? 0 : int(0, quote.depth + 50);
      step.request = { ...enc(request) };
      step.depthUsed = num(depthUsed);
      const evaluation = E.evaluateOrder(book, request, termsOf(request.symbol), quote, { termsOf, midOf: (sym) => quoteOf(sym).mid, depthUsed });
      step.evaluation = evalOut(evaluation);
      if (!evaluation.rejection) {
        const order = { id: `o${nextId++}`, ...request, filledQuantity: 0, filledValue: 0, triggered: false, status: 'OPEN', statusReason: null, submittedAt: at, expiresAt: null, closedAt: null, changed: true };
        step.orderId = order.id;
        const fills = E.placeOrder(book, order, termsOf(request.symbol), quote, new Map([[`${request.symbol}:${request.side}`, depthUsed]]), at);
        step.fills = fills.map(fillOut);
        step.executedAt = fills.map((f) => E.executedAt(f, order).toISOString());
      }
    }
    step.ledger = ledgerOut(book.ledger);
    step.orders = book.orders.map(orderOut);
    step.availableCash = num(E.availableCash(book, termsOf));
    step.equity = num(E.bookEquity(book, (sym) => quoteOf(sym).mid));
    for (const o of book.orders) o.changed = false;
    steps.push(step);
  }
  engine.push({
    halted: [...halted], lots: Object.entries(lots).map(([k, v]) => [k, num(v)]), cash: num(cash), positions: initialPositions,
    maxPositionWeightPct: num(maxPositionWeightPct), start: steps[0]?.now, steps,
  });
}

// ---------------------------------------------------------------- analytics
const dt = (amount) => amount / 1000;
const analytics = { reconstruct: [], dietz: [], portfolio: [] };
for (let i = 0; i < 40; i++) {
  const createdAt = EPOCH + int(1, 380) * DAY + int(0, DAY - 1);
  const now = createdAt + pick([0, int(1, DAY), int(1, 40) * DAY + int(0, DAY)]);
  const initialCapital = int(1_000, 1_000_000) * 1000;
  const cashEntries = [{ type: 'DEPOSIT', amount: initialCapital, balanceAfter: initialCapital, occurredAt: new Date(createdAt) }];
  const executions = [];
  let cash = initialCapital;
  const n = int(0, 25);
  for (let k = 0; k < n; k++) {
    const occurredAt = new Date(createdAt + int(0, now - createdAt));
    const type = pick(['DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL']);
    const amount = type === 'DEPOSIT' || type === 'SELL' ? int(1, 5_000_000) : -int(1, 5_000_000);
    cash += amount;
    cashEntries.push({ type, amount, balanceAfter: cash, occurredAt });
    if (type === 'BUY' || type === 'SELL') executions.push({ symbol: pick(SYMBOLS), side: type, quantity: int(1, 300), executedAt: occurredAt });
  }
  const points = A.reconstructDailyEquity({ createdAt: new Date(createdAt), now: new Date(now), initialCapital, cashEntries, executions, closeOf: (sym, at) => provider.quote(sym, at)?.mid ?? 0 });
  analytics.reconstruct.push({
    createdAt: new Date(createdAt).toISOString(), now: new Date(now).toISOString(), initialCapital: num(initialCapital),
    cashEntries: cashEntries.map(enc), executions: executions.map(enc), points: points.map(enc), returns: A.periodReturns(points).map(num),
  });
}
for (let i = 0; i < 40; i++) {
  const start = EPOCH + int(0, 300) * DAY + int(0, DAY);
  const end = start + pick([0, -5, int(1, 90) * DAY + int(0, DAY)]);
  const flows = Array.from({ length: int(0, 6) }, (_, k) => ({ amount: k === 0 ? int(1, 1e9) : pick([1, -1]) * int(1, 1e8), at: new Date(start + int(0, Math.max(0, end - start))) }));
  const endValue = int(0, 2e9);
  analytics.dietz.push({ flows: flows.map(enc), start: new Date(start).toISOString(), end: new Date(end).toISOString(), endValue: num(endValue), output: enc(A.modifiedDietz(flows, new Date(start), new Date(end), endValue)) });
}
for (let i = 0; i < 70; i++) {
  const createdAt = EPOCH + int(1, 300) * DAY + int(0, DAY - 1);
  const now = createdAt + pick([int(1, DAY), int(1, 200) * DAY + int(0, DAY)]);
  const chosen = SYMBOLS.filter(() => rnd() < (i % 9 === 0 ? 0 : 0.45));
  const holdings = chosen.map((sym) => {
    const q = provider.quote(sym, new Date(now));
    const assetClass = sym === 'GOV' ? 'FUND' : 'EQUITY';
    const quantity = int(1, 4000);
    return { symbol: sym, name: FICTIONAL_UNIVERSE[sym].name, assetClass, sector: FICTIONAL_UNIVERSE[sym].sector, quantity, costBasis: quantity * int(5_000, 120_000), mid: q.mid, bid: q.bid, fees: R.FEE_SCHEDULES[assetClass] };
  });
  const cash = pick([int(0, 1e9), -int(1, 1e7), 0]);
  const reserved = pick([0, int(0, Math.max(0, cash))]);
  const netContributions = int(1e6, 2e9);
  const flowPoints = Array.from({ length: int(1, 6) }, (_, k) => ({ equity: k === 0 ? 0 : int(-1e6, 2e9), flowAfter: k === 0 ? netContributions : pick([1, -1]) * int(1, 5e8), at: new Date(createdAt + k * int(0, DAY)) }));
  const dailyEquity = [];
  let eq = netContributions;
  const historyLength = pick([0, 1, 4, 5, 6, 12, 60]);
  for (let d = 0; d < historyLength; d++) {
    eq = Math.max(pick([0, 1, 1, 1, 1]) * 1, Math.round(eq * (1 + gauss() * 0.02)));
    dailyEquity.push({ at: new Date(createdAt + d * DAY), equity: eq, flows: rnd() < 0.2 ? int(-1e6, 1e6) : 0, netContributions: netContributions + int(-1e6, 1e6) });
  }
  const instrumentReturns = {};
  for (const h of holdings) {
    const closes = provider.dailyCloses(h.symbol, new Date(now - pick([10, 31, 40, 251]) * DAY), new Date(now)).map((c) => c.mid);
    instrumentReturns[h.symbol] = closes.slice(1).map((c, k) => c / closes[k] - 1);
  }
  const input = { now: new Date(now), createdAt: new Date(createdAt), cash, reserved, netContributions, realizedPnl: int(-1e7, 1e7), feesPaid: int(0, 1e6), spreadCost: int(0, 1e6), holdings, flowPoints, dailyEquity, instrumentReturns, cashLedgerSum: rnd() < 0.8 ? cash : cash + 1, scenarios: R.STRESS_SCENARIOS, money: dt };
  const output = A.portfolioAnalytics(input);
  analytics.portfolio.push({
    input: {
      ...enc({ ...input, scenarios: undefined, money: undefined, instrumentReturns: undefined, holdings: holdings.map(({ fees, ...h }) => h) }),
      instrumentReturns: Object.entries(instrumentReturns).map(([k, v]) => [k, v.map(num)]),
    },
    output: enc(output),
  });
}

rmSync(jsDir, { recursive: true, force: true });
const fixture = { generatedBy: 'apps/api-spring/contract/generate-trading-fixtures.mjs', sources: sourceHashes, market, engine, analytics };
const target = resolve(here, '../src/test/resources/fixtures/trading-golden.json');
writeFileSync(target, JSON.stringify(fixture));
const steps = engine.reduce((s, e) => s + e.steps.length, 0);
console.log(`wrote ${target}: ${market.seeds.length} seeds, ${market.rng.length} rng streams, ${SYMBOLS.length}×${LAST_DAY} closes, ${market.intraday.length} intraday days, ${market.calls.length} provider calls, ${engine.length} engine scenarios (${steps} steps), ${analytics.reconstruct.length + analytics.dietz.length + analytics.portfolio.length} analytics cases`);
