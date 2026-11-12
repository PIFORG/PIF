import type { Cell, FactorAverage, ReservingAssumptions, ReservingData, ReservingLimits, ReservingRequest } from '../core/api/actuarial-api';

/**
 * apps/web/src/components/actuarial/reservingForm.ts. Reserving inputs as the user types them. Triangles are pasted as
 * text, one line per accident year; parsing only turns text into numbers. The shape of the triangles and every figure
 * are checked and computed by the server.
 */
export interface ReservingForm {
  firstOrigin: string;
  paid: string;
  incurred: string;
  premiums: string;
  average: FactorAverage;
  latestDiagonals: string;
  tailPaid: string;
  tailIncurred: string;
  lossRatioPct: string;
  /** Selected factor per development period; an empty string keeps the estimate. */
  selectedPaid: string[];
  selectedIncurred: string[];
}

export type ReservingFormErrors = Record<string, string>;

const MISSING = new Set(['-', '\u2013', '\u2014', 'na', 'n/a']);
const GROUPED = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const fmt = (value: number) => String(Number(value.toFixed(8)));

export function formatTriangle(rows: Cell[][]): string {
  return rows.map((row) => row.map((c) => (c === null ? '-' : fmt(c))).join(' ')).join('\n');
}

function parseAmount(token: string): number | null | undefined {
  const t = token.trim();
  if (MISSING.has(t.toLowerCase())) return null;
  const value = Number(GROUPED.test(t) ? t.replace(/,/g, '') : t);
  return t !== '' && Number.isFinite(value) ? value : undefined;
}

/** Splits a line on tabs or semicolons when present (empty cells are missing), otherwise on spaces. */
function splitLine(line: string): string[] {
  const tokens = /[\t;]/.test(line) ? line.split(/[\t;]/).map((t) => t.trim()) : line.trim().split(/\s+/);
  while (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();
  return tokens;
}

export function parseTriangle(text: string): { rows: Cell[][] } | { error: string } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { error: 'Paste one line of cumulative amounts per accident year.' };
  const rows: Cell[][] = [];
  for (const [i, line] of lines.entries()) {
    const row: Cell[] = [];
    for (const [j, token] of splitLine(line).entries()) {
      const value = parseAmount(token === '' ? '-' : token);
      if (value === undefined) return { error: `Line ${i + 1}, amount ${j + 1}: “${token}” is not a number. Write a missing amount as -.` };
      row.push(value);
    }
    rows.push(row);
  }
  return { rows };
}

function parseList(text: string): { values: number[] } | { error: string } {
  const tokens = text.split(/[\s;]+/).filter((t) => t !== '');
  const values: number[] = [];
  for (const [i, token] of tokens.entries()) {
    const value = parseAmount(token);
    if (value === undefined || value === null) return { error: `Amount ${i + 1}: “${token}” is not a number.` };
    values.push(value);
  }
  return { values };
}

export function formFromInputs(data: ReservingData, assumptions: ReservingAssumptions): ReservingForm {
  const n = data.paid.length;
  const selected = (list: Cell[] | null) => Array.from({ length: n - 1 }, (_, j) => (list?.[j] == null ? '' : fmt(list[j] as number)));
  return {
    firstOrigin: String(data.firstOrigin),
    paid: formatTriangle(data.paid),
    incurred: data.incurred ? formatTriangle(data.incurred) : '',
    premiums: data.premiums ? data.premiums.map(fmt).join(' ') : '',
    average: assumptions.average,
    latestDiagonals: assumptions.latestDiagonals === null ? String(Math.min(3, n - 1)) : String(assumptions.latestDiagonals),
    tailPaid: fmt(assumptions.tail.paid),
    tailIncurred: fmt(assumptions.tail.incurred),
    lossRatioPct: assumptions.expectedLossRatio === null ? '' : fmt(assumptions.expectedLossRatio * 100),
    selectedPaid: selected(assumptions.selectedFactors.paid),
    selectedIncurred: selected(assumptions.selectedFactors.incurred),
  };
}

export function validateReservingForm(form: ReservingForm, limits: ReservingLimits): { request: ReservingRequest | null; errors: ReservingFormErrors } {
  const errors: ReservingFormErrors = {};
  const number = (key: keyof ReservingForm, label: string, min: number, max: number, integer = false): number | null => {
    const raw = String(form[key]).trim();
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
      errors[key] = `${label} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`;
      return null;
    }
    return value;
  };

  const firstOrigin = number('firstOrigin', 'The first accident year', limits.minFirstOrigin, limits.maxFirstOrigin, true);
  const paid = parseTriangle(form.paid);
  if ('error' in paid) errors['paid'] = paid.error;
  let incurred: Cell[][] | null = null;
  if (form.incurred.trim() !== '') {
    const parsed = parseTriangle(form.incurred);
    if ('error' in parsed) errors['incurred'] = parsed.error;
    else incurred = parsed.rows;
  }
  let premiums: number[] | null = null;
  if (form.premiums.trim() !== '') {
    const parsed = parseList(form.premiums);
    if ('error' in parsed) errors['premiums'] = parsed.error;
    else premiums = parsed.values;
  }
  const n = 'rows' in paid ? paid.rows.length : 0;
  const latestDiagonals = form.average === 'LATEST_DIAGONALS' ? number('latestDiagonals', 'The number of latest calendar years', 1, Math.max(1, n - 1), true) : null;
  const tailPaid = number('tailPaid', 'The paid tail factor', limits.minTail, limits.maxTail);
  const tailIncurred = number('tailIncurred', 'The incurred tail factor', limits.minTail, limits.maxTail);
  let expectedLossRatio: number | null = null;
  if (form.lossRatioPct.trim() !== '') {
    const pct = number('lossRatioPct', 'The expected loss ratio', limits.minLossRatio * 100, limits.maxLossRatio * 100);
    expectedLossRatio = pct === null ? null : pct / 100;
  }

  const selected = (values: string[], key: 'selectedPaid' | 'selectedIncurred'): Cell[] | null => {
    if (values.length !== n - 1 || values.every((v) => v.trim() === '')) return null;
    return values.map((raw, j) => {
      if (raw.trim() === '') return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < limits.minFactor || value > limits.maxFactor) {
        errors[`${key}-${j}`] = `Enter a factor from ${limits.minFactor} to ${limits.maxFactor}, or leave it empty to use the estimate.`;
        return null;
      }
      return value;
    });
  };
  const selectedFactors = { paid: selected(form.selectedPaid, 'selectedPaid'), incurred: incurred ? selected(form.selectedIncurred, 'selectedIncurred') : null };

  if (Object.keys(errors).length > 0 || !('rows' in paid) || firstOrigin === null || tailPaid === null || tailIncurred === null) return { request: null, errors };
  return {
    request: {
      data: { firstOrigin, paid: paid.rows, incurred, premiums },
      assumptions: { average: form.average, latestDiagonals, tail: { paid: tailPaid, incurred: tailIncurred }, selectedFactors, expectedLossRatio },
    },
    errors,
  };
}

/** Keeps the selected-factor lists the length of the triangle: one entry per development period. */
export function resizeSelections(form: ReservingForm): ReservingForm {
  const parsed = parseTriangle(form.paid);
  const periods = 'rows' in parsed ? Math.max(0, parsed.rows.length - 1) : form.selectedPaid.length;
  const fit = (list: string[]) => (list.length === periods ? list : Array.from({ length: periods }, () => ''));
  return { ...form, selectedPaid: fit(form.selectedPaid), selectedIncurred: fit(form.selectedIncurred) };
}
