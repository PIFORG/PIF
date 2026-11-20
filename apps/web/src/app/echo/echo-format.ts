import type { EchoEvidence } from '../core/echo/echo-api';

const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf3 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

export function pct(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${nf1.format(v * 100)} %` : '—';
}

function scalar(v: unknown, unit: string | null): string {
  if (v === null || v === undefined) return 'Indisponible';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'Indisponible';
    if (unit === 'ratio') return pct(v);
    if (unit === '%') return `${nf1.format(v)} %`;
    if (unit === '/100') return `${nf1.format(v)} / 100`;
    if (unit && /^[A-Z]{3}$/.test(unit)) return `${nf2.format(v)} ${unit}`;
    return Math.abs(v) >= 100 ? nf2.format(v) : nf3.format(v);
  }
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return String(v);
}

/** Renders an evidence value without inventing precision. before/after pairs become "a → b". */
export function evidenceValue(e: EchoEvidence): string {
  const v = e.value;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ('before' in o && 'after' in o) return `${scalar(o['before'], e.unit)} → ${scalar(o['after'], e.unit)}`;
    return Object.entries(o)
      .filter(([, x]) => x !== null && typeof x !== 'object')
      .map(([k, x]) => `${k} : ${scalar(x, null)}`)
      .join(' · ');
  }
  return scalar(v, e.unit);
}

export function cell(key: string, v: unknown): string {
  if (typeof v !== 'number') return v === null || v === undefined ? '—' : String(v);
  if (['largestWeight', 'weight', 'returnPct', 'annualVol', 'maxDrawdown', 'exposure'].includes(key)) return pct(v);
  if (key === 'effectiveHoldings') return nf1.format(v);
  return nf2.format(v);
}

export const COLUMN_LABELS: Record<string, string> = {
  label: '',
  cash: 'Liquidités',
  equity: 'Capitaux',
  largestWeight: 'Plus grande ligne',
  effectiveHoldings: 'Positions eff.',
  value: 'Valeur',
  impact: 'Impact',
  returnPct: 'Perf.',
  annualVol: 'Vol. ann.',
  maxDrawdown: 'Baisse max.',
  observations: 'Obs.',
  score: 'Score',
  weight: 'Poids',
};

export const STATUS_LABELS: Record<string, string> = {
  COMPLETE: '',
  PARTIAL: 'Réponse partielle',
  NO_DATA: 'Donnée indisponible',
  CLARIFICATION: 'Précision nécessaire',
  REFUSED: 'Demande refusée',
  ERROR: 'Service indisponible',
};
