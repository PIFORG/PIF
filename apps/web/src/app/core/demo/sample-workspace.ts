/**
 * SAMPLE DATA — fictitious instruments and values for design previews only (apps/web/src/lib/demo/sampleWorkspace.ts).
 * Never present these as market data, account balances or results. Every surface that renders them must show a
 * visible "Sample data" label (mtr-demo-label).
 *
 * The instruments are the simulator's fictional Tunisian universe, the same one the learning missions trade. None is
 * a real listed company.
 */

export const SAMPLE_DATA_NOTICE =
  "Données d'exemple uniquement. Instruments et valeurs fictifs — ce ne sont ni des données de marché, ni votre compte.";

export const SAMPLE_CURRENCY = 'TND';

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

export interface SamplePosition {
  symbol: string;
  name: string;
  assetClass: string;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
}

export const samplePositions: SamplePosition[] = [
  { symbol: 'CTB', name: 'Carthage Bank', assetClass: 'Equity', quantity: 400, avgPrice: 40.1, lastPrice: 42.5 },
  { symbol: 'OLV', name: 'Olivia Foods', assetClass: 'Equity', quantity: 1200, avgPrice: 9.6, lastPrice: 9.85 },
  { symbol: 'TEK', name: 'TunisTech', assetClass: 'Equity', quantity: 300, avgPrice: 25.8, lastPrice: 27.4 },
  { symbol: 'SFX', name: 'Sfax Phosphates', assetClass: 'Equity', quantity: 100, avgPrice: 66.2, lastPrice: 63 },
  { symbol: 'GOV', name: 'Treasury Bond Fund', assetClass: 'Fixed income', quantity: 250, avgPrice: 99.4, lastPrice: 100 },
];

export interface SampleQuote {
  symbol: string;
  name: string;
  last: number;
  change: number;
  spark: number[];
}

/** A quote whose sparkline ends exactly at `last` and whose change is the sparkline's last move. */
function quote(symbol: string, name: string, last: number, seed: number, drift: number, vol: number): SampleQuote {
  const path = walk(seed, 24, last, drift, vol);
  const scale = last / path[path.length - 1];
  const spark = path.map((v) => Math.round(v * scale * 100) / 100);
  spark[spark.length - 1] = last;
  return { symbol, name, last, change: (last - spark[spark.length - 2]) / spark[spark.length - 2], spark };
}

export const sampleWatchlist: SampleQuote[] = [
  quote('CTB', 'Carthage Bank', 42.5, 3, 0.0006, 0.006),
  quote('TEK', 'TunisTech', 27.4, 5, -0.0008, 0.009),
  quote('MDX', 'Medina Telecom', 18.2, 11, 0.0002, 0.005),
  quote('ATL', 'Atlas Utilities', 14.6, 13, -0.0003, 0.004),
  quote('SFX', 'Sfax Phosphates', 63, 17, 0.0004, 0.008),
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

/** Cash is whatever the portfolio value does not hold in positions, so the parts always add up. */
export function sampleCash(): number {
  const equity = sampleEquityCurve[sampleEquityCurve.length - 1].value;
  return equity - samplePositions.reduce((sum, p) => sum + sampleMarketValue(p), 0);
}

const ALLOCATION_LABEL: Record<string, string> = { Equity: 'Actions', 'Fixed income': 'Obligations' };

export const sampleAllocation: SampleAllocation[] = (() => {
  const equity = sampleEquityCurve[sampleEquityCurve.length - 1].value;
  const byClass = new Map<string, number>();
  for (const p of samplePositions) {
    const label = ALLOCATION_LABEL[p.assetClass] ?? p.assetClass;
    byClass.set(label, (byClass.get(label) ?? 0) + sampleMarketValue(p));
  }
  return [...byClass.entries(), ['Liquidités', sampleCash()] as [string, number]].map(([label, value]) => ({
    label,
    weight: value / equity,
  }));
})();

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
