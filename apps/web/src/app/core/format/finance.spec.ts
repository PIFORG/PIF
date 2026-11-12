import { directionOf, formatMoney, formatPercent, formatSignedMoney } from './finance';

describe('finance formatters', () => {
  it('formats currency with two decimals', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('1\u202f234,50\u00a0$US');
    expect(formatMoney(1250000, 'USD', { compact: true })).toBe('1,3\u00a0M\u00a0$US');
  });

  it('writes Tunisian dinars as "DT", like the simulated market', () => {
    expect(formatMoney(106447.9, 'TND')).toBe('106\u202f447,90 DT');
    expect(formatMoney(106447.9, 'TND', { compact: true })).toBe('106,4\u00a0k DT');
    expect(formatSignedMoney(960, 'TND')).toBe('+960,00 DT');
    expect(formatSignedMoney(-34.43, 'TND')).toBe('\u221234,43 DT');
  });

  it('signs money and percentages explicitly', () => {
    expect(formatSignedMoney(12.3, 'USD')).toBe('+12,30\u00a0$US');
    expect(formatSignedMoney(-12.3, 'USD')).toBe('\u221212,30\u00a0$US');
    expect(formatSignedMoney(0, 'USD')).toBe('0,00\u00a0$US');
    expect(formatPercent(0.0123, { signed: true })).toBe('+1,23\u00a0%');
    expect(formatPercent(-0.05, { signed: true })).toBe('\u22125,00\u00a0%');
    expect(formatPercent(0.137, { digits: 1 })).toBe('13,7\u00a0%');
  });

  it('derives a direction that never relies on colour alone', () => {
    expect(directionOf(1)).toBe('up');
    expect(directionOf(-1)).toBe('down');
    expect(directionOf(0)).toBe('flat');
  });
});
