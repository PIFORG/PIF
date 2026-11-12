/** apps/web/src/lib/format/finance.ts */
const LOCALE = 'fr-TN';

export function formatMoney(value: number, currency = 'USD', options: { compact?: boolean } = {}): string {
  if (currency === 'TND') {
    // The simulated market quotes in dinars with the local "DT" suffix, matching the learning module.
    const text = new Intl.NumberFormat(LOCALE, {
      notation: options.compact ? 'compact' : 'standard',
      maximumFractionDigits: options.compact ? 1 : 2,
      minimumFractionDigits: options.compact ? 0 : 2,
    }).format(Math.abs(value));
    return `${value < 0 ? '\u2212' : ''}${text} DT`;
  }
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      notation: options.compact ? 'compact' : 'standard',
      maximumFractionDigits: options.compact ? 1 : 2,
      minimumFractionDigits: options.compact ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Signed money with an explicit "+" for gains, e.g. "+$1,240.00". */
export function formatSignedMoney(value: number, currency = 'USD'): string {
  const abs = formatMoney(Math.abs(value), currency);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `\u2212${abs}`;
  return abs;
}

/** `value` is a ratio: 0.0123 → "+1.23%". */
export function formatPercent(value: number, options: { signed?: boolean; digits?: number } = {}): string {
  const { signed = false, digits = 2 } = options;
  const text = new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
  if (!signed || value === 0) return value < 0 ? `\u2212${text}` : text;
  return value > 0 ? `+${text}` : `\u2212${text}`;
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDateTime(iso: string | Date, timeZone?: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
}

export type Direction = 'up' | 'down' | 'flat';

export function directionOf(value: number): Direction {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}
