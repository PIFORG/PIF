import type { FrequencyFamily, PricingAssumptions, RiskLoadingMethod, SeverityFamily } from '../core/api/actuarial-api';

/**
 * apps/web/src/components/actuarial/assumptionForm.ts. Editable pricing assumptions as the user types them. Rates are
 * entered in percent and sent to the API as fractions; bounds mirror the server DTO so most mistakes are caught before a
 * request. The server remains the authority and re-validates everything.
 */
export interface AssumptionForm {
  frequencyFamily: FrequencyFamily;
  policies: string;
  years: string;
  probabilityPct: string;
  intensity: string;
  severityFamily: SeverityFamily;
  meanCost: string;
  cv: string;
  inflationPct: string;
  inflationYears: string;
  fixedExpenses: string;
  perPolicyExpenses: string;
  variablePct: string;
  marginPct: string;
  loadingMethod: RiskLoadingMethod;
  /** θ in percent for EXPECTED_VALUE, k as a multiple of sd(S) for STANDARD_DEVIATION. */
  loadingParameter: string;
}

export type FormErrors = Partial<Record<keyof AssumptionForm, string>>;

const fmt = (value: number) => String(Number(value.toFixed(8)));

export function formFromAssumptions(a: PricingAssumptions): AssumptionForm {
  return {
    frequencyFamily: a.frequency.family,
    policies: fmt(a.frequency.policies),
    years: fmt(a.frequency.years),
    probabilityPct: fmt((a.frequency.probability ?? 0.05) * 100),
    intensity: fmt(a.frequency.intensity ?? 0.05),
    severityFamily: a.severity.family,
    meanCost: fmt(a.severity.mean),
    cv: fmt(a.severity.cv ?? 1),
    inflationPct: fmt(a.inflation.annualRate * 100),
    inflationYears: fmt(a.inflation.years),
    fixedExpenses: fmt(a.expenses.fixed),
    perPolicyExpenses: fmt(a.expenses.perPolicy),
    variablePct: fmt(a.expenses.variableRate * 100),
    marginPct: fmt(a.profitMarginRate * 100),
    loadingMethod: a.riskLoading.method,
    loadingParameter: fmt(a.riskLoading.method === 'EXPECTED_VALUE' ? a.riskLoading.parameter * 100 : a.riskLoading.parameter),
  };
}

interface Rule {
  label: string;
  min: number;
  max: number;
  decimals: number;
  integer?: boolean;
}

const RULES = {
  policies: { label: 'Policies', min: 1, max: 1_000_000, decimals: 0, integer: true },
  years: { label: 'Cover period', min: 0.25, max: 5, decimals: 2 },
  probabilityPct: { label: 'Claim probability', min: 0.01, max: 50, decimals: 4 },
  intensity: { label: 'Claim frequency', min: 0.0001, max: 2, decimals: 6 },
  meanCost: { label: 'Average claim cost', min: 1, max: 10_000_000, decimals: 3 },
  cv: { label: 'Coefficient of variation', min: 0.05, max: 5, decimals: 4 },
  inflationPct: { label: 'Claim inflation', min: -5, max: 30, decimals: 2 },
  inflationYears: { label: 'Trend period', min: 0, max: 10, decimals: 2 },
  fixedExpenses: { label: 'Fixed expenses', min: 0, max: 100_000_000, decimals: 3 },
  perPolicyExpenses: { label: 'Expenses per policy', min: 0, max: 100_000, decimals: 3 },
  variablePct: { label: 'Variable expenses', min: 0, max: 50, decimals: 2 },
  marginPct: { label: 'Profit margin', min: 0, max: 30, decimals: 2 },
  loadingEv: { label: 'Chargement θ', min: 0, max: 100, decimals: 2 },
  loadingSd: { label: 'Chargement k', min: 0, max: 5, decimals: 4 },
} satisfies Record<string, Rule>;

const NUMBER = /^-?\d+(\.\d+)?$/;

function parse(raw: string, rule: Rule): { value: number } | { error: string } {
  const text = raw.trim();
  if (text === '') return { error: `${rule.label} is required.` };
  if (!NUMBER.test(text)) return { error: `${rule.label} must be a number.` };
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  if (rule.integer && decimals > 0) return { error: `${rule.label} must be a whole number.` };
  if (decimals > rule.decimals) return { error: `${rule.label} allows at most ${rule.decimals} decimals.` };
  const value = Number(text);
  if (value < rule.min || value > rule.max) return { error: `${rule.label} must be between ${rule.min.toLocaleString('en-US')} and ${rule.max.toLocaleString('en-US')}.` };
  return { value };
}

const fromPct = (value: number) => Number((value / 100).toFixed(8));

export function validateForm(form: AssumptionForm): { assumptions: PricingAssumptions | null; errors: FormErrors } {
  const errors: FormErrors = {};
  const read = (field: keyof AssumptionForm, rule: Rule): number => {
    const result = parse(String(form[field]), rule);
    if ('error' in result) {
      errors[field] = result.error;
      return NaN;
    }
    return result.value;
  };

  const policies = read('policies', RULES.policies);
  const years = read('years', RULES.years);
  const probability = form.frequencyFamily === 'BINOMIAL' ? fromPct(read('probabilityPct', RULES.probabilityPct)) : undefined;
  const intensity = form.frequencyFamily === 'POISSON' ? read('intensity', RULES.intensity) : undefined;
  const mean = read('meanCost', RULES.meanCost);
  const cv = form.severityFamily === 'DETERMINISTIC' ? undefined : read('cv', RULES.cv);
  const annualRate = fromPct(read('inflationPct', RULES.inflationPct));
  const inflationYears = read('inflationYears', RULES.inflationYears);
  const fixed = read('fixedExpenses', RULES.fixedExpenses);
  const perPolicy = read('perPolicyExpenses', RULES.perPolicyExpenses);
  const variableRate = fromPct(read('variablePct', RULES.variablePct));
  const profitMarginRate = fromPct(read('marginPct', RULES.marginPct));
  let parameter = 0;
  if (form.loadingMethod === 'EXPECTED_VALUE') parameter = fromPct(read('loadingParameter', RULES.loadingEv));
  if (form.loadingMethod === 'STANDARD_DEVIATION') parameter = read('loadingParameter', RULES.loadingSd);

  if (Object.keys(errors).length > 0) return { assumptions: null, errors };
  return {
    errors,
    assumptions: {
      frequency: form.frequencyFamily === 'BINOMIAL' ? { family: 'BINOMIAL', policies, years, probability } : { family: 'POISSON', policies, years, intensity },
      severity: form.severityFamily === 'DETERMINISTIC' ? { family: 'DETERMINISTIC', mean } : { family: form.severityFamily, mean, cv },
      inflation: { annualRate, years: inflationYears },
      expenses: { fixed, perPolicy, variableRate },
      profitMarginRate,
      riskLoading: { method: form.loadingMethod, parameter },
    },
  };
}

/** Monte Carlo run settings as typed. An empty premium means "use the model gross premium". */
export interface SimulationSettingsForm {
  simulations: string;
  seed: string;
  initialCapital: string;
  premiumCharged: string;
  label: string;
}

export type SimulationSettingsErrors = Partial<Record<keyof SimulationSettingsForm, string>>;

export interface SimulationSettings {
  simulations: number;
  seed: number;
  initialCapital: number;
  premiumCharged?: number;
  label?: string;
}

export const MAX_SEED = 2_147_483_647;
const SIMULATION_RULES: Record<'simulations' | 'seed' | 'initialCapital' | 'premiumCharged', Rule> = {
  simulations: { label: 'Simulations', min: 1_000, max: 200_000, decimals: 0, integer: true },
  seed: { label: 'Seed', min: 1, max: MAX_SEED, decimals: 0, integer: true },
  initialCapital: { label: 'Initial capital', min: 0, max: 10_000_000_000, decimals: 3 },
  premiumCharged: { label: 'Premium charged', min: 1, max: 100_000_000_000, decimals: 3 },
};
const RUN_LABEL = /^[\p{L}\p{N} .,'&()%+/-]{1,80}$/u;

export function validateSimulationSettings(form: SimulationSettingsForm): { settings: SimulationSettings | null; errors: SimulationSettingsErrors } {
  const errors: SimulationSettingsErrors = {};
  const read = (field: 'simulations' | 'seed' | 'initialCapital' | 'premiumCharged'): number => {
    const result = parse(form[field], SIMULATION_RULES[field]);
    if ('error' in result) {
      errors[field] = result.error;
      return NaN;
    }
    return result.value;
  };
  const simulations = read('simulations');
  const seed = read('seed');
  const initialCapital = read('initialCapital');
  const premiumCharged = form.premiumCharged.trim() === '' ? undefined : read('premiumCharged');
  const label = form.label.trim();
  if (label !== '' && !RUN_LABEL.test(label)) errors.label = "Use 1–80 letters, digits, spaces or . , ' & ( ) % + / -";
  if (Object.keys(errors).length > 0) return { settings: null, errors };
  return {
    errors,
    settings: {
      simulations,
      seed,
      initialCapital,
      ...(premiumCharged === undefined ? {} : { premiumCharged }),
      ...(label === '' ? {} : { label }),
    },
  };
}

/** A fresh seed from the browser's cryptographic generator, within the server's accepted range. */
export function newSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] % MAX_SEED) + 1;
}
