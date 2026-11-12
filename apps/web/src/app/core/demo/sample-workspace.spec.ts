import {
  SAMPLE_CURRENCY,
  SAMPLE_DATA_NOTICE,
  sampleAllocation,
  sampleCash,
  sampleEquityCurve,
  sampleMarketValue,
  samplePositions,
  sampleSummary,
  sampleWatchlist,
} from './sample-workspace';

describe('sample workspace fixtures', () => {
  it('declares itself as sample data', () => {
    expect(SAMPLE_DATA_NOTICE).toMatch(/exemple/i);
    expect(SAMPLE_DATA_NOTICE).toMatch(/données de marché/i);
  });

  it('is deterministic and internally consistent', () => {
    expect(sampleEquityCurve).toHaveLength(64);
    expect(sampleSummary().equity).toBe(sampleEquityCurve[63].value);
    const weights = sampleAllocation.reduce((sum, a) => sum + a.weight, 0);
    expect(weights).toBeCloseTo(1, 6);
  });

  it('adds up: positions plus cash equal the portfolio value, and the allocation matches the positions', () => {
    const equity = sampleSummary().equity;
    const invested = samplePositions.reduce((sum, p) => sum + sampleMarketValue(p), 0);
    expect(sampleCash()).toBeGreaterThan(0);
    expect(invested + sampleCash()).toBeCloseTo(equity, 6);
    const weight = (label: string) => sampleAllocation.find((a) => a.label === label)?.weight;
    const equities = samplePositions.filter((p) => p.assetClass === 'Equity').reduce((sum, p) => sum + sampleMarketValue(p), 0);
    expect(weight('Actions')).toBeCloseTo(equities / equity, 9);
    expect(weight('Liquidités')).toBeCloseTo(sampleCash() / equity, 9);
    expect(sampleSummary().unrealised).toBeCloseTo(
      samplePositions.reduce((s, p) => s + p.quantity * (p.lastPrice - p.avgPrice), 0),
      6,
    );
  });

  it('quotes agree with positions and their own sparklines', () => {
    for (const q of sampleWatchlist) {
      expect(q.spark[q.spark.length - 1]).toBe(q.last);
      expect(q.change).toBeCloseTo((q.last - q.spark[q.spark.length - 2]) / q.spark[q.spark.length - 2], 12);
      const held = samplePositions.find((p) => p.symbol === q.symbol);
      if (held) expect(held.lastPrice).toBe(q.last);
    }
  });

  it('uses the fictional Tunisian universe shared with the learning missions, in dinars', () => {
    expect(SAMPLE_CURRENCY).toBe('TND');
    const symbols = [...samplePositions, ...sampleWatchlist].map((p) => p.symbol);
    expect(symbols.every((s) => ['CTB', 'MDX', 'OLV', 'SFX', 'TEK', 'ATL', 'GOV'].includes(s))).toBe(true);
  });
});
