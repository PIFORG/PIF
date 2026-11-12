import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActuarialApi, type ActuarialPreset, type PricingAssumptions, type SimulationRunDetail } from '../core/api/actuarial-api';
import { ApiError } from '../core/api/types';
import { change, getButton, getControl, getText, queryText, settle, waitFor } from './actuarial-testing';
import { MonteCarloLabPage } from './monte-carlo-lab.page';

const reference: PricingAssumptions = {
  frequency: { family: 'BINOMIAL', policies: 1000, years: 1, probability: 0.05 },
  severity: { family: 'DETERMINISTIC', mean: 1200 },
  inflation: { annualRate: 0, years: 0 },
  expenses: { fixed: 20_000, perPolicy: 0, variableRate: 0 },
  profitMarginRate: 0,
  riskLoading: { method: 'EXPECTED_VALUE', parameter: 0.15 },
};
const preset: ActuarialPreset = {
  id: 'reference-deterministic',
  name: 'Reference portfolio',
  description: 'Fictional reference.',
  provenance: 'FICTIONAL',
  assumptions: reference,
  headline: { grossPremium: 89_000, grossPremiumPerPolicy: 89, expectedClaims: 60_000, combinedRatio: 80 / 89, probabilityOfUnderwritingLoss: 0.139 },
};

/** Fixture shaped like the API response; the figures are illustrative test data, not engine output. */
function runFixture(overrides: Partial<SimulationRunDetail> = {}): SimulationRunDetail {
  const prob = (simulated: number, exact: number) => ({
    simulated,
    interval: { lower: simulated - 0.003, upper: simulated + 0.003 },
    exact,
    withinInterval: true,
    count: Math.round(simulated * 50_000),
  });
  const headline = {
    mean: 60_012,
    valueAtRisk995: 81_600,
    tailValueAtRisk995: 84_100,
    probabilityClaimsExceedBudget: 0.1391,
    probabilityCapitalInsufficient: 0.0021,
    premiumCharged: 89_000,
    initialCapital: 10_000,
  };
  return {
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Reference run',
    engineVersion: 'pif-actuarial-mc-1.0.0',
    currency: 'TND',
    stale: false,
    seed: 12345,
    simulations: 50_000,
    durationMs: 210,
    portfolio: { frequency: 'BINOMIAL', severity: 'DETERMINISTIC', policies: 1000 },
    headline,
    createdAt: '2026-11-09T18:00:00.000Z',
    inputs: { assumptions: reference, initialCapital: 10_000, premiumCharged: null },
    results: {
      provenance: { kind: 'SIMULATED', basis: 'Monte Carlo simulation, seed 12345', modelVersion: 'pif-actuarial-mc-1.0.0', currency: 'TND' },
      engineVersion: 'pif-actuarial-mc-1.0.0',
      rng: 'mulberry32',
      seed: 12345,
      simulations: 50_000,
      thresholds: {
        premiumCharged: 89_000,
        premiumSource: 'MODEL',
        modelGrossPremium: 89_000,
        fixedExpenses: 20_000,
        variableExpenses: 0,
        claimsBudget: 69_000,
        initialCapital: 10_000,
        capitalThreshold: 79_000,
      },
      claimCount: { mean: 50.01, analyticMean: 50, max: 78 },
      statistics: { mean: 60_012, meanInterval: { lower: 59_939.5, upper: 60_084.5 }, sd: 8_270, median: 60_000, min: 31_200, max: 93_600, skewness: 0.13 },
      risk: [
        {
          level: 0.995,
          valueAtRisk: 81_600,
          valueAtRiskInterval: { lower: 80_400, upper: 82_800 },
          tailValueAtRisk: 84_100,
          tailValueAtRiskInterval: { lower: 83_500, upper: 84_700 },
          exactValueAtRisk: 81_600,
          exactTailValueAtRisk: 84_050,
          exactWithinInterval: true,
        },
      ],
      probabilities: { claimsExceedBudget: prob(0.1391, 0.138919), claimsExceedPremium: prob(0.0005, 0.0004), capitalInsufficient: prob(0.0021, 0.002) },
      expectedShortfall: 3.5,
      analytic: { mean: 60_000, sd: 8_270.43, distribution: { available: true, method: 'EXACT' }, meanWithinInterval: true },
      histogram: { from: 31_200, binWidth: 1_200, counts: [10, 200, 4_000, 20_000, 20_000, 5_000, 790], above: 0 },
      exceedanceCurve: [
        { threshold: 40_000, simulated: 0.99, exact: 0.99 },
        { threshold: 60_000, simulated: 0.5, exact: 0.5 },
        { threshold: 80_000, simulated: 0.01, exact: 0.01 },
      ],
      convergence: [
        { simulations: 1_250, mean: 60_200, lower: 59_700, upper: 60_700, probabilityClaimsExceedBudget: 0.14 },
        { simulations: 50_000, mean: 60_012, lower: 59_939.5, upper: 60_084.5, probabilityClaimsExceedBudget: 0.1391 },
      ],
    },
    ...overrides,
  };
}

const summary = (run: SimulationRunDetail) => {
  const { inputs, results, ...rest } = run;
  void inputs;
  void results;
  return rest;
};

let api: {
  presets: ReturnType<typeof vi.fn>;
  simulate: ReturnType<typeof vi.fn>;
  simulations: ReturnType<typeof vi.fn>;
  simulation: ReturnType<typeof vi.fn>;
  deleteSimulation: ReturnType<typeof vi.fn>;
};

async function render() {
  TestBed.configureTestingModule({ imports: [MonteCarloLabPage], providers: [provideRouter([]), { provide: ActuarialApi, useValue: api }] });
  const fixture = TestBed.createComponent(MonteCarloLabPage);
  const root = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  await waitFor(fixture, () => getControl(root, 'Polices'));
  return { fixture, root };
}

describe('MonteCarloLab', () => {
  beforeEach(() => {
    api = {
      presets: vi.fn().mockResolvedValue({ modelVersion: 'pif-actuarial-1.0.0', currency: 'TND', presets: [preset] }),
      simulate: vi.fn(),
      simulations: vi.fn().mockResolvedValue({ kept: 25, runs: [] }),
      simulation: vi.fn(),
      deleteSimulation: vi.fn(),
    };
  });

  it('shows no results until the server has completed a run, then labels them as simulated', async () => {
    let finish: (run: SimulationRunDetail) => void = () => undefined;
    api.simulate.mockReturnValue(new Promise<SimulationRunDetail>((resolve) => (finish = resolve)));
    const { fixture, root } = await render();
    expect(getText(root, 'Aucune simulation')).toBeTruthy();

    getButton(root, /Lancer la simulation/).click();
    await waitFor(fixture, () => expect(api.simulate).toHaveBeenCalledTimes(1));
    expect(api.simulate.mock.calls[0][0]).toEqual({ assumptions: reference, simulations: 50_000, seed: 12345, initialCapital: 10_000 });
    await settle(fixture);
    expect(getText(root, /Simulation de 50,000 périodes sur le serveur/)).toBeTruthy();
    expect(queryText(root, 'Moyenne simulée E[S]')).toBeNull();

    finish(runFixture());
    await waitFor(fixture, () => expect(getText(root, 'Moyenne simulée E[S]')).toBeTruthy());
    expect(getText(root, /Valeurs simulées à partir d'hypothèses fictives/)).toBeTruthy();
    expect(getText(root, 'Simulé contre exact')).toBeTruthy();
    expect(getText(root, 'P(S > budget + capital)')).toBeTruthy();
    expect(getText(root, 'Exécution affichée, graine 12345.')).toBeTruthy();
    await waitFor(fixture, () => expect(api.simulations).toHaveBeenCalledTimes(2));
  });

  it('validates the run settings locally and sends an entered premium and label', async () => {
    api.simulate.mockResolvedValue(runFixture());
    const { fixture, root } = await render();

    change(getControl(root, 'Périodes simulées'), '999');
    await settle(fixture);
    expect(getText(root, 'Périodes simulées doit être compris entre 1,000 et 200,000.')).toBeTruthy();
    expect(getButton(root, /Lancer la simulation/).disabled).toBe(true);
    expect(getText(root, 'Corrigez les champs signalés pour lancer la simulation.')).toBeTruthy();

    change(getControl(root, 'Périodes simulées'), '20000');
    change(getControl(root, 'Prime encaissée (DT)'), '80000');
    change(getControl(root, 'Libellé de l\'exécution (facultatif)'), 'Cheaper premium');
    await settle(fixture);
    getButton(root, /Lancer la simulation/).click();
    await waitFor(fixture, () => expect(api.simulate).toHaveBeenCalledTimes(1));
    expect(api.simulate.mock.calls[0][0]).toMatchObject({ simulations: 20_000, premiumCharged: 80_000, label: 'Cheaper premium' });
  });

  it('draws a new seed within the accepted range and flags results whose inputs have changed', async () => {
    api.simulate.mockResolvedValue(runFixture());
    const { fixture, root } = await render();
    getButton(root, /Lancer la simulation/).click();
    await waitFor(fixture, () => expect(getText(root, 'Moyenne simulée E[S]')).toBeTruthy());

    getButton(root, /Nouvelle graine/).click();
    await settle(fixture);
    const seed = Number(getControl(root, 'Graine').value);
    expect(Number.isInteger(seed) && seed >= 1 && seed <= 2_147_483_647).toBe(true);
    expect(getText(root, /Les entrées ont changé depuis ; relancez la simulation pour recalculer/)).toBeTruthy();
  });

  it('loads a stored run with its inputs and reports server errors in plain English', async () => {
    const stored = runFixture({
      label: 'Stored run',
      seed: 777,
      inputs: { assumptions: { ...reference, frequency: { ...reference.frequency, policies: 2000 } }, initialCapital: 5_000, premiumCharged: 95_000 },
    });
    api.simulations.mockResolvedValue({ kept: 25, runs: [summary(stored)] });
    api.simulation.mockResolvedValue(stored);
    api.simulate.mockRejectedValue(new ApiError(503, 'The simulation service is busy. Try again in a few seconds.', 'SIMULATION_BUSY'));
    const { fixture, root } = await render();

    await waitFor(fixture, () => getButton(root, 'Charger Stored run'));
    getButton(root, 'Charger Stored run').click();
    await waitFor(fixture, () =>
      expect(getText(root, /Chargement de « Stored run »\. Résultats enregistrés/)).toBeTruthy(),
    );
    expect(getControl(root, 'Polices').value).toBe('2000');
    expect(getControl(root, 'Graine').value).toBe('777');
    expect(getControl(root, 'Prime encaissée (DT)').value).toBe('95000');
    expect(getControl(root, 'Capital initial (DT)').value).toBe('5000');
    expect(queryText(root, /The inputs have changed since/)).toBeNull();

    getButton(root, /Lancer la simulation/).click();
    await waitFor(fixture, () => expect(getText(root, 'The simulation service is busy. Try again in a few seconds.')).toBeTruthy());
  });
});
