import type { PricingAssumptions } from '../core/api/actuarial-api';
import { MAX_SEED, formFromAssumptions, newSeed, validateForm, validateSimulationSettings } from './assumption-form';

describe('simulation settings', () => {
  const base = { simulations: '50000', seed: '42', initialCapital: '10000', premiumCharged: '', label: '' };

  it('accepts the server ranges and omits an empty premium and label', () => {
    expect(validateSimulationSettings(base)).toEqual({ errors: {}, settings: { simulations: 50_000, seed: 42, initialCapital: 10_000 } });
    expect(validateSimulationSettings({ ...base, premiumCharged: '80000.5', label: ' Stress 1 ' }).settings).toEqual({
      simulations: 50_000,
      seed: 42,
      initialCapital: 10_000,
      premiumCharged: 80_000.5,
      label: 'Stress 1',
    });
    expect(validateSimulationSettings({ ...base, simulations: '1000', seed: String(MAX_SEED), initialCapital: '0' }).settings).not.toBeNull();
  });

  it('rejects sizes, seeds and labels the server would refuse', () => {
    const errors = validateSimulationSettings({ simulations: '200001', seed: '0', initialCapital: '-1', premiumCharged: '0', label: '<b>' }).errors;
    expect(Object.keys(errors).sort()).toEqual(['initialCapital', 'label', 'premiumCharged', 'seed', 'simulations']);
    expect(validateSimulationSettings({ ...base, seed: '1.5' }).errors.seed).toBe('Seed must be a whole number.');
  });

  it('draws seeds inside 1 … 2,147,483,647', () => {
    for (let i = 0; i < 200; i++) {
      const seed = newSeed();
      expect(Number.isInteger(seed) && seed >= 1 && seed <= MAX_SEED).toBe(true);
    }
  });
});

const reference: PricingAssumptions = {
  frequency: { family: 'BINOMIAL', policies: 1000, years: 1, probability: 0.05 },
  severity: { family: 'DETERMINISTIC', mean: 1200 },
  inflation: { annualRate: 0, years: 0 },
  expenses: { fixed: 20_000, perPolicy: 0, variableRate: 0 },
  profitMarginRate: 0,
  riskLoading: { method: 'EXPECTED_VALUE', parameter: 0.15 },
};

describe('assumption form', () => {
  it('shows rates in percent and round-trips to the API fractions exactly', () => {
    const form = formFromAssumptions(reference);
    expect(form.probabilityPct).toBe('5');
    expect(form.loadingParameter).toBe('15');
    const { assumptions, errors } = validateForm(form);
    expect(errors).toEqual({});
    expect(assumptions).toEqual(reference);
  });

  it('sends only the fields of the selected families', () => {
    const form = { ...formFromAssumptions(reference), frequencyFamily: 'POISSON' as const, intensity: '0.08', severityFamily: 'GAMMA' as const, cv: '0.9' };
    const { assumptions } = validateForm(form);
    expect(assumptions?.frequency).toEqual({ family: 'POISSON', policies: 1000, years: 1, intensity: 0.08 });
    expect(assumptions?.severity).toEqual({ family: 'GAMMA', mean: 1200, cv: 0.9 });
  });

  it('keeps the standard-deviation loading as a multiple, not a percent', () => {
    const form = { ...formFromAssumptions(reference), loadingMethod: 'STANDARD_DEVIATION' as const, loadingParameter: '0.5' };
    expect(validateForm(form).assumptions?.riskLoading).toEqual({ method: 'STANDARD_DEVIATION', parameter: 0.5 });
    const none = { ...form, loadingMethod: 'NONE' as const, loadingParameter: 'not a number' };
    expect(validateForm(none).assumptions?.riskLoading).toEqual({ method: 'NONE', parameter: 0 });
  });

  it('mirrors the server bounds with field-level messages', () => {
    const form = {
      ...formFromAssumptions(reference),
      policies: '10.5',
      probabilityPct: '60',
      meanCost: '',
      variablePct: '12.345',
      fixedExpenses: 'abc',
    };
    const { assumptions, errors } = validateForm(form);
    expect(assumptions).toBeNull();
    expect(errors.policies).toBe('Policies must be a whole number.');
    expect(errors.probabilityPct).toBe('Claim probability must be between 0.01 and 50.');
    expect(errors.meanCost).toBe('Average claim cost is required.');
    expect(errors.variablePct).toBe('Variable expenses allows at most 2 decimals.');
    expect(errors.fixedExpenses).toBe('Fixed expenses must be a number.');
  });

  it('ignores the hidden family field even when it is invalid', () => {
    const form = { ...formFromAssumptions(reference), intensity: '-1', cv: '' };
    expect(validateForm(form).errors).toEqual({});
  });
});
