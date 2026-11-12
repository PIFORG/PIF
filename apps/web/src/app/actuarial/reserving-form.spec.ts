import type { ReservingLimits } from '../core/api/actuarial-api';
import { formFromInputs, formatTriangle, parseTriangle, resizeSelections, validateReservingForm } from './reserving-form';

const limits: ReservingLimits = {
  minOrigins: 3,
  maxOrigins: 25,
  minFirstOrigin: 1950,
  maxFirstOrigin: 2100,
  maxAmount: 1e12,
  minFactor: 0.1,
  maxFactor: 100,
  minTail: 0.5,
  maxTail: 3,
  minLossRatio: 0.01,
  maxLossRatio: 5,
};
const data = { firstOrigin: 2023, paid: [[100, 150, 165], [120, null], [130]], incurred: null, premiums: [200, 220, 240] };
const assumptions = {
  average: 'VOLUME_WEIGHTED' as const,
  latestDiagonals: null,
  tail: { paid: 1, incurred: 1 },
  selectedFactors: { paid: [null, 1.1], incurred: null },
  expectedLossRatio: 0.8,
};

describe('parseTriangle', () => {
  it('reads spaces, tabs, semicolons and grouped thousands; a dash or an empty tab cell is missing, never zero', () => {
    expect(parseTriangle('1,200 1,500.5 0\n2 -\n3')).toEqual({ rows: [[1200, 1500.5, 0], [2, null], [3]] });
    expect(parseTriangle('1\t\t3\t\t\n4;5\n6\n\n')).toEqual({ rows: [[1, null, 3], [4, 5], [6]] });
    expect(parseTriangle('1 n/a –\n2')).toEqual({ rows: [[1, null, null], [2]] });
  });

  it('rejects text that is not a number and an empty paste', () => {
    expect(parseTriangle('1 2x')).toEqual({ error: "Ligne 1, montant 2 : « 2x » n'est pas un nombre. Écrivez un montant manquant avec -." });
    expect(parseTriangle('  \n ')).toEqual({ error: 'Collez une ligne de montants cumulés par année de survenance.' });
  });
});

describe('reserving form', () => {
  it('round-trips stored inputs into the same request', () => {
    const form = formFromInputs(data, assumptions);
    expect(form.paid).toBe(formatTriangle(data.paid));
    expect(form.lossRatioPct).toBe('80');
    expect(form.selectedPaid).toEqual(['', '1.1']);
    expect(validateReservingForm(form, limits)).toEqual({ request: { data, assumptions }, errors: {} });
  });

  it('flags out-of-range assumptions and drops selections when the triangle changes size', () => {
    const form = { ...formFromInputs(data, assumptions), tailPaid: '9', average: 'LATEST_DIAGONALS' as const, latestDiagonals: '3' };
    const { request, errors } = validateReservingForm(form, limits);
    expect(request).toBeNull();
    expect(errors['tailPaid']).toBe('Le facteur de queue des paiements doit être un nombre compris entre 0.5 et 3.');
    expect(errors['latestDiagonals']).toBe('Le nombre de dernières années calendaires doit être un nombre entier compris entre 1 et 2.');

    const grown = resizeSelections({ ...form, paid: '1 2 3 4\n1 2 3\n1 2\n1' });
    expect(grown.selectedPaid).toEqual(['', '', '']);
  });
});
