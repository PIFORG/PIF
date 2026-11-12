import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PortfolioApi, type Metric, type PortfolioAnalytics, type PortfolioSummary } from '../core/api/trading-api';
import { ApiError } from '../core/api/types';
import { pct } from '../trading/trading-format';
import { RiskAnalyticsPage } from './risk-analytics.page';

const provenance = { providerId: 'pif-simulated-v1', kind: 'FICTIONAL' as const, currency: 'TND', description: 'Simulated prices.' };

function summary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    id: 'p1',
    name: 'Core',
    baseCurrency: 'TND',
    status: 'ACTIVE',
    version: 4,
    createdAt: '2026-11-01T09:00:00.000Z',
    asOf: '2026-11-09T10:00:00.000Z',
    valuationConvention: 'Mid',
    initialCapital: 100000,
    netContributions: 100000,
    cash: 99000,
    reservedCash: 0,
    availableCash: 99000,
    positionsValue: 1000,
    equity: 100000,
    profit: -2.5,
    realizedPnl: 0,
    unrealizedPnl: -2.5,
    feesPaid: 2.5,
    spreadCost: 1,
    maxPositionWeightPct: 100,
    openOrders: 0,
    positions: [],
    ...overrides,
  };
}

const metric = (value: number | null, unavailableReason: string | null = null, requirement = 'Needs data.'): Metric => ({
  value,
  unavailableReason,
  requirement,
});

function analytics(): PortfolioAnalytics {
  return {
    portfolioId: 'p1',
    asOf: '2026-11-09T10:00:00.000Z',
    currency: 'TND',
    provenance,
    valuation: {
      convention: 'Mid',
      equity: 100000,
      cash: 99000,
      reservedCash: 0,
      availableCash: 99000,
      positionsValue: 1000,
      liquidationValue: 99996.5,
      costBasis: 1001,
      unrealizedPnl: -1,
      realizedPnl: 0,
      feesPaid: 2.5,
      spreadCost: 1,
    },
    reconciliation: {
      description: 'Profit two ways.',
      equity: 100000,
      netContributions: 100000,
      profit: -2.5,
      realizedPnl: 0,
      unrealizedPnl: -1,
      difference: 0,
      cashLedgerSum: 99000,
      cashMatchesLedger: true,
    },
    allocation: {
      cash: { value: 99000, weight: 0.99 },
      byInstrument: [{ name: 'CTB', value: 1000, weight: 0.01 }],
      bySector: [{ name: 'Banking', value: 1000, weight: 0.01 }],
      byAssetClass: [{ name: 'EQUITY', value: 1000, weight: 0.01 }],
    },
    concentration: {
      largestWeight: metric(0.01, null, 'Largest holding as a share of equity.'),
      exposure: metric(0.01),
      hhi: metric(1),
      effectiveHoldings: metric(1),
    },
    performance: {
      profit: metric(-2.5),
      timeWeightedReturn: metric(-0.000025),
      moneyWeightedReturn: metric(null, 'the portfolio is younger than one day.'),
      completeDays: 0,
    },
    risk: {
      valueAtRisk95: metric(null, 'fewer than 20 daily observations.', 'At least 20 daily returns.'),
      expectedShortfall95: metric(null, 'fewer than 20 daily observations.'),
      holdingsVolatilityDaily: metric(0.012),
      observations: 5,
      realizedVolatilityDaily: metric(null),
      realizedVolatilityAnnualized: metric(null),
      maxDrawdown: metric(0, null, 'Largest peak-to-trough fall.'),
    },
    stress: [
      {
        id: 'equity-crash',
        name: 'Equity crash',
        description: 'Equities fall 20%.',
        hypothetical: true,
        impact: -200,
        impactPct: -0.002,
        equityAfter: 99800,
        breakdown: [],
      },
    ],
    methodology: {
      horizon: '1 trading day',
      confidenceLevel: 0.95,
      dataPeriod: 'Up to 30–250 aligned daily closes',
      observationFrequency: '1 day',
      currency: 'TND',
      calculationMethod: 'Historical simulation.',
      assumptions: ['Cash carries no price risk in this simulation.'],
      limitations: ['Historical VaR is not a guarantee of maximum possible loss.'],
      metricSource: { valueAtRisk95: 'OBSERVED_RETURNS', stress: 'SIMULATED_SCENARIO' },
      minVarObservations: 30,
    },
    riskContributions: {
      available: false,
      unavailableReason: 'Only 5 aligned daily returns (need 30).',
      byInstrument: [],
    },
    diversification: {
      meanPairwiseCorrelation: null,
      unavailableReason: 'Need at least two holdings.',
      pairs: 0,
    },
  };
}

async function settle<T>(fixture: ComponentFixture<T>) {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
}

function kpi(root: HTMLElement, label: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('.ws-kpi')).find((k) => k.querySelector('.ws-kpiLabel')?.textContent === label);
}

let portfolioApi: Record<string, ReturnType<typeof vi.fn>>;

describe('RiskAnalyticsPage', () => {
  beforeEach(() => {
    portfolioApi = {
      list: vi.fn().mockResolvedValue({ portfolios: [summary()] }),
      get: vi.fn().mockResolvedValue(summary()),
      analytics: vi.fn().mockResolvedValue(analytics()),
      history: vi.fn().mockResolvedValue({ convention: 'End of day, UTC.', points: [] }),
      preTradeRisk: vi.fn().mockResolvedValue({
        portfolioId: 'p1',
        asOf: '2026-11-09T10:00:00.000Z',
        currency: 'TND',
        provenance,
        hypothetical: true,
        note: 'Simulated immediate fill for risk comparison only.',
        quote: {
          symbol: 'CTB',
          mid: 42.5,
          bid: 42.4,
          ask: 42.6,
          spreadBps: 20,
          depth: 600,
          asOf: '2026-11-09T10:00:00.000Z',
          validUntil: '2026-11-09T10:05:00.000Z',
        },
        evaluation: {
          accepted: true,
          rejection: null,
          referencePrice: 42.6,
          estimate: { notional: 426, fee: 1.065, total: 427.065 },
          executesNow: true,
          fillableNow: 10,
          availableCash: 99000,
          held: 0,
          equity: 100000,
          warnings: [],
        },
        current: {
          cash: 99000,
          positionsValue: 1000,
          equity: 100000,
          exposure: 0.01,
          largestWeight: 0.01,
          hhi: 1,
          effectiveHoldings: 1,
          maxPositionWeightPct: 50,
          withinPositionLimit: true,
        },
        proposed: {
          cash: 98572.935,
          positionsValue: 1425,
          equity: 99997.935,
          exposure: 0.01425,
          largestWeight: 0.01425,
          hhi: 1,
          effectiveHoldings: 1,
          maxPositionWeightPct: 50,
          withinPositionLimit: true,
        },
        delta: { cash: -427.065, positionsValue: 425, equity: -2.065, exposure: 0.00425, largestWeight: 0.00425 },
      }),
    };
  });

  async function render() {
    TestBed.configureTestingModule({
      imports: [RiskAnalyticsPage],
      providers: [provideRouter([]), { provide: PortfolioApi, useValue: portfolioApi }],
    });
    const fixture = TestBed.createComponent(RiskAnalyticsPage);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('loads server risk metrics and surfaces unavailable reasons instead of silent zeros', async () => {
    const { root } = await render();
    expect(root.querySelector('h1')?.textContent).toBe('Analyse des risques');
    expect(root.querySelector('.tr-provenance')?.textContent).toContain('Prix simulés fictifs');
    expect(kpi(root, 'Drawdown maximal')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe(pct(0));
    expect(root.textContent).toContain('Indisponible : fewer than 20 daily observations.');
    expect(root.querySelector('.ch-allocBar')?.getAttribute('aria-label')).toBe('Allocation par instrument et espèces');
    expect(root.textContent).toContain('Equity crash');
    expect(root.textContent).toContain('Historical VaR is not a guarantee of maximum possible loss.');
    expect(root.textContent).toContain('Contributions indisponibles');
    expect(root.querySelector('a.btn[href="/trading"]')?.textContent?.trim()).toMatch(/salle de trading|Ouvrir la salle de trading/i);
    expect(portfolioApi['analytics']).toHaveBeenCalledWith('p1');
    expect(portfolioApi['history']).toHaveBeenCalledWith('p1');
  });

  it('evaluates pre-trade risk impact against the Spring Boot endpoint', async () => {
    const { fixture, root } = await render();
    const form = root.querySelector('form.tr-formRow') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(portfolioApi['preTradeRisk']).toHaveBeenCalledWith('p1', {
      symbol: 'CTB',
      side: 'BUY',
      type: 'MARKET',
      quantity: 10,
    });
    expect(root.textContent).toContain('Simulated immediate fill for risk comparison only.');
    expect(root.textContent).toContain('Poids le plus élevé');
  });

  it('shows an error when analytics cannot be loaded', async () => {
    portfolioApi['analytics'].mockRejectedValue(new ApiError(503, 'Service unavailable.'));
    const { root } = await render();
    expect(root.querySelector('.ws-empty[data-tone="error"]')?.textContent).toContain('Données de risque indisponibles');
    expect(root.textContent).toContain('Service unavailable.');
  });

  it('prompts to create a portfolio when the list is empty', async () => {
    portfolioApi['list'].mockResolvedValue({ portfolios: [] });
    const { root } = await render();
    expect(root.querySelector('.ws-emptyTitle')?.textContent).toBe('Aucun portefeuille à analyser');
    expect(root.querySelector('a[href="/portfolios"]')?.textContent).toContain('Ouvrir les portefeuilles');
  });
});
