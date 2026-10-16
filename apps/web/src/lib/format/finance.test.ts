import { describe, expect, it } from 'vitest';
import { directionOf, formatMoney, formatPercent, formatSignedMoney } from './finance';

describe('finance formatters', () => {
  it('formats currency with two decimals', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(1250000, 'USD', { compact: true })).toBe('$1.3M');
  });

  it('signs money and percentages explicitly', () => {
    expect(formatSignedMoney(12.3, 'USD')).toBe('+$12.30');
    expect(formatSignedMoney(-12.3, 'USD')).toBe('\u2212$12.30');
    expect(formatSignedMoney(0, 'USD')).toBe('$0.00');
    expect(formatPercent(0.0123, { signed: true })).toBe('+1.23%');
    expect(formatPercent(-0.05, { signed: true })).toBe('\u22125.00%');
    expect(formatPercent(0.137, { digits: 1 })).toBe('13.7%');
  });

  it('derives a direction that never relies on colour alone', () => {
    expect(directionOf(1)).toBe('up');
    expect(directionOf(-1)).toBe('down');
    expect(directionOf(0)).toBe('flat');
  });
});
