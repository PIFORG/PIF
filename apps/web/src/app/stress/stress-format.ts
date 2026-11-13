/** French number formatting for the stress-testing screens (amounts in M DT, ratios as fractions). */

const MINUS = '−';

function fr(value: number, digits: number): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
}

function sign(value: number, text: string, signed: boolean): string {
  if (value < 0 && text !== fr(0, 0) && !/^0(,0+)?$/.test(text)) return `${MINUS}${text}`;
  return signed && value > 0 ? `+${text}` : text;
}

/** 1 014,9 M DT */
export function mdt(value: number, digits = 1, signed = false): string {
  return `${sign(value, fr(value, digits), signed)}\u00a0M\u00a0DT`;
}

/** A ratio as a percentage: 0.1348 → 13,48 % */
export function ratio(value: number, digits = 2): string {
  return `${sign(value, fr(value * 100, digits), false)}\u00a0%`;
}

/** A probability with enough precision for small PDs: 0.015 → 1,50 % */
export function prob(value: number): string {
  return ratio(value, 2);
}

/** A change in a ratio, in percentage points: −0.0215 → −2,15 pp */
export function pp(value: number, digits = 2): string {
  return `${sign(value, fr(value * 100, digits), true)}\u00a0pp`;
}

/** A value already expressed in percentage points: −2.1534 → −2,15 pp */
export function pts(value: number, digits = 2): string {
  return `${sign(value, fr(value, digits), true)}\u00a0pp`;
}

/** A plain number in French notation. */
export function num(value: number, digits = 0): string {
  return sign(value, fr(value, digits), false);
}
