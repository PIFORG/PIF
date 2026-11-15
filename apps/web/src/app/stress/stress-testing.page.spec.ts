import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import {
  StressApi,
  type BankId,
  type AiEstimate,
  type BankRun,
  type ModelCard,
  type StressCatalog,
  type StressFactorValues,
  type StressRunResult,
} from '../core/api/stress-api';
import { ApiError } from '../core/api/types';
import { StressTestingPage } from './stress-testing.page';

const NEUTRAL: StressFactorValues = {
  rateShockBps: 0,
  equityShockPct: 0,
  unemploymentShockPp: 0,
  gdpShockPp: 0,
  propertyShockPct: 0,
  revenueShockPct: 0,
  defaultMultiplier: 1,
  runoffMultiplier: 1,
};

const catalog: StressCatalog = {
  modelVersion: 'pif-bank-stress-1.0.0',
  horizon: '1 an',
  unit: 'M DT',
  thresholds: { cet1Minimum: 0.07, cet1Buffer: 0.025, leverageMinimum: 0.03, lcrMinimum: 1 },
  factors: [
    { key: 'rateShockBps', label: "Choc de taux d'intérêt", unit: 'pb', neutral: 0, min: -300, max: 800, description: 'Taux.' },
    { key: 'defaultMultiplier', label: 'Hausse directe des défauts', unit: '×', neutral: 1, min: 0.5, max: 5, description: 'Défauts.' },
  ],
  presets: [
    { id: 'recession', name: 'Récession économique', description: 'PIB −4 pp.', factors: { ...NEUTRAL, gdpShockPp: -4 } },
    { id: 'rate-shock', name: 'Choc de taux', description: '+300 pb.', factors: { ...NEUTRAL, rateShockBps: 300 } },
  ],
  maxIntensity: 2,
  banks: [
    {
      id: 'CONVENTIONAL',
      name: 'Banque conventionnelle fictive',
      kind: 'CONVENTIONAL',
      kindLabel: 'Banque conventionnelle',
      description: 'Banque commerciale.',
      specificities: ['Crédits à intérêt.'],
      balanceSheet: { assets: [{ key: 'cash', label: 'Caisse', amount: 800, group: 'LIQUIDITY' }], liabilities: [], cet1: 900, totalAssets: 10000, totalLiabilitiesAndEquity: 10000 },
      initial: { cet1: 900, rwa: 6675, cet1Ratio: 0.1348, totalExposure: 10000, leverageRatio: 0.09, hqla: 2600, netOutflows: 1560, lcr: 1.668 },
    },
  ],
  assumptions: ['Banques fictives.'],
  limitations: ['Aucune conformité réglementaire.'],
};

function bank(id: BankId, stressedRatio: number, status: BankRun['resilience']['status']): BankRun {
  const ratios = { cet1: 900, rwa: 6675, cet1Ratio: 0.1348, totalExposure: 10000, leverageRatio: 0.09, hqla: 2600, netOutflows: 1560, lcr: 1.668 };
  const projection = { ...ratios, netIncome: 100, preTaxIncome: 130, creditCost: 87, marginIncome: 330, feesAndOther: 150, bondRevaluation: 0, equityRevaluation: 0 };
  return {
    id,
    name: id === 'CONVENTIONAL' ? 'Banque conventionnelle fictive' : 'Banque participative fictive',
    kind: id,
    kindLabel: id === 'CONVENTIONAL' ? 'Banque conventionnelle' : 'Banque non conventionnelle (participative)',
    projections: { initial: ratios, baseline: { ...projection, cet1Ratio: 0.152 }, stressed: { ...projection, cet1Ratio: stressedRatio } },
    resilience: {
      status,
      statusLabel: status === 'VULNERABLE' ? 'Vulnérable : au moins un seuil franchi' : 'Résiliente : seuils et coussin respectés',
      checks: [{ key: 'cet1Ratio', label: 'Ratio CET1', value: stressedRatio, threshold: 0.07, ok: stressedRatio >= 0.07 }],
      cet1DepletionPp: (0.152 - stressedRatio) * 100,
      capitalShortfall: status === 'VULNERABLE' ? 135.2 : 0,
      liquidityShortfall: 0,
    },
    capitalBridge: { start: 900, steps: [{ key: 'creditCost', label: 'Coût du risque de crédit', amount: -282.6 }], end: 617.4 },
    lossAbsorption:
      id === 'PARTICIPATIVE'
        ? {
            reference: 'Par rapport à la projection à un an du scénario central',
            total: 300,
            capitalConsumed: 200,
            sources: [{ key: 'credit', label: 'Pertes de crédit et de financement', kind: 'CREDIT', amount: 300 }],
            absorbers: [
              { key: 'psia', label: 'Titulaires des comptes participatifs', kind: 'PSIA', amount: 60 },
              { key: 'irr', label: "Réserve pour risque d'investissement (IRR)", kind: 'RESERVE', amount: 40 },
              { key: 'cet1', label: 'Fonds propres CET1', kind: 'CAPITAL', amount: 200 },
            ],
          }
        : {
            reference: 'Par rapport à la projection à un an du scénario central',
            total: 200,
            capitalConsumed: 200,
            sources: [{ key: 'credit', label: 'Pertes de crédit et de financement', kind: 'CREDIT', amount: 200 }],
            absorbers: [{ key: 'cet1', label: 'Fonds propres CET1', kind: 'CAPITAL', amount: 200 }],
          },
    credit: [
      { key: 'mortgage', label: 'Crédits immobiliers aux ménages', ead: 2200, pdBase: 0.015, pdStressed: 0.024, lgdBase: 0.2, lgdStressed: 0.26, eclBase: 6.6, eclStressed: 13.7, residualValueLoss: 0, newlyDefaulted: 19.8 },
    ],
    profitAndLossSharing: [],
    participativeMechanisms:
      id === 'PARTICIPATIVE'
        ? { psia: 4600, psiaShareOfAssets: 0.46, alpha: 0.5, perUsed: 0, dcrCost: 0, psiaPoolLoss: 94.3, irrUsed: 40, psiaAbsorbed: 27.2 }
        : undefined,
    attribution: {
      method: 'SHAPLEY_EXACT',
      methodLabel: 'Décomposition de Shapley exacte (256 combinaisons de facteurs)',
      reference: 'Projection à un an du scénario central (aucun choc)',
      cet1Ratio: [
        { factor: 'rateShockBps', label: "Choc de taux d'intérêt", value: 0 },
        { factor: 'defaultMultiplier', label: 'Hausse directe des défauts', value: stressedRatio - 0.152 },
      ],
      lcr: [],
      cet1RatioTotal: stressedRatio - 0.152,
      lcrTotal: 0,
      explanation: [`Explication calculée pour ${id}.`],
    },
    aiEstimate: aiEstimate(stressedRatio),
  };
}

function aiEstimate(stressedRatio: number): AiEstimate {
  const engine = (stressedRatio - 0.152) * 100;
  const target = (value: number) => ({
    label: 'Variation du ratio CET1 (pp)',
    gbm: value + 0.12,
    linear: value - 1.4,
    engine: value,
    gbmError: 0.12,
    linearError: -1.4,
    modelReference: 0.01,
    contributions: [
      { factor: 'rateShockBps' as const, label: "Choc de taux d'intérêt", model: 0.02, engine: 0 },
      { factor: 'defaultMultiplier' as const, label: 'Hausse directe des défauts', model: value + 0.09, engine: value },
    ],
    explanationGap: 0.04,
    sameTopFactor: true,
  });
  return { outsideTrainingRange: ['rateShockBps'], CET1_CHANGE_PP: target(engine), LCR_CHANGE_PP: { ...target(-12.5), label: 'Variation du LCR (pp)' } };
}

const scores = (r2: number) => ({ mae: 0.25, rmse: 0.4, r2 });
const breach = { rows: 3000, actualBreaches: 1090, truePositive: 1069, falsePositive: 9, falseNegative: 21, trueNegative: 1901, precision: 0.9917, recall: 0.9807, accuracy: 0.99 };
const modelCard: ModelCard = {
  modelVersion: 'pif-stress-emulator-1.0.0',
  engineVersion: 'pif-bank-stress-1.0.0',
  purpose: 'Émulateur du moteur.',
  nature: 'Il apprend le moteur, pas des banques réelles.',
  protocol: {
    features: ['rateShockBps'],
    rowsPerScenario: 2,
    trainingRows: 6000,
    validationRows: 1600,
    testRows: 3000,
    extrapolationRows: 1600,
    seeds: { train: 101 },
    neutralProbability: 0.4,
    samplingRanges: [],
    description: ['Quatre jeux disjoints (phrase du serveur).'],
  },
  models: [
    { id: 'MEAN', label: "Moyenne d'entraînement", description: 'Plancher.' },
    { id: 'LINEAR', label: 'Régression linéaire', description: 'Référence transparente.' },
    { id: 'GBM', label: 'Arbres de régression avec gradient boosting', description: 'Boosting.' },
  ],
  targets: {
    CET1_CHANGE_PP: {
      target: 'CET1_CHANGE_PP',
      label: 'Variation du ratio CET1 (pp)',
      metrics: {
        validation: { MEAN: scores(0), LINEAR: scores(0.786), GBM: scores(0.989) },
        test: { MEAN: scores(0), LINEAR: scores(0.783), GBM: scores(0.983) },
        extrapolation: { MEAN: scores(-0.35), LINEAR: scores(0.652), GBM: scores(0.612) },
      },
      permutationImportance: [
        { feature: 'defaultMultiplier', label: 'Hausse directe des défauts', gbm: 1.99, gbmStd: 0.02, linear: 0.93 },
        { feature: 'runoffMultiplier', label: 'Intensité du choc de liquidité', gbm: 0, gbmStd: 0, linear: 0 },
      ],
      linearCoefficients: [],
      boostingRounds: 400,
      validationCurve: [[1, 2.5], [400, 0.32]],
    },
    LCR_CHANGE_PP: {
      target: 'LCR_CHANGE_PP',
      label: 'Variation du LCR (pp)',
      metrics: {
        validation: { MEAN: scores(0), LINEAR: scores(0.876), GBM: scores(0.9998) },
        test: { MEAN: scores(0), LINEAR: scores(0.879), GBM: scores(0.9998) },
        extrapolation: { MEAN: scores(0), LINEAR: scores(0.326), GBM: scores(0.838) },
      },
      permutationImportance: [{ feature: 'runoffMultiplier', label: 'Intensité du choc de liquidité', gbm: 70.3, gbmStd: 1.2, linear: 50.9 }],
      linearCoefficients: [],
      boostingRounds: 400,
      validationCurve: [[1, 40], [400, 0.64]],
    },
  },
  breachDetection: { definition: 'Ratio CET1 sous 7 % ou LCR sous 100 %.', test: { LINEAR: { ...breach, recall: 0.756 }, GBM: breach }, extrapolation: { LINEAR: breach, GBM: breach } },
  limitations: ["Les arbres de décision n'extrapolent pas (phrase du serveur)."],
};

function result(name = 'Récession économique'): StressRunResult {
  return {
    modelVersion: 'pif-bank-stress-1.0.0',
    method: 'Moteur déterministe',
    scenario: { presetId: 'recession', name, description: '', intensity: 1, factors: NEUTRAL, activeFactors: ['gdpShockPp'] },
    banks: [bank('CONVENTIONAL', 0.1223, 'RESILIENT'), bank('PARTICIPATIVE', 0.049, 'VULNERABLE')],
    comparison: {
      metrics: {
        cet1Ratio: { conventional: 0.1223, participative: 0.049, difference: -0.0733 },
        cet1DepletionPp: { conventional: 2.97, participative: 10.3, difference: 7.33 },
        leverageRatio: { conventional: 0.08, participative: 0.03, difference: -0.05 },
        lcr: { conventional: 1.668, participative: 2.13, difference: 0.46 },
        netIncome: { conventional: -65, participative: -90, difference: -25 },
        creditCost: { conventional: 282.6, participative: 366.3, difference: 83.7 },
      },
      factorGaps: [],
      explanation: ['La banque participative est la plus touchée (phrase calculée par le serveur).'],
    },
    sensitivity: [0, 1, 2].map((k) => ({
      intensity: k,
      CONVENTIONAL: { cet1Ratio: 0.152 - k * 0.03, lcr: 1.6 },
      PARTICIPATIVE: { cet1Ratio: 0.155 - k * 0.05, lcr: 2.1 },
    })),
    thresholds: catalog.thresholds,
    assumptions: ['Hypothèse renvoyée par le serveur.'],
    limitations: ['Limite renvoyée par le serveur.'],
  };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

describe('StressTestingPage', () => {
  let api: {
    catalog: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    model: ReturnType<typeof vi.fn>;
    preview: ReturnType<typeof vi.fn>;
  };

  async function render() {
    TestBed.configureTestingModule({
      imports: [StressTestingPage],
      providers: [provideRouter([]), { provide: StressApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(StressTestingPage);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    api = {
      catalog: vi.fn().mockResolvedValue(catalog),
      run: vi.fn().mockResolvedValue(result()),
      model: vi.fn().mockResolvedValue(modelCard),
      preview: vi.fn().mockResolvedValue({
        ready: true,
        modelVersion: 'pif-stress-emulator-1.0.0',
        factors: NEUTRAL,
        banks: [
          { id: 'CONVENTIONAL', cet1ChangePp: -9, lcrChangePp: 0, cet1Ratio: 0.062, lcr: 1.6, baselineCet1Ratio: 0.152, baselineLcr: 1.6 },
          { id: 'PARTICIPATIVE', cet1ChangePp: -7, lcrChangePp: 0, cet1Ratio: 0.085, lcr: 2.1, baselineCet1Ratio: 0.155, baselineLcr: 2.1 },
        ],
        outsideTrainingRange: [],
      }),
    };
  });

  it('runs the default preset on load and shows only server-computed results', async () => {
    const { root } = await render();
    expect(api.run).toHaveBeenCalledWith({ scenario: 'recession', intensity: 1 });
    expect(root.querySelector('h1')?.textContent).toBe('Tests de résistance bancaire');
    const verdicts = Array.from(root.querySelectorAll('.bs-verdict'));
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0].getAttribute('data-tone')).toBe('positive');
    expect(verdicts[1].getAttribute('data-tone')).toBe('negative');
    expect(verdicts[1].textContent).toContain('4,90');
    expect(verdicts[1].textContent).toContain('135,2');
    expect(root.textContent).toContain('phrase calculée par le serveur');
    expect(root.textContent).toContain('Hypothèse renvoyée par le serveur.');
    expect(root.textContent).toContain('le résultat du moteur reste la référence');
  });

  it('shows the AI estimate next to the exact engine result, with an out-of-domain warning', async () => {
    const { root } = await render();
    const panel = Array.from(root.querySelectorAll('section')).find((s) => s.textContent?.includes("Estimation par l'IA"));
    if (!panel) throw new Error('AI panel missing');
    expect(panel.textContent).toContain('Moteur (exact)');
    expect(panel.textContent).toContain('−2,97 pp'); // engine value of the conventional bank
    expect(panel.textContent).toContain('écart +0,12 pp');
    expect(panel.querySelector('.bs-warning')?.textContent).toContain("Choc de taux d'intérêt");
    expect(panel.textContent).toContain('Même facteur principal que le moteur');
  });

  it('presents the model card: model comparison, breach detection, importance and limitations', async () => {
    const { root } = await render();
    expect(api.model).toHaveBeenCalled();
    const card = Array.from(root.querySelectorAll('section')).find((s) => s.textContent?.includes('Volet IA : fiche du modèle'));
    if (!card) throw new Error('model card missing');
    expect(card.textContent).toContain('0,9830');
    expect(card.textContent).toContain('0,6120');
    expect(card.textContent).toContain('98,1 %');
    expect(card.textContent).toContain('Hausse directe des défauts');
    expect(card.textContent).toContain('phrase du serveur');
    expect(card.textContent).toContain('pas des banques réelles');
  });

  it('previews with the AI while a slider moves, then computes the exact result when it is released', async () => {
    const { fixture, root } = await render();
    expect(root.querySelector('.bs-live')?.getAttribute('data-state')).toBe('exact');
    const slider = root.querySelector<HTMLInputElement>('#f-range-defaultMultiplier');
    if (!slider) throw new Error('slider missing');
    const runsBefore = api.run.mock.calls.length;
    slider.value = '2';
    slider.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 150));
    await settle(fixture);
    expect(api.preview).toHaveBeenCalled();
    expect(api.preview.mock.calls.at(-1)?.[0].factors.defaultMultiplier).toBe(2);
    expect(api.run.mock.calls.length).toBe(runsBefore); // no exact run while sliding
    expect(root.querySelector('.bs-live')?.getAttribute('data-state')).toBe('preview');
    const first = root.querySelector('.bs-verdict');
    expect(first?.getAttribute('data-preview')).toBe('true');
    expect(first?.textContent).toContain('Aperçu IA');
    expect(first?.textContent).toContain('6,20');

    slider.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 450));
    await settle(fixture);
    expect(api.run.mock.calls.length).toBe(runsBefore + 1);
    expect(api.run.mock.calls.at(-1)?.[0].factors.defaultMultiplier).toBe(2);
    expect(root.querySelector('.bs-live')?.getAttribute('data-state')).toBe('exact');
    expect(root.querySelector('.bs-verdict')?.getAttribute('data-preview')).toBe('false');
    // The confirmed preview stays visible with its error against the engine (6,20 % vs 12,23 %).
    const check = root.querySelector('.bs-previewCheck')?.textContent ?? '';
    expect(check).toContain('6,20');
    expect(check).toContain('−6,03');
  });

  it('shows who bears the shock, with investment-account holders only for the participative bank', async () => {
    const { root } = await render();
    const mirrors = Array.from(root.querySelectorAll('.bs-mirror'));
    expect(mirrors).toHaveLength(2);
    expect(mirrors[0].querySelector('[data-kind="PSIA"]')).toBeNull();
    expect(mirrors[1].querySelector('.bs-block[data-kind="PSIA"]')).not.toBeNull();
    expect(mirrors[1].textContent).toContain('Titulaires des comptes participatifs');
    // Same height scale: the participative bank's 300 M DT column is the tallest.
    const heights = mirrors.map((m) => parseFloat((m.querySelector('.bs-mirrorCol') as HTMLElement).style.height));
    expect(heights[0]).toBeCloseTo(200 / 3, 3);
    expect(heights[1]).toBe(100);
  });

  it('draws the SHAP-style waterfall from the baseline to the stressed ratio', async () => {
    const { root } = await render();
    const rows = Array.from(root.querySelectorAll('.bs-waterfall .bs-wfRow'));
    expect(rows[0].textContent).toContain('Central à 1 an');
    expect(rows.at(-1)?.textContent).toContain('Sous stress à 1 an');
    expect(rows.some((r) => r.textContent?.includes('Hausse directe des défauts'))).toBe(true);
    expect(rows.some((r) => r.textContent?.includes("Choc de taux d'intérêt"))).toBe(false); // zero contribution
  });

  it('keeps the stress results when the model card cannot be loaded', async () => {
    api.model.mockRejectedValue(new ApiError(503, 'Modèle indisponible.'));
    const { root } = await render();
    expect(root.querySelectorAll('.bs-verdict')).toHaveLength(2);
    expect(Array.from(root.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' ')).toContain('Modèle indisponible.');
  });

  it('runs a preset by name and a customised scenario with its factors', async () => {
    const { fixture, root } = await render();
    const rate = Array.from(root.querySelectorAll<HTMLButtonElement>('.bs-presets .bs-preset')).find((b) => b.textContent?.includes('Choc de taux'));
    rate?.click();
    await settle(fixture);
    expect(api.run).toHaveBeenLastCalledWith({ scenario: 'rate-shock', intensity: 1 });

    const input = root.querySelector<HTMLInputElement>('#f-defaultMultiplier');
    if (!input) throw new Error('factor input missing');
    input.value = '2.5';
    input.dispatchEvent(new Event('change'));
    root.querySelector<HTMLFormElement>('form.bs-builder')?.dispatchEvent(new Event('submit'));
    await settle(fixture);
    const last = api.run.mock.calls.at(-1)?.[0];
    expect(last.scenario).toBeUndefined();
    expect(last.factors.defaultMultiplier).toBe(2.5);
    expect(last.factors.rateShockBps).toBe(300);
    expect(root.querySelector('.bs-scenarioName')?.textContent).toContain('Scénario personnalisé');
  });

  it('clamps a typed factor to its accepted range', async () => {
    const { fixture, root } = await render();
    const input = root.querySelector<HTMLInputElement>('#f-rateShockBps');
    if (!input) throw new Error('factor input missing');
    input.value = '5000';
    input.dispatchEvent(new Event('change'));
    root.querySelector<HTMLFormElement>('form.bs-builder')?.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(api.run.mock.calls.at(-1)?.[0].factors.rateShockBps).toBe(800);
  });

  it('switches the detail panels between the two banks', async () => {
    const { fixture, root } = await render();
    expect(root.textContent).not.toContain('Mécanismes propres à la banque participative');
    const tab = Array.from(root.querySelectorAll<HTMLButtonElement>('.bs-bankTabs button')).find((b) => b.textContent?.includes('participative'));
    tab?.click();
    await settle(fixture);
    expect(root.textContent).toContain('Mécanismes propres à la banque participative');
    expect(root.textContent).toContain('Explication calculée pour PARTICIPATIVE.');
  });

  it('reports a failed run without inventing results', async () => {
    api.run.mockRejectedValue(new ApiError(503, 'Service indisponible.'));
    const { root } = await render();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Service indisponible.');
    expect(root.querySelectorAll('.bs-verdict')).toHaveLength(0);
  });
});
