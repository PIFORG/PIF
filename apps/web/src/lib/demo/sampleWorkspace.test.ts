import { describe, expect, it } from 'vitest';
import {
  SAMPLE_DATA_NOTICE,
  sampleAllocation,
  sampleEquityCurve,
  samplePositions,
  sampleSummary,
} from './sampleWorkspace';

describe('sample workspace fixtures', () => {
  it('declares itself as sample data', () => {
    expect(SAMPLE_DATA_NOTICE).toMatch(/sample/i);
    expect(SAMPLE_DATA_NOTICE).toMatch(/not market data/i);
  });

  it('is deterministic and internally consistent', () => {
    expect(sampleEquityCurve).toHaveLength(64);
    expect(sampleSummary().equity).toBe(sampleEquityCurve[63].value);
    const weights = sampleAllocation.reduce((sum, a) => sum + a.weight, 0);
    expect(weights).toBeCloseTo(1, 6);
  });

  it('uses fictitious instruments only', () => {
    const names = samplePositions.map((p) => p.name).join(' ');
    expect(names).toMatch(/Northwind|Contoso|Woodgrove|Fabrikam|Litware/);
  });
});
