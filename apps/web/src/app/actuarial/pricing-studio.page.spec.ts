import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActuarialApi, type ActuarialPreset, type PricingAssumptions, type PricingResult } from '../core/api/actuarial-api';
import { change, getButton, getControl, getText, queryText, settle, waitFor } from './actuarial-testing';
import { PricingStudioPage } from './pricing-studio.page';

const reference: PricingAssumptions = {
  frequency: { family: 'BINOMIAL', policies: 1000, years: 1, probability: 0.05 },
  severity: { family: 'DETERMINISTIC', mean: 1200 },
  inflation: { annualRate: 0, years: 0 },
  expenses: { fixed: 20_000, perPolicy: 0, variableRate: 0 },
  profitMarginRate: 0,
  riskLoading: { method: 'EXPECTED_VALUE', parameter: 0.15 },
};

const headline = { grossPremium: 89_000, grossPremiumPerPolicy: 89, expectedClaims: 60_000, combinedRatio: 80 / 89, probabilityOfUnderwritingLoss: 0.1 };
const preset: ActuarialPreset = { id: 'reference-deterministic', name: 'Reference portfolio', description: 'Fictional reference.', provenance: 'FICTIONAL', assumptions: reference, headline };

function result(assumptions: PricingAssumptions): PricingResult {
  const lines = { purePremium: 60, riskLoading: 9, fixedExpenses: 20, technicalPremium: 89, variableExpenses: 0, profitMargin: 0, grossPremium: 89 };
  return {
    provenance: { kind: 'ESTIMATED', basis: 'Model estimate', modelVersion: 'pif-actuarial-1.0.0', currency: 'TND' },
    assumptions,
    trendFactor: 1,
    frequency: {
      family: assumptions.frequency.family,
      policies: 1000,
      years: 1,
      exposure: 1000,
      parameters: { n: 1000, periodProbability: 0.05 },
      mean: 50,
      variance: 47.5,
      sd: Math.sqrt(47.5),
      dispersionIndex: 0.95,
      probabilityNoClaim: 5e-23,
      probabilityPolicyClaims: 0.05,
      quantiles: [{ level: 0.5, value: 50 }],
      probabilityAboveMean: 0.46,
      distribution: { from: 30, binWidth: 1, probabilities: [0.01, 0.05, 0.1, 0.05, 0.01] },
    },
    severity: { family: 'DETERMINISTIC', mean: 1200, variance: 0, sd: 0, cv: 0, parameters: { value: 1200 }, quantiles: [{ level: 0.5, value: 1200 }], tailRatio: 1, exceedance: [], curve: null },
    aggregate: {
      mean: 60_000,
      variance: 68_400_000,
      sd: 8270.429,
      cv: 0.1378,
      distribution: { available: true, method: 'EXACT', span: 1200, capturedMass: 1, latticeMean: 60_000 },
      risk: [{ level: 0.995, valueAtRisk: 82_800, tailValueAtRisk: 85_000, normalApproximation: 81_303 }],
      exceedance: [],
      histogram: { from: 36_000, binWidth: 1200, probabilities: [0.1, 0.4, 0.4, 0.1] },
    },
    premium: {
      totals: {
        purePremium: 60_000,
        riskLoading: 9_000,
        fixedExpenses: 20_000,
        technicalPremium: 89_000,
        variableExpenses: 0,
        profitMargin: 0,
        grossPremium: 89_000,
        expectedUnderwritingResult: 9_000,
        claimsBudget: 69_000,
      },
      perPolicy: lines,
      purePremiumPerExposure: 60,
      ratios: { loss: 60 / 89, expense: 20 / 89, combined: 80 / 89 },
      underwritingMargin: 9 / 89,
    },
    probabilities: { underwritingLoss: 0.1, claimsExceedPremium: 0.001 },
    sensitivities: [{ driver: 'frequency', label: 'Fréquence des sinistres +10 %', repricedGrossPremium: 95_900, repricedPerPolicy: 95.9, premiumChange: 0.0775, resultAtBasePremium: 3_000 }],
    warnings: [],
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let api: {
  presets: ReturnType<typeof vi.fn>;
  price: ReturnType<typeof vi.fn>;
  scenarios: ReturnType<typeof vi.fn>;
  saveScenario: ReturnType<typeof vi.fn>;
  scenario: ReturnType<typeof vi.fn>;
  deleteScenario: ReturnType<typeof vi.fn>;
};

async function render() {
  TestBed.configureTestingModule({ imports: [PricingStudioPage], providers: [provideRouter([]), { provide: ActuarialApi, useValue: api }] });
  const fixture = TestBed.createComponent(PricingStudioPage);
  const root = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  await waitFor(fixture, () => getControl(root, 'Polices'));
  return { fixture, root };
}

describe('PricingStudio', () => {
  beforeEach(() => {
    api = {
      presets: vi.fn().mockResolvedValue({ modelVersion: 'pif-actuarial-1.0.0', currency: 'TND', presets: [preset] }),
      price: vi.fn().mockImplementation(async (assumptions: PricingAssumptions) => result(assumptions)),
      scenarios: vi.fn().mockResolvedValue({ limit: 50, scenarios: [] }),
      saveScenario: vi.fn(),
      scenario: vi.fn(),
      deleteScenario: vi.fn(),
    };
  });

  it('loads the reference preset and shows the server premium build-up', async () => {
    const { fixture, root } = await render();
    await waitFor(fixture, () => expect(api.price).toHaveBeenCalledTimes(1));
    expect(api.price.mock.calls[0][0]).toEqual(reference);
    await waitFor(fixture, () => expect(getText(root, '89,000 DT')).toBeTruthy());
    expect(getText(root, 'Prime brute (commerciale)')).toBeTruthy();
    expect(getText(root, /Estimations du modèle à partir d'hypothèses fictives/)).toBeTruthy();
    const link = (name: string) => Array.from(root.querySelectorAll('a')).find((a) => a.textContent?.trim() === name);
    expect(link('Laboratoire Monte Carlo')?.getAttribute('href')).toBe('/actuarial/monte-carlo');
    expect(link('Studio de provisionnement')?.getAttribute('href')).toBe('/actuarial/reserving');
    expect(getText(root, 'Laboratoire ALM').closest('[aria-disabled="true"]')).not.toBeNull();
  });

  it('validates locally and does not call the API with invalid input', async () => {
    const { fixture, root } = await render();
    await waitFor(fixture, () => expect(api.price).toHaveBeenCalledTimes(1));

    const policies = getControl(root, 'Polices');
    change(policies, '12.5');
    await sleep(400);
    await settle(fixture);
    expect(getText(root, 'Polices doit être un nombre entier.')).toBeTruthy();
    expect(policies.getAttribute('aria-invalid')).toBe('true');
    expect(queryText(root, 'Corrigez les champs signalés pour recalculer.')).not.toBeNull();
    expect(api.price).toHaveBeenCalledTimes(1);
  });

  it('switches to the Poisson model and debounces rapid edits into one request', async () => {
    const { fixture, root } = await render();
    await waitFor(fixture, () => expect(api.price).toHaveBeenCalledTimes(1));

    getButton(root, 'Poisson').click();
    await settle(fixture);
    const intensity = getControl(root, 'Sinistres par police-année');
    change(intensity, '0.1');
    change(intensity, '0.12');
    await sleep(400);
    await waitFor(fixture, () => expect(api.price).toHaveBeenCalledTimes(2));
    expect(api.price.mock.calls[1][0].frequency).toEqual({ family: 'POISSON', policies: 1000, years: 1, intensity: 0.12 });
    expect(getControl<HTMLSelectElement>(root, "Portefeuille d'exemple (fictif)").value).toBe('');
  });
});
