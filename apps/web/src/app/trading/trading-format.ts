import { describeApiError, hasErrorCode } from '../core/api/errors';
import { formatNumber, formatPercent } from '../core/format/finance';

/* Formatting from apps/web/src/components/trading/parts.tsx: amounts are exact to the millime, so DT always shows 3 decimals. */

export function dt(value: number): string {
  return `${value < 0 ? '\u2212' : ''}${formatNumber(Math.abs(value), 3)} DT`;
}

export function signedDt(value: number): string {
  if (value > 0) return `+${dt(value)}`;
  return dt(value);
}

export function price(value: number | null | undefined): string {
  return value === null || value === undefined ? '\u2014' : formatNumber(value, 3);
}

export function pct(value: number | null | undefined, signed = false): string {
  return value === null || value === undefined ? '\u2014' : formatPercent(value, { signed });
}

export function units(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function shortTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
}

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

const SECTOR_LABEL: Record<string, string> = {
  Banking: 'Secteur bancaire',
  Utilities: 'Services aux collectivités',
  'Fixed income': 'Obligations',
  Technology: 'Technologies',
  Telecom: 'Télécoms',
  'Consumer staples': 'Biens de consommation de base',
  Materials: 'Matériaux',
  Energy: 'Énergie',
  Currencies: 'Devises',
  Equity: 'Actions',
};

/** Libellé d'affichage. Les identifiants (secteurs, classes) restent inchangés. */
export function sectorLabel(sector: string): string {
  return SECTOR_LABEL[sector] ?? sector;
}

/** Explains a failed request in plain language; maps the "migration pending" case explicitly. */
export function describeTradingError(error: unknown, fallback: string): string {
  if (hasErrorCode(error, 'DATABASE_SCHEMA_OUTDATED')) {
    return "Le trading virtuel n'est pas encore activé sur ce serveur : la migration de la base de données n'a pas été appliquée.";
  }
  return describeApiError(error, fallback);
}
