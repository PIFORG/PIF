/**
 * SAMPLE DATA — fictitious instruments and values for design previews only.
 * Never present these as market data, account balances or results. Every surface
 * that renders them must show a visible "Sample data" label (DemoModeLabel).
 */

export const SAMPLE_DATA_NOTICE =
  'Sample data for illustration only. Fictitious instruments and values — not market data, not your account.';

export const SAMPLE_CURRENCY = 'USD';

/** Deterministic pseudo-random generator so fixtures are stable across renders and tests. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function walk(seed: number, points: number, start: number, drift: number, vol: number): number[] {
  const rand = seeded(seed);
  const out: number[] = [start];
  for (let i = 1; i < points; i += 1) {
    const shock = (rand() - 0.5) * 2 * vol;
    out.push(Math.max(1, out[i - 1] * (1 + drift + shock)));
  }
  return out.map((v) => Math.round(v * 100) / 100);
}

export interface SamplePoint {
  /** Trading-day index; labels are relative ("Day 1"), not calendar dates. */
  day: number;
  value: number;
}

export const SAMPLE_START_BALANCE = 100_000;

export const sampleEquityCurve: SamplePoint[] = walk(7, 64, SAMPLE_START_BALANCE, 0.0011, 0.009).map((value, i) => ({
  day: i + 1,
  value,
}));

export const sampleBenchmarkCurve: SamplePoint[] = walk(19, 64, SAMPLE_START_BALANCE, 0.0006, 0.007).map(
  (value, i) => ({ day: i + 1, value }),
);

export interface SampleAllocation {
  label: string;
  weight: number;
}

export const sampleAllocation: SampleAllocation[] = [
  { label: 'Equities', weight: 0.46 },
  { label: 'Government bonds', weight: 0.22 },
  { label: 'Commodities', weight: 0.1 },
  { label: 'FX', weight: 0.08 },
  { label: 'Cash', weight: 0.14 },
];

export interface SamplePosition {
  symbol: string;
  name: string;
  assetClass: string;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
}

export const samplePositions: SamplePosition[] = [
  { symbol: 'NWND', name: 'Northwind Industrials', assetClass: 'Equity', quantity: 120, avgPrice: 84.2, lastPrice: 91.35 },
  { symbol: 'CTSO', name: 'Contoso Energy', assetClass: 'Equity', quantity: 200, avgPrice: 42.1, lastPrice: 39.62 },
  { symbol: 'WGBK', name: 'Woodgrove Bank', assetClass: 'Equity', quantity: 90, avgPrice: 63.5, lastPrice: 66.18 },
  { symbol: 'FBK10', name: 'Fabrikam 10Y Sovereign', assetClass: 'Bond', quantity: 150, avgPrice: 98.4, lastPrice: 97.92 },
  { symbol: 'LTWG', name: 'Litware Gold Tracker', assetClass: 'Commodity', quantity: 60, avgPrice: 171.0, lastPrice: 176.4 },
];

export interface SampleQuote {
  symbol: string;
  name: string;
  last: number;
  change: number;
  spark: number[];
}

export const sampleWatchlist: SampleQuote[] = [
  { symbol: 'NWND', name: 'Northwind Industrials', last: 91.35, change: 0.0124, spark: walk(3, 24, 90, 0.0006, 0.006) },
  { symbol: 'CTSO', name: 'Contoso Energy', last: 39.62, change: -0.0187, spark: walk(5, 24, 40.5, -0.0008, 0.007) },
  { symbol: 'WGBK', name: 'Woodgrove Bank', last: 66.18, change: 0.0041, spark: walk(11, 24, 65.9, 0.0002, 0.005) },
  { symbol: 'TLSP', name: 'Tailspin Airlines', last: 22.47, change: -0.0063, spark: walk(13, 24, 22.6, -0.0003, 0.008) },
  { symbol: 'LTWG', name: 'Litware Gold Tracker', last: 176.4, change: 0.0072, spark: walk(17, 24, 175, 0.0004, 0.004) },
];

export const sampleRisk = {
  /** One-day 95% value at risk as a fraction of portfolio value. */
  var95: 0.0182,
  annualVolatility: 0.137,
  beta: 0.86,
  maxDrawdown: -0.064,
  sharpe: 1.12,
};

export function sampleMarketValue(position: SamplePosition): number {
  return position.quantity * position.lastPrice;
}

export function sampleUnrealised(position: SamplePosition): number {
  return position.quantity * (position.lastPrice - position.avgPrice);
}

export function sampleSummary() {
  const last = sampleEquityCurve[sampleEquityCurve.length - 1].value;
  const prev = sampleEquityCurve[sampleEquityCurve.length - 2].value;
  return {
    equity: last,
    dayChange: last - prev,
    dayChangePct: (last - prev) / prev,
    totalReturnPct: (last - SAMPLE_START_BALANCE) / SAMPLE_START_BALANCE,
    unrealised: samplePositions.reduce((sum, p) => sum + sampleUnrealised(p), 0),
  };
}
