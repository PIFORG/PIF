// Generates golden fixtures for com.pif.api.finance by running the real TypeScript financial core
// (apps/api/src/finance/*.ts) over a deterministic set of inputs.
//
// Usage (from the repository root; no build step and no extra package needed):
//   node apps/api-spring/contract/generate-finance-fixtures.mjs
//
// Each finance/*.ts file (specs excluded) is transpiled with the TypeScript compiler installed in
// apps/api/node_modules (ts.transpileModule with the compiler options of apps/api/tsconfig.json)
// into a temporary directory outside the repository, loaded with require(), then deleted.
//
// Encoding: every JS number is written as its Number.prototype.toString() text ("-0", "NaN" and
// "Infinity" included), which parses back to the identical double in Java. Record<string, …>
// inputs are [key, value] pairs in insertion order; Record outputs are [key, value] pairs in JS
// property order (Object.entries). Thrown errors are recorded as { type, message, code? }.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../api');
const financeDir = join(apiDir, 'src/finance');
const ts = createRequire(join(apiDir, 'package.json'))('typescript');

// ---------------------------------------------------------------- transpile the real sources
const tsconfig = ts.readConfigFile(join(apiDir, 'tsconfig.json'), ts.sys.readFile);
if (tsconfig.error) throw new Error(ts.flattenDiagnosticMessageText(tsconfig.error.messageText, '\n'));
const { options } = ts.convertCompilerOptionsFromJson(tsconfig.config.compilerOptions, apiDir);
const compilerOptions = { ...options, sourceMap: false, declaration: false, incremental: false, outDir: undefined };

const jsDir = mkdtempSync(join(tmpdir(), 'pif-finance-ts-'));
const sources = readdirSync(financeDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).sort();
const sourceHashes = {};
for (const file of sources) {
  const text = readFileSync(join(financeDir, file), 'utf8');
  sourceHashes[file] = createHash('sha256').update(text).digest('hex');
  const { outputText, diagnostics } = ts.transpileModule(text, { compilerOptions, fileName: file, reportDiagnostics: true });
  if (diagnostics?.length) throw new Error(`${file}: ${diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`);
  writeFileSync(join(jsDir, file.replace(/\.ts$/, '.js')), outputText);
}
writeFileSync(join(jsDir, 'package.json'), '{ "type": "commonjs" }\n');
const F = createRequire(join(jsDir, 'index.js'))('./index.js');

// ---------------------------------------------------------------- encoding helpers
const num = (x) => (Object.is(x, -0) ? '-0' : String(x));
function enc(v) {
  if (typeof v === 'number') return num(v);
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
}
/** Builds a Record the way services do (plain assignment, in the given order). */
function record(pairs) {
  const o = {};
  for (const [k, v] of pairs) o[k] = v;
  return o;
}
const holdings = (pairs) => record(pairs.map(([k, h]) => [k, { ...h }]));
const errorOf = (e) => ({ type: e.name, message: e.message, ...(e.code !== undefined ? { code: e.code } : {}) });

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261110);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const times = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const golden = {};
/** Records one case: `input` is written before `run` executes; `run` returns the encoded output. */
function add(fn, input, run, note) {
  const entry = { input: enc(input) };
  if (note) entry.note = note;
  try {
    entry.output = run();
  } catch (e) {
    entry.error = errorOf(e);
  }
  (golden[fn] ??= []).push(entry);
}
const SPEC = 'finance.spec.ts';
const ORDERS_SPEC = 'orders.spec.ts';

// ---------------------------------------------------------------- money
{
  const values = [
    [0.1 + 0.2, SPEC], [12.3456, SPEC], [NaN, SPEC], [Infinity], [-Infinity], [0], [-0], [1], [-1],
    [0.0005], [-0.0005], [0.0015], [-0.0015], [0.0025], [-0.0025], [1.0005], [2.0005], [-2.0005], [1.005], [4.35],
    [8.0345], [123.4565], [0.00049999999999999994], [-0.00049999999999999994], [4503599627370.497], [4503599627370.4965],
    [9007199254740.993], [1e15], [-1e15], [1e300], [1.7976931348623157e308], [-1.7976931348623157e308], [5e-324], [-5e-324],
    [42.5], [18.2], [9.85], [40.1234], [0.001], [-0.001], [999999.9995], [8457.5],
  ];
  for (const [v, note] of values) add('toAmount', { value: v }, () => num(F.toAmount(v)), note);
  for (let i = 0; i < 300; i++) {
    const text = `${pick(['', '-'])}${int(0, 999_999)}.${String(int(0, 9999)).padStart(4, '0').slice(0, 3)}${pick(['5', '5', String(int(0, 9))])}`;
    const v = Number(text);
    add('toAmount', { value: v }, () => num(F.toAmount(v)));
  }

  const amounts = [[8_457_500, SPEC], [0], [-0], [1], [-1], [5], [999], [123_456_789], [2 ** 53], [2 ** 53 + 2], [-(2 ** 53)], [1e21], [NaN], [Infinity], [-Infinity], [0.5]];
  for (const [a, note] of amounts) add('fromAmount', { amount: a }, () => num(F.fromAmount(a)), note);
  for (let i = 0; i < 100; i++) {
    const a = int(-1e9, 1e9) * pick([1, 1, 1000, 1e6]);
    add('fromAmount', { amount: a }, () => num(F.fromAmount(a)));
  }

  const notionals = [[10_010, 50], [12_010, 25], [11_990, 30], [0, 10], [10, 0], [-10, 3], [10, -3], [-0, 5], [2 ** 30 + 1, 2 ** 30 + 3], [9_007_199_254_740_991, 3], [10.5, 3], [NaN, 1], [Infinity, 0], [1e308, 10]];
  for (const [p, q] of notionals) add('notional', { price: p, quantity: q }, () => num(F.notional(p, q)));
  for (let i = 0; i < 80; i++) {
    const p = int(1, 500_000);
    const q = int(0, 100_000);
    add('notional', { price: p, quantity: q }, () => num(F.notional(p, q)));
  }

  const divs = [
    [5, 2, SPEC], [-5, 2, SPEC], [4, 3, SPEC], [1, 0, SPEC], [0, 5], [-0, 5], [1, -0], [0, 0], [7, -2], [-7, -2], [7, 2], [-7, 2], [1, 3], [2, 3], [-1, 3], [-2, 3],
    [4_503_599_627_370_497, 1], [4_503_599_627_370_495, 2], [9_007_199_254_740_993, 2], [1, 2 ** 60], [-1, 2 ** 60],
    [NaN, 1], [1, NaN], [Infinity, 1], [-Infinity, 1], [1, Infinity], [-1, Infinity], [Infinity, Infinity], [0.49999999999999994, 1], [-0.49999999999999994, 1],
    [802_750 * 30, 75], [481_650 * 45, 45], [25_005_000, 10_000],
  ];
  for (const [n, d, note] of divs) add('divRound', { numerator: n, denominator: d }, () => num(F.divRound(n, d)), note);
  for (let i = 0; i < 150; i++) {
    const d = pick([2, 3, 4, 7, 10, 10_000, int(1, 1_000_000)]) * pick([1, -1]);
    const n = int(-1e9, 1e9) * pick([1, 1, 1000]) + (rnd() < 0.3 ? Math.floor(d / 2) : 0);
    add('divRound', { numerator: n, denominator: d }, () => num(F.divRound(n, d)));
  }

  const comms = [
    [1_000_000, 25, 500, SPEC], [100_000, 25, 500, SPEC], [1_000_100, 25, 0, SPEC], [1_000_200, 25, 0, SPEC], [0, 25, 500, SPEC],
    [-0, 25, 500], [-1, 25, 500], [1, 25, 500], [1, 25, 0], [19_999, 25, 0], [20_000, 25, 0], [20_001, 25, 0], [1_001_000, 25, 500],
    [999_000, 25, 500], [NaN, 25, 500], [Infinity, 25, 500], [1_000_000, 0, 0], [1_000_000, -25, 500], [1_000_000, 25, -500], [1_000_000, 2.5, 0], [2 ** 52, 25, 0],
  ];
  for (const [n, bps, min, note] of comms) add('commission', { notional: n, feeBps: bps, minFee: min }, () => num(F.commission(n, bps, min)), note);
  for (let i = 0; i < 200; i++) {
    const bps = pick([0, 1, 5, 10, 15, 25, 30, 50, 100]);
    const tie = rnd() < 0.3 && bps > 0;
    let n = int(1, 50_000_000);
    if (tie) n = Math.ceil(5000 / bps) * 2 * int(1, 5000) + (5000 % bps === 0 ? 5000 / bps : 0);
    const min = pick([0, 0, 500, 1000, 2500]);
    add('commission', { notional: n, feeBps: bps, minFee: min }, () => num(F.commission(n, bps, min)));
  }

  const ratios = [[1, 2], [1, 0], [0, 0], [1, -0], [-1, 3], [2, 3], [0, 5], [-0, 5], [NaN, 1], [1, NaN], [Infinity, 2], [1, Infinity], [5e-324, 2], [1e308, 1e-308]];
  for (const [p, w] of ratios) add('ratio', { part: p, whole: w }, () => { const r = F.ratio(p, w); return r === null ? null : num(r); });
  for (let i = 0; i < 40; i++) {
    const p = int(-1e7, 1e7);
    const w = int(-1e7, 1e7);
    add('ratio', { part: p, whole: w }, () => { const r = F.ratio(p, w); return r === null ? null : num(r); });
  }
}

// ---------------------------------------------------------------- execution
const specQuote = { mid: 10_000, bid: 9_990, ask: 10_010, depth: 100 };
const quotes = [specQuote, { mid: 10_000, bid: 10_000, ask: 10_000, depth: 0 }, { mid: 1, bid: 0, ask: 2, depth: 5 }, { mid: 500, bid: 510, ask: 490, depth: 10 }, { mid: 10_000.5, bid: 9_990.25, ask: 10_010.75, depth: 1.5 }];
for (let i = 0; i < 12; i++) {
  const mid = int(100, 200_000);
  const half = int(0, 60);
  quotes.push({ mid, bid: mid - half, ask: mid + half, depth: int(0, 1500) });
}
{
  for (const q of quotes) for (const side of ['BUY', 'SELL']) add('executionPrice', { side, quote: q }, () => num(F.executionPrice(side, q)), q === specQuote ? SPEC : undefined);
  const specLimits = new Set(['limitIsMarketable:BUY:10010', 'limitIsMarketable:BUY:10009', 'limitIsMarketable:SELL:9990', 'limitCrosses:BUY:10020', 'limitCrosses:SELL:10000']);
  for (const fn of ['limitCrosses', 'limitIsMarketable']) {
    for (const q of quotes) {
      for (const side of ['BUY', 'SELL']) {
        const prices = [...new Set([q.bid - 1, q.bid, q.bid + 1, q.ask - 1, q.ask, q.ask + 1, q.mid, ...(q === specQuote ? [10_020] : [])])];
        for (const p of prices) add(fn, { side, limitPrice: p, quote: q }, () => F[fn](side, p, q), q === specQuote && specLimits.has(`${fn}:${side}:${p}`) ? SPEC : undefined);
      }
    }
  }
  for (const q of quotes) for (const s of [q.bid - 1, q.bid, q.bid + 1]) add('sellStopTriggered', { stopPrice: s, quote: q }, () => F.sellStopTriggered(s, q), q === specQuote && s !== q.bid + 1 ? SPEC : undefined);
  for (const q of quotes) for (const used of [0, 30, q.depth, q.depth + 50]) add('remainingDepth', { quote: q, alreadyUsed: used }, () => num(F.remainingDepth(q, used)), q === specQuote && used === 30 ? SPEC : undefined);
  const spreads = [[10_010, 10_000, 7, SPEC], [9_990, 10_000, 7], [10_000, 10_000, 7], [10_010, 10_000, 0], [10_010, 10_000.5, 3], [10_010, NaN, 3], [10_010, 10_000, -2]];
  for (const [p, m, q, note] of spreads) add('spreadCost', { price: p, mid: m, quantity: q }, () => num(F.spreadCost(p, m, q)), note);
  for (let i = 0; i < 40; i++) {
    const m = int(100, 200_000);
    const p = m + int(-80, 80);
    const q = int(0, 5000);
    add('spreadCost', { price: p, mid: m, quantity: q }, () => num(F.spreadCost(p, m, q)));
  }
}

// ---------------------------------------------------------------- ledger
const snapshotLedger = (l) => ({
  cash: num(l.cash),
  realizedPnl: num(l.realizedPnl),
  feesPaid: num(l.feesPaid),
  spreadCostPaid: num(l.spreadCostPaid),
  positions: Object.entries(l.positions).map(([k, h]) => [k, enc({ symbol: h.symbol, quantity: h.quantity, costBasis: h.costBasis })]),
});
function ledgerScenario(note, initial, executions) {
  const ledger = { cash: initial.cash, positions: holdings(initial.positions ?? []), realizedPnl: initial.realizedPnl ?? 0, feesPaid: initial.feesPaid ?? 0, spreadCostPaid: initial.spreadCostPaid ?? 0 };
  const input = {
    ledger: { ...snapshotLedger(ledger), positions: (initial.positions ?? []).map(([k, h]) => [k, enc(h)]) },
    executions: executions.map(enc),
  };
  const steps = executions.map((execution) => {
    let step;
    try {
      step = { booking: enc(F.bookExecution(ledger, execution)) };
    } catch (e) {
      step = { error: errorOf(e) };
    }
    step.ledger = snapshotLedger(ledger);
    return step;
  });
  (golden.bookExecution ??= []).push({ note, input, output: { steps } });
}
{
  const ex = (symbol, side, price, quantity, fee, mid) => ({ symbol, side, price, quantity, fee, mid });
  ledgerScenario(`${SPEC}: average cost and accounting identity`, { cash: 1_000_000 }, [
    ex('AAA', 'BUY', 10_010, 50, 1_000, 10_000),
    ex('AAA', 'BUY', 12_010, 25, 1_000, 12_000),
    ex('AAA', 'SELL', 11_990, 30, 1_000, 12_000),
    ex('AAA', 'SELL', 11_990, 45, 1_000, 12_000),
  ]);
  ledgerScenario(`${SPEC}: refusals leave the ledger untouched`, { cash: 100_000 }, [
    ex('AAA', 'BUY', 10_010, 10, 1_000, 10_000),
    ex('AAA', 'SELL', 9_990, 1, 0, 10_000),
    ex('AAA', 'BUY', 10.5, 1, 0, 10),
  ]);
  ledgerScenario('invalid executions', { cash: 1_000_000, positions: [['AAA', { symbol: 'AAA', quantity: 10, costBasis: 100_000 }]] }, [
    ...[0, -1, 0.5, 1.5, NaN, Infinity, -0].map((q) => ex('AAA', 'BUY', 100, q, 0, 100)),
    ...[0, -0, -5, 10.5, NaN, Infinity].map((p) => ex('AAA', 'SELL', p, 1, 0, 100)),
    ...[-1, 0.5, NaN, Infinity].map((f) => ex('AAA', 'BUY', 100, 1, f, 100)),
    ex('AAA', 'BUY', 100, 1, -0, 100),
  ]);
  ledgerScenario('exact cash boundary', { cash: 1_003_503 }, [ex('CTB', 'BUY', 10_010, 100, 2_504, 10_000), ex('CTB', 'BUY', 10_010, 100, 2_503, 10_000), ex('CTB', 'BUY', 1, 1, 0, 1), ex('CTB', 'BUY', 1, 1, 0, 1)]);
  ledgerScenario('sell limits, full exit, re-entry', { cash: 500_000 }, [
    ex('MDX', 'SELL', 100, 1, 0, 100),
    ex('MDX', 'BUY', 18_200, 10, 500, 18_150),
    ex('MDX', 'SELL', 18_100, 11, 500, 18_150),
    ex('MDX', 'SELL', 18_100, 10, 500, 18_150),
    ex('MDX', 'SELL', 18_100, 1, 0, 18_150),
    ex('MDX', 'BUY', 17_000, 3, 0, 17_000),
    ex('MDX', 'SELL', 17_500, 3, 0, 17_400),
  ]);
  ledgerScenario('average-cost rounding ties', { cash: 1_000_000 }, [
    ex('T', 'BUY', 2, 2, 1, 2), ex('T', 'SELL', 2, 1, 0, 2), ex('T', 'BUY', 3, 3, 0, 3), ex('T', 'SELL', 3, 2, 0, 3),
    ex('U', 'BUY', 1_001, 3, 0, 1_000), ex('U', 'SELL', 1_000, 2, 1, 1_000), ex('U', 'BUY', 7, 6, 3, 7), ex('U', 'SELL', 7, 4, 0, 7), ex('U', 'SELL', 7, 3, 0, 7),
  ]);
  ledgerScenario('integer-like symbols keep JS property order', { cash: 10_000_000 }, [
    ex('10', 'BUY', 100, 1, 0, 100), ex('2', 'BUY', 100, 1, 0, 100), ex('AAA', 'BUY', 100, 1, 0, 100), ex('01', 'BUY', 100, 1, 0, 100),
    ex('4294967295', 'BUY', 100, 1, 0, 100), ex('4294967294', 'BUY', 100, 1, 0, 100), ex('0', 'BUY', 100, 1, 0, 100), ex('-1', 'BUY', 100, 1, 0, 100), ex('2', 'SELL', 100, 1, 0, 100),
  ]);
  ledgerScenario('mid outside the integer grid', { cash: 1_000_000 }, [ex('OLV', 'BUY', 9_860, 10, 500, 9_850.5), ex('OLV', 'SELL', 9_840, 5, 500, NaN), ex('OLV', 'SELL', 9_840, 5, 500, 9_850)]);
  ledgerScenario('pre-existing positions and totals', {
    cash: 250_000, realizedPnl: 1_234, feesPaid: 4_000, spreadCostPaid: 777,
    positions: [['ATL', { symbol: 'ATL', quantity: 7, costBasis: 70_007 }], ['GOV', { symbol: 'GOV', quantity: 3, costBasis: 299_999 }]],
  }, [ex('ATL', 'SELL', 10_500, 3, 500, 10_520), ex('GOV', 'SELL', 101_000, 3, 0, 100_900), ex('ATL', 'SELL', 10_400, 4, 500, 10_420), ex('TEK', 'BUY', 5_000, 20, 500, 4_990)]);
  ledgerScenario('beyond 2^53', { cash: 1e18 }, [ex('BIG', 'BUY', 3_000_000_000_000_001, 3, 1, 3_000_000_000_000_000), ex('BIG', 'SELL', 3_000_000_000_000_007, 1, 1, 3_000_000_000_000_000), ex('BIG', 'SELL', 2_999_999_999_999_999, 2, 1, 3_000_000_000_000_000)]);
  const symbols = ['CTB', 'MDX', 'OLV', 'ATL', 'TEK', 'GOV', 'SFX'];
  for (let s = 0; s < 8; s++) {
    const steps = times(40, () => {
      const symbol = pick(symbols);
      const side = rnd() < 0.55 ? 'BUY' : 'SELL';
      const price = int(1_000, 90_000);
      const quantity = int(1, 300);
      const fee = rnd() < 0.8 ? F.commission(price * quantity, pick([10, 25, 50]), pick([0, 500])) : int(0, 5000);
      return ex(symbol, side, price, quantity, fee, price + int(-60, 60));
    });
    ledgerScenario(`random #${s + 1}`, { cash: int(500_000, 50_000_000) }, steps);
  }

  const positions = [['AAA', { symbol: 'AAA', quantity: 100, costBasis: 900_000 }], ['ZERO', { symbol: 'ZERO', quantity: 0, costBasis: 0 }], ['7', { symbol: '7', quantity: 7, costBasis: 70 }]];
  for (const symbol of ['AAA', 'ZERO', '7', 'MISSING', '']) {
    add('heldQuantity', { positions, symbol }, () => num(F.heldQuantity({ positions: holdings(positions) }, symbol)));
  }
}

// ---------------------------------------------------------------- valuation
const specPositions = [
  ['AAA', { symbol: 'AAA', quantity: 100, costBasis: 900_000 }],
  ['BBB', { symbol: 'BBB', quantity: 20, costBasis: 1_100_000 }],
  ['CCC', { symbol: 'CCC', quantity: 0, costBasis: 0 }],
];
const valueSets = [
  [[['AAA', 1_000_000], ['BBB', 1_000_000]], SPEC],
  [[]],
  [[['ONE', 123_456]]],
  [[['X', 1e16], ['Y', -1e16], ['5', 1]], 'integer key summed first'],
  [[['b', 0.1], ['a', 0.2], ['3', 0.3], ['1', 1e-17]], 'float sum order'],
  [[['ZZ', 0], ['YY', 0]]],
  [[['A', 0], ['B', -0]]],
  [[['A', -500], ['B', 1_500]]],
  [[['A', -500], ['B', 400]]],
  [[['A', NaN], ['B', 1]]],
  [[['A', Infinity], ['B', 1]]],
  [[['A', 2 ** 53], ['B', 1], ['C', 1]]],
  [[['CTB', 4_250_000], ['MDX', 1_820_000], ['OLV', 985_000], ['ATL', 3_100_000], ['TEK', 2_200_000]]],
];
for (let i = 0; i < 25; i++) {
  const n = int(1, 12);
  const pairs = times(n, (k) => [pick(['S', 'T', 'U']) + k, rnd() < 0.15 ? 0 : int(1, 50_000_000) * (rnd() < 0.1 ? 0.001 : 1)]);
  if (rnd() < 0.2) pairs.push([String(int(0, 99)), int(1, 1_000_000)]);
  valueSets.push([pairs]);
}
{
  const priceList = [['AAA', 10_000], ['BBB', 50_000], ['CCC', 1]];
  const mv = (positions, prices, note) => {
    const p = record(prices);
    add('marketValues', { positions, prices }, () => enc(Object.entries(F.marketValues(holdings(positions), (s) => p[s])) ), note);
  };
  mv(specPositions, priceList, SPEC);
  mv([], []);
  mv([['10', { symbol: '10', quantity: 1, costBasis: 0 }], ['2', { symbol: '2', quantity: 2, costBasis: 0 }], ['B', { symbol: 'B', quantity: 3, costBasis: 0 }], ['A', { symbol: 'A', quantity: 4, costBasis: 0 }]], [['10', 100], ['2', 200], ['A', 300], ['B', 400]], 'integer-like symbols first');
  mv([['K1', { symbol: 'X', quantity: 1, costBasis: 0 }], ['K2', { symbol: 'Y', quantity: 2, costBasis: 0 }], ['K3', { symbol: 'X', quantity: 5, costBasis: 0 }]], [['X', 10], ['Y', 20]], 'keyed by holding symbol; later duplicate overwrites in place');
  mv([['N', { symbol: 'N', quantity: -3, costBasis: 0 }], ['Q', { symbol: 'Q', quantity: NaN, costBasis: 0 }], ['F', { symbol: 'F', quantity: 0.5, costBasis: 0 }]], [['F', 1_001]], 'negative, NaN and fractional quantities');
  for (let i = 0; i < 15; i++) {
    const syms = ['CTB', 'MDX', 'OLV', 'ATL', 'TEK', 'GOV', 'SFX', '42'].filter(() => rnd() < 0.6);
    const positions = syms.map((s) => [s, { symbol: s, quantity: rnd() < 0.2 ? 0 : int(1, 5000), costBasis: int(0, 90_000_000) }]);
    mv(positions, syms.map((s) => [s, int(500, 120_000)]));
  }

  for (const [pairs, note] of valueSets) {
    add('totalValue', { values: pairs }, () => num(F.totalValue(record(pairs))), note);
    const cash = pick([0, 2_000_000, -1_000, 123.5]);
    add('equityOf', { cash, values: pairs }, () => num(F.equityOf(cash, record(pairs))), note);
    for (const base of [4_000_000, 0, -1, NaN, 1]) add('maxWeight', { values: pairs, base }, () => num(F.maxWeight(record(pairs), base)), note);
    for (const equity of [4_000_000, 0, -5, 2_000_000.5]) add('exposure', { values: pairs, equity }, () => num(F.exposure(record(pairs), equity)), note);
    add('concentration', { values: pairs }, () => enc(F.concentration(record(pairs))), note);
  }
  add('maxWeight', { values: [], base: 0 }, () => num(F.maxWeight({}, 0)), SPEC);
  add('unrealizedPnl', { positions: specPositions, values: [['AAA', 1_000_000], ['BBB', 1_000_000]] }, () => num(F.unrealizedPnl(holdings(specPositions), { AAA: 1_000_000, BBB: 1_000_000 })), SPEC);
  add('unrealizedPnl', { positions: [], values: [] }, () => num(F.unrealizedPnl({}, {})));
  for (let i = 0; i < 20; i++) {
    const n = int(1, 8);
    const positions = times(n, (k) => [`P${k}`, { symbol: `P${k}`, quantity: int(0, 1000), costBasis: int(0, 9e7) * (rnd() < 0.1 ? 0.001 : 1) }]);
    if (rnd() < 0.3) positions.push(['9', { symbol: '9', quantity: 1, costBasis: 1e16 }]);
    const values = positions.filter(([, h]) => h.quantity > 0).map(([k]) => [k, int(0, 1e8)]);
    add('unrealizedPnl', { positions, values }, () => num(F.unrealizedPnl(holdings(positions), record(values))));
  }
}

// ---------------------------------------------------------------- risk
{
  const walk = (n, start, vol) => {
    const out = [start];
    for (let i = 1; i < n; i++) out.push(Math.max(0, Math.round(out[i - 1] * (1 + gauss() * vol))));
    return out;
  };
  const seriesSet = [
    [[100, 120, 90, 130, 65], SPEC], [[100, 110, 120], SPEC], [[]], [[5]], [[0, 0, 10, 5]], [[-5, -10, -1]], [[-5, 10, 4]], [[100, NaN, 50]], [[100, 0, 50]],
    [[100, Infinity, 50]], [[Infinity, 1]], [[1e-320, 0]], [[3, 1, 2, -0, 4]], [[100, 99.99999999999999, 100]],
  ];
  for (let i = 0; i < 30; i++) seriesSet.push([walk(int(2, 250), int(100_000, 50_000_000), pick([0.001, 0.01, 0.05]))]);
  for (const [s, note] of seriesSet) {
    add('maxDrawdown', { series: s }, () => num(F.maxDrawdown(s)), note);
    add('simpleReturns', { series: s }, () => enc(F.simpleReturns(s)), note === SPEC ? undefined : note);
  }
  add('simpleReturns', { series: [100, 110, 99] }, () => enc(F.simpleReturns([100, 110, 99])), SPEC);

  const samples = [
    [[2, 4, 4, 4, 5, 5, 7, 9], SPEC], [[1], SPEC], [[]], [[3, 3]], [[1, 2]], [[-1e9, 1e9]], [[0.1, 0.2, 0.3]], [[1e16, 1, -1e16, 3]], [[NaN, 1, 2]], [[Infinity, 1]], [[5e-324, 0]],
  ];
  for (let i = 0; i < 60; i++) {
    const n = int(2, 300);
    const scale = pick([1e-4, 0.01, 1, 1000, 1e9]);
    samples.push([times(n, () => gauss() * scale + pick([0, scale * 3]))]);
  }
  for (let i = 0; i < 10; i++) samples.push([F.simpleReturns(walk(int(6, 120), int(1e5, 1e8), 0.02))]);
  for (const [s, note] of samples) add('sampleStdDev', { values: s }, () => { const r = F.sampleStdDev(s); return r === null ? null : num(r); }, note);

  const pnl40 = times(40, (i) => -(i + 1));
  const vars = [
    [pnl40, undefined, SPEC], [pnl40.slice(0, 29), undefined, SPEC], [times(40, () => 5), undefined, SPEC],
    [pnl40, 0.99], [pnl40, 0.9], [pnl40, 0.5], [pnl40, 0], [pnl40, 1], [pnl40, 1.01], [pnl40, 1.05], [pnl40, 1.5], [pnl40, -0.5], [pnl40, NaN], [pnl40, Infinity], [pnl40, -Infinity],
    [times(30, (i) => i - 15), undefined], [times(30, (i) => (i % 2 ? 0 : -0)), undefined], [times(35, (i) => (i === 3 ? -Infinity : i)), undefined], [times(35, (i) => (i === 3 ? Infinity : -i)), 0.99],
    [times(64, (i) => (i * 7919) % 101 - 50), 0.95], [times(100, (i) => -i), 0.975], [times(1000, (i) => ((i * 7919) % 2003) - 1000), 0.99],
  ];
  for (let i = 0; i < 60; i++) {
    const n = int(30, 400);
    const scale = pick([1, 1000, 1e6]);
    const pnl = times(n, () => (rnd() < 0.5 ? Math.round(gauss() * scale) : gauss() * scale));
    vars.push([pnl, pick([undefined, 0.95, 0.99, 0.975, 0.9])]);
  }
  for (const [pnl, confidence, note] of vars) {
    const input = confidence === undefined ? { pnl } : { pnl, confidence };
    add('historicalVaR', input, () => enc(confidence === undefined ? F.historicalVaR(pnl) : F.historicalVaR(pnl, confidence)), note);
  }

  const scen = (pairs, rets, note) => {
    const r = record(rets);
    add('scenarioPnl', { values: pairs, returns: rets }, () => num(F.scenarioPnl(record(pairs), (s) => r[s])), note);
  };
  scen([['BBB', 2_000_000], ['AAA', 1_000_000]], [['AAA', -0.1], ['BBB', 0.05]], SPEC);
  scen([], []);
  scen([['X', 1e16], ['Y', -1e16], ['5', 1]], [['X', 1], ['Y', 1], ['5', 1]], 'integer key summed first');
  scen([['A', 100]], [['A', NaN]]);
  for (let i = 0; i < 40; i++) {
    const n = int(1, 10);
    const pairs = times(n, (k) => [`S${k}`, int(0, 90_000_000)]);
    if (rnd() < 0.25) pairs.push([String(int(0, 50)), int(0, 1e6)]);
    scen(pairs, pairs.map(([k]) => [k, gauss() * 0.03]));
  }

  const stress = (pairs, shocks, note) => {
    const s = record(shocks);
    add('stressImpact', { values: pairs, shocks }, () => enc(F.stressImpact(record(pairs), (k) => s[k])), note);
  };
  stress([['BBB', 2_000_000], ['AAA', 1_000_000]], [['AAA', -0.2], ['BBB', -0.05]], SPEC);
  stress([], []);
  stress([['A', 5], ['B', 25], ['C', 25], ['D', 15]], [['A', -0.1], ['B', 0.1], ['C', -0.1], ['D', -0.1]], 'Math.round ties (and -0)');
  stress([['OLV', 985_000], ['CTB', 4_250_000], ['TEK', 2_200_000], ['ATL', 3_100_000], ['MDX', 1_820_000], ['GOV', 7_000_000], ['SFX', 1]], [['OLV', -0.3], ['CTB', -0.25], ['TEK', -0.4], ['ATL', 0.07], ['MDX', -0.123], ['GOV', 0], ['SFX', -1]], 'realistic tickers');
  stress([['B2', 1], ['A10', 2], ['A2', 3], ['10', 4], ['9', 5], ['Z', 6], ['AB1', 7]], [['B2', 0.5], ['A10', 0.5], ['A2', 0.5], ['10', 0.5], ['9', 0.5], ['Z', 0.5], ['AB1', 0.5]], 'digits and letters');
  const caseAndAccent = ['ZZ', 'Été', 'Ete', 'b', 'AB', 'Ab', 'ab', 'ÅA', 'A1', '1A'];
  stress(caseAndAccent.map((s, i) => [s, (i + 1) * 1000]), caseAndAccent.map((s) => [s, -0.1]), 'case and accent order');
  for (let i = 0; i < 25; i++) {
    const syms = [...new Set(times(int(1, 9), () => String.fromCharCode(65 + int(0, 25)) + String.fromCharCode(65 + int(0, 25)) + pick(['', String.fromCharCode(65 + int(0, 25)), String(int(0, 9))])))];
    stress(syms.map((s) => [s, int(0, 90_000_000)]), syms.map((s) => [s, Math.round(gauss() * 30) / 100 + (rnd() < 0.3 ? gauss() * 1e-3 : 0)]));
  }
}

// ---------------------------------------------------------------- pre-trade
{
  const fees = { feeBps: 25, minFee: 500 };
  add('reservedCash', { openBuys: [{ limitPrice: 10_000, remainingQuantity: 100 }, { limitPrice: 5_000, remainingQuantity: 10 }], fees }, () => num(F.reservedCash([{ limitPrice: 10_000, remainingQuantity: 100 }, { limitPrice: 5_000, remainingQuantity: 10 }], fees)), SPEC);
  add('reservedCash', { openBuys: [], fees }, () => num(F.reservedCash([], fees)));
  add('reservedCash', { openBuys: [{ limitPrice: 10_000, remainingQuantity: 0 }], fees }, () => num(F.reservedCash([{ limitPrice: 10_000, remainingQuantity: 0 }], fees)));
  for (let i = 0; i < 30; i++) {
    const openBuys = times(int(1, 6), () => ({ limitPrice: int(100, 120_000), remainingQuantity: int(0, 2000) }));
    const f = { feeBps: pick([10, 25, 50]), minFee: pick([0, 500, 1000]) };
    add('reservedCash', { openBuys, fees: f }, () => num(F.reservedCash(openBuys, f)));
  }

  add('estimateOrder', { side: 'BUY', price: 10_010, quantity: 100, fees }, () => enc(F.estimateOrder('BUY', 10_010, 100, fees)), SPEC);
  add('estimateOrder', { side: 'SELL', price: 9_990, quantity: 100, fees }, () => enc(F.estimateOrder('SELL', 9_990, 100, fees)), SPEC);
  for (const [side, price, quantity] of [['BUY', 10_010, 0], ['SELL', 10_010, 0], ['SELL', 1, 1], ['BUY', 1, 1]]) {
    add('estimateOrder', { side, price, quantity, fees }, () => enc(F.estimateOrder(side, price, quantity, fees)));
  }
  for (let i = 0; i < 40; i++) {
    const side = pick(['BUY', 'SELL']);
    const price = int(100, 120_000);
    const quantity = int(0, 5000);
    const f = { feeBps: pick([10, 25, 50]), minFee: pick([0, 500, 1000]) };
    add('estimateOrder', { side, price, quantity, fees: f }, () => enc(F.estimateOrder(side, price, quantity, f)));
  }

  const base = { side: 'BUY', quantity: 100, referencePrice: 10_010, mid: 10_000, held: 0, pendingBuyQuantity: 0, availableCash: 1_003_503, equity: 4_000_000, fees };
  const check = (input, note) => add('checkOrder', { input }, () => enc(F.checkOrder(input)), note);
  check(base, SPEC);
  check({ ...base, availableCash: 1_003_502 }, SPEC);
  check({ ...base, maxPositionWeightPct: 25 }, SPEC);
  check({ ...base, held: 1, maxPositionWeightPct: 25 }, SPEC);
  check({ ...base, pendingBuyQuantity: 1, maxPositionWeightPct: 25 }, SPEC);
  check({ ...base, side: 'SELL', held: 99 }, SPEC);
  check({ ...base, side: 'SELL', held: 100 }, SPEC);
  check({ ...base, side: 'SELL', held: 100, availableCash: -1 });
  check({ ...base, quantity: 0, availableCash: 0 });
  check({ ...base, equity: 0, maxPositionWeightPct: 25 });
  check({ ...base, equity: 0, quantity: 0, availableCash: 0, maxPositionWeightPct: 25 });
  check({ ...base, equity: -4_000_000, maxPositionWeightPct: 25 });
  check({ ...base, maxPositionWeightPct: 0 });
  check({ ...base, maxPositionWeightPct: 25.000000000000004 });
  check({ ...base, mid: 10_000.3, maxPositionWeightPct: 25 });
  for (let i = 0; i < 60; i++) {
    const mid = int(500, 120_000);
    const input = {
      side: pick(['BUY', 'BUY', 'SELL']), quantity: int(1, 3000), referencePrice: mid + int(-50, 50), mid, held: int(0, 3000), pendingBuyQuantity: int(0, 500),
      availableCash: int(0, 200_000_000), equity: int(1, 400_000_000), fees: { feeBps: pick([10, 25, 50]), minFee: pick([0, 500]) },
    };
    if (rnd() < 0.6) input.maxPositionWeightPct = pick([10, 20, 25, 33.3, 50]);
    check(input);
  }
}

// ---------------------------------------------------------------- orders
const bandEdgeMisses = [];
{
  for (const [l, m, b] of [[5_000, 10_000, 50], [15_000, 10_000, 50], [4_999, 10_000, 50], [15_001, 10_000, 50]]) {
    add('limitWithinBand', { limitPrice: l, mid: m, bandPct: b }, () => F.limitWithinBand(l, m, b), ORDERS_SPEC);
  }
  // Integer limits exactly on the ±band edge that floating point puts just outside the band.
  outer: for (let mid = 1; mid <= 3000; mid++) {
    for (let b = 1; b <= 99; b++) {
      for (const sign of [-1, 1]) {
        if ((mid * (100 + sign * b)) % 100 !== 0) continue;
        const edge = (mid * (100 + sign * b)) / 100;
        if (!F.limitWithinBand(edge, mid, b)) bandEdgeMisses.push({ limitPrice: edge, mid, bandPct: b });
        if (bandEdgeMisses.length >= 12) break outer;
      }
    }
  }
  for (const c of bandEdgeMisses) add('limitWithinBand', c, () => F.limitWithinBand(c.limitPrice, c.mid, c.bandPct), 'exact edge outside after rounding');
  for (const [l, m, b] of [[0, 0, 50], [1, 0, 50], [10_000, 10_000, 0], [10_001, 10_000, 0], [-1, 10_000, 150], [NaN, 10_000, 50], [10_000, 10_000, NaN]]) {
    add('limitWithinBand', { limitPrice: l, mid: m, bandPct: b }, () => F.limitWithinBand(l, m, b));
  }
  for (let i = 0; i < 80; i++) {
    const m = int(100, 200_000);
    const b = pick([5, 10, 20, 30, 50, int(1, 99), Math.round(rnd() * 1000) / 10]);
    const l = Math.round(m * (1 + (rnd() * 2 - 1) * (b / 100) * 1.2));
    add('limitWithinBand', { limitPrice: l, mid: m, bandPct: b }, () => F.limitWithinBand(l, m, b));
  }

  add('stopBelowBid', { stopPrice: 9_989, quote: specQuote }, () => F.stopBelowBid(9_989, specQuote), ORDERS_SPEC);
  add('stopBelowBid', { stopPrice: 9_990, quote: specQuote }, () => F.stopBelowBid(9_990, specQuote), ORDERS_SPEC);
  for (const q of quotes.slice(1)) for (const s of [q.bid - 1, q.bid, q.bid + 1]) add('stopBelowBid', { stopPrice: s, quote: q }, () => F.stopBelowBid(s, q));

  const resting = (over) => ({ type: 'LIMIT', side: 'BUY', limitPrice: null, stopPrice: null, triggered: false, ...over });
  const act = (order, quote, note) => add('restingOrderAction', { order, quote }, () => F.restingOrderAction(order, quote), note);
  act(resting({ limitPrice: 10_009 }), specQuote, ORDERS_SPEC);
  act(resting({ limitPrice: 10_010 }), specQuote, ORDERS_SPEC);
  act(resting({ side: 'SELL', limitPrice: 9_991 }), specQuote, ORDERS_SPEC);
  act(resting({ side: 'SELL', limitPrice: 9_990 }), specQuote, ORDERS_SPEC);
  const stop = resting({ type: 'STOP', side: 'SELL', stopPrice: 9_980 });
  act(stop, specQuote, ORDERS_SPEC);
  act(stop, { ...specQuote, bid: 9_980 }, ORDERS_SPEC);
  act({ ...stop, triggered: true }, specQuote, ORDERS_SPEC);
  act(resting({ type: 'STOP', side: 'SELL', stopPrice: null }), specQuote);
  act(resting({ type: 'STOP', side: 'SELL', stopPrice: null, triggered: true }), specQuote);
  act(resting({ type: 'STOP', side: 'BUY', stopPrice: 10_000 }), specQuote);
  act(resting({ type: 'LIMIT', limitPrice: null }), specQuote);
  act(resting({ type: 'LIMIT', limitPrice: 20_000, triggered: true }), specQuote);
  act(resting({ type: 'LIMIT', side: 'BUY', limitPrice: 20_000, stopPrice: 1 }), specQuote);
  act(resting({ type: 'MARKET', limitPrice: 20_000, stopPrice: 20_000 }), specQuote);
  act(resting({ type: 'MARKET', triggered: true }), specQuote);
  for (let i = 0; i < 40; i++) {
    const q = pick(quotes);
    const type = pick(['MARKET', 'LIMIT', 'STOP']);
    const price = q.mid + int(-80, 80);
    act(resting({ type, side: pick(['BUY', 'SELL']), limitPrice: type === 'LIMIT' ? price : null, stopPrice: type === 'STOP' ? price : null, triggered: rnd() < 0.2 }), q);
  }

  const fill = (input, note) => add('fillableQuantity', input, () => num(F.fillableQuantity(input)), note);
  fill({ side: 'BUY', remaining: 50, held: 0, depthLeft: 100 }, ORDERS_SPEC);
  fill({ side: 'BUY', remaining: 150, held: 0, depthLeft: 100 }, ORDERS_SPEC);
  fill({ side: 'SELL', remaining: 50, held: 30, depthLeft: 100 }, ORDERS_SPEC);
  fill({ side: 'SELL', remaining: 50, held: 80, depthLeft: 20 }, ORDERS_SPEC);
  fill({ side: 'BUY', remaining: 10, held: 0, depthLeft: -5 }, ORDERS_SPEC);
  fill({ side: 'SELL', remaining: 10, held: -3, depthLeft: 100 });
  fill({ side: 'SELL', remaining: 10, held: 0, depthLeft: 100 });
  fill({ side: 'BUY', remaining: 0, held: 0, depthLeft: -0 });
  fill({ side: 'BUY', remaining: -0, held: 0, depthLeft: 5 });
  fill({ side: 'BUY', remaining: 5, held: 0, depthLeft: NaN });
  fill({ side: 'SELL', remaining: 5, held: NaN, depthLeft: 9 });
  for (let i = 0; i < 40; i++) fill({ side: pick(['BUY', 'SELL']), remaining: int(-5, 500), held: int(-5, 500), depthLeft: int(-50, 600) });
}

// ---------------------------------------------------------------- performance
{
  const twr = (points, note) => add('timeWeightedReturn', { points }, () => { const r = F.timeWeightedReturn(points); return r === null ? null : num(r); }, note);
  twr([{ equity: 100_000, flowAfter: 0 }, { equity: 110_000, flowAfter: 50_000 }, { equity: 152_000, flowAfter: 0 }], ORDERS_SPEC);
  twr([{ equity: 100_000, flowAfter: 0 }, { equity: 120_000, flowAfter: -60_000 }, { equity: 57_000, flowAfter: 0 }], ORDERS_SPEC);
  twr([], ORDERS_SPEC);
  twr([{ equity: 100_000, flowAfter: 0 }], ORDERS_SPEC);
  twr([{ equity: 0, flowAfter: 0 }, { equity: 10, flowAfter: 0 }], ORDERS_SPEC);
  twr([{ equity: 100, flowAfter: -100 }, { equity: 10, flowAfter: 0 }]);
  twr([{ equity: 100, flowAfter: 0 }, { equity: 50, flowAfter: -60 }, { equity: 10, flowAfter: 0 }]);
  twr([{ equity: 100, flowAfter: 0 }, { equity: 0, flowAfter: 0 }]);
  twr([{ equity: 100, flowAfter: 0 }, { equity: -50, flowAfter: 0 }]);
  twr([{ equity: NaN, flowAfter: 0 }, { equity: 10, flowAfter: 0 }]);
  twr([{ equity: 0, flowAfter: 1e-300 }, { equity: 1, flowAfter: 0 }]);
  for (let i = 0; i < 40; i++) {
    let equity = int(1e5, 1e8);
    const points = times(int(2, 120), () => {
      equity = Math.max(1, Math.round(equity * (1 + gauss() * 0.02)));
      const flowAfter = rnd() < 0.1 ? int(-Math.floor(equity / 2), 5e6) : 0;
      const p = { equity, flowAfter };
      equity += flowAfter;
      return p;
    });
    twr(points);
  }

  const contrib = (flows, note) => add('netContributions', { flows }, () => num(F.netContributions(flows)), note);
  contrib([100_000, 50_000], ORDERS_SPEC);
  contrib([]);
  contrib([-0]);
  contrib([1e16, 1, 1, -1e16]);
  contrib([0.1, 0.2, 0.3]);
  for (let i = 0; i < 20; i++) contrib(times(int(1, 30), () => int(-5e6, 1e7)));
  const profit = (equity, contributions, note) => add('investmentProfit', { equity, contributions }, () => num(F.investmentProfit(equity, contributions)), note);
  profit(152_000, 150_000, ORDERS_SPEC);
  profit(0, 0);
  profit(-0, 0);
  profit(100, 250);
  profit(NaN, 1);
  for (let i = 0; i < 20; i++) profit(int(0, 1e9), int(0, 1e9));
}

// ---------------------------------------------------------------- known divergences (not golden)
// Behaviour the Java port intentionally does not reproduce; the TypeScript output is recorded so the
// Java test can document the difference. Prototype-name probes run in child processes because they
// pollute Object.prototype.
function probe(code) {
  const result = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, PIF_FINANCE_JS: join(jsDir, 'index.js') }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
const prototypeSymbols = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].map((symbol) =>
  probe(`
    const F = require(process.env.PIF_FINANCE_JS);
    const num = (x) => (Object.is(x, -0) ? '-0' : String(x));
    const ledger = { cash: 1000000, positions: {}, realizedPnl: 0, feesPaid: 0, spreadCostPaid: 0 };
    const booking = F.bookExecution(ledger, { symbol: ${JSON.stringify(symbol)}, side: 'BUY', price: 10000, quantity: 10, fee: 500, mid: 9990 });
    const values = F.marketValues({ K: { symbol: ${JSON.stringify(symbol)}, quantity: 2, costBasis: 0 } }, () => 100);
    process.stdout.write(JSON.stringify({
      symbol: ${JSON.stringify(symbol)},
      execution: { symbol: ${JSON.stringify(symbol)}, side: 'BUY', price: '10000', quantity: '10', fee: '500', mid: '9990' },
      booking: Object.fromEntries(Object.entries(booking).map(([k, v]) => [k, num(v)])),
      cashAfter: num(ledger.cash),
      ownPositionKeys: Object.keys(ledger.positions),
      heldQuantityAfter: num(F.heldQuantity(ledger, ${JSON.stringify(symbol)})),
      emptyObjectQuantityAfter: String(({}).quantity),
      marketValuesOfOneHoldingNamedSo: Object.entries(values).map(([k, v]) => [k, num(v)]),
    }));
  `),
);

const exoticSymbols = ['a b', 'A_B', 'A-B', 'A.B', 'A1', 'ÅA', 'AB', 'ab', 'Ab', 'b', 'Été', 'Ete', 'ZZ', '1A', 'A/B', 'A&B', 'A B'];
const exoticValues = exoticSymbols.map((s, i) => [s, (i + 1) * 1000]);
const exoticStress = enc(F.stressImpact(record(exoticValues), () => -0.1));

const nanVaR = [];
for (const n of [30, 40, 64, 100]) {
  for (const nanAt of [[0], [Math.floor(n / 2)], [n - 1], [1, Math.floor(n / 3)]]) {
    const pnl = times(n, (i) => (nanAt.includes(i) ? NaN : ((i * 37) % n) - n / 2));
    nanVaR.push({ input: enc({ pnl }), output: enc(F.historicalVaR(pnl)) });
  }
}

let maxWeightStackLimit = null;
for (const n of [50_000, 100_000, 150_000, 200_000, 500_000]) {
  const values = Object.fromEntries(times(n, (i) => [`S${i}`, 1]));
  try {
    F.maxWeight(values, 10);
  } catch (e) {
    maxWeightStackLimit = { holdings: num(n), base: '10', valueEach: '1', error: errorOf(e) };
    break;
  }
}

// ---------------------------------------------------------------- observations (TS behaviour notes)
const toAmountDecimalDrift = [];
for (let i = 0; i < 200_000 && toAmountDecimalDrift.length < 10; i++) {
  const units = int(0, 99_999);
  const frac = String(int(0, 9999)).padStart(4, '0');
  const text = `${units}.${frac}`;
  const exact = units * 1000 + Number(frac.slice(0, 3)) + (Number(frac[3]) >= 5 ? 1 : 0);
  const got = F.toAmount(Number(text));
  if (got !== exact) toAmountDecimalDrift.push({ value: text, toAmount: num(got), decimalHalfUp: num(exact) });
}

const out = {
  generatedBy: `apps/api-spring/contract/generate-finance-fixtures.mjs (TypeScript ${ts.version} transpileModule, node ${process.version})`,
  note: 'Numbers are Number.prototype.toString() texts. Records are [key, value] pairs. Deterministic: seeded PRNG 20261110.',
  icuLocale: Intl.Collator().resolvedOptions().locale,
  sources: sourceHashes,
  constants: { AMOUNT_SCALE: num(F.AMOUNT_SCALE), MIN_VOLATILITY_RETURNS: num(F.MIN_VOLATILITY_RETURNS), MIN_VAR_OBSERVATIONS: num(F.MIN_VAR_OBSERVATIONS) },
  counts: Object.fromEntries(Object.entries(golden).map(([fn, list]) => [fn, list.length])),
  golden,
  divergences: {
    prototypeSymbols,
    collation: { values: enc(exoticValues), shock: '-0.1', output: exoticStress },
    historicalVaRWithNaN: nanVaR,
    maxWeightStackLimit,
  },
  observations: {
    toAmountDecimalDrift,
    limitWithinBandEdgeMisses: enc(bandEdgeMisses),
  },
};
/** One golden case per line, so a regenerated fixture diffs case by case. */
function serialize(fixture) {
  const lines = ['{'];
  const keys = Object.keys(fixture);
  keys.forEach((key, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    if (key !== 'golden') {
      lines.push(` ${JSON.stringify(key)}: ${JSON.stringify(fixture[key])}${comma}`);
      return;
    }
    lines.push(' "golden": {');
    const fns = Object.keys(fixture.golden);
    fns.forEach((fn, j) => {
      const list = fixture.golden[fn];
      lines.push(`  ${JSON.stringify(fn)}: [`);
      list.forEach((c, n) => lines.push(`   ${JSON.stringify(c)}${n < list.length - 1 ? ',' : ''}`));
      lines.push(`  ]${j < fns.length - 1 ? ',' : ''}`);
    });
    lines.push(` }${comma}`);
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}
const target = resolve(here, '../src/test/resources/fixtures/finance-golden.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, serialize(out));
rmSync(jsDir, { recursive: true, force: true });
const total = Object.values(out.counts).reduce((s, n) => s + n, 0);
console.log(`Wrote ${target}: ${total} golden cases over ${Object.keys(out.counts).length} functions`);
console.log(JSON.stringify(out.counts));
