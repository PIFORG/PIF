import { formatNumber, formatPercent } from '../core/format/finance';

/* apps/web/src/components/actuarial/format.ts */

/** Amount in dinars, exact to the millime as the API reports it. */
export function tnd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return `${value < 0 ? '\u2212' : ''}${formatNumber(Math.abs(value), 3)} DT`;
}

/** Large portfolio totals without millimes, for headlines and chart axes. */
export function tndShort(value: number): string {
  return `${new Intl.NumberFormat('en-US', { notation: Math.abs(value) >= 1e6 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(value) >= 1e6 ? 2 : 0 }).format(value)} DT`;
}

/** Simulated amounts: whole dinars with grouping, never compact, so interval ends stay distinguishable. */
export function tndWhole(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return `${value < 0 ? '\u2212' : ''}${formatNumber(Math.abs(value), 0)} DT`;
}

export function ratio(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? '\u2014' : formatPercent(value, { digits });
}

/** Probabilities: tiny values are shown as a bound rather than rounding to a misleading 0.00%. */
export function probability(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  if (value > 0 && value < 0.0001) return '< 0.01%';
  if (value < 1 && value > 0.9999) return '> 99.99%';
  return formatPercent(value, { digits: 2 });
}

export function count(value: number, digits = 0): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function decimal(value: number, digits = 4): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}
