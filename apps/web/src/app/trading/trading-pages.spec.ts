import type { Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  MarketApi,
  PortfolioApi,
  rememberPortfolio,
  type InstrumentView,
  type Metric,
  type OrderView,
  type PortfolioAnalytics,
  type PortfolioSummary,
  type SubmitOrderResult,
} from '../core/api/trading-api';
import { ApiError } from '../core/api/types';
import { MarketsPage } from './markets.page';
import { PortfoliosPage } from './portfolios.page';
import { resultMessage, TradingDeskPage } from './trading-desk.page';
import { pct } from './trading-format';

const provenance = { providerId: 'pif-simulated-v1', kind: 'FICTIONAL' as const, currency: 'TND', description: 'Simulated prices.' };
const quote = { mid: 10, bid: 9.99, ask: 10.01, spreadBps: 20, depth: 500, asOf: '2026-11-09T10:00:00.000Z', validUntil: '2026-11-09T10:05:00.000Z' };

function instrument(symbol: string, overrides: Partial<InstrumentView> = {}): InstrumentView {
  return {
    id: `i-${symbol}`,
    symbol,
    name: `${symbol} Holdings`,
    assetClass: 'EQUITY',
    sector: 'Banking',
    currency: 'TND',
    status: 'ACTIVE',
    priceDecimals: 3,
    quantityDecimals: 0,
    lotSize: 1,
    fees: { feeBps: 25, minFee: 0.5 },
    fictional: true,
    provenance,
    quote,
    previousClose: 9.9,
    changePct: 1.01,
    ...overrides,
  };
}

const instruments = [
  instrument('CTB'),
  instrument('MDX', { changePct: -2.5, sector: 'Health' }),
  instrument('TFX', { assetClass: 'FUND', sector: 'Diversified', changePct: null, fees: { feeBps: 10, minFee: 0.25 } }),
];

const snapshot = { provenance, asOf: '2026-11-09T10:00:00.000Z', instruments };
const status = {
  provenance,
  serverTime: '2026-11-09T10:01:00.000Z',
  dataStart: '2026-01-01T00:00:00.000Z',
  quotePeriodSeconds: 300,
  currentPeriod: { start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T10:05:00.000Z' },
  tradingHours: 'Continuous',
};

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
    openOrders: 1,
    positions: [
      {
        symbol: 'CTB',
        name: 'CTB Holdings',
        assetClass: 'EQUITY',
        sector: 'Banking',
        quantity: 100,
        averageCost: 10.01,
        costBasis: 1001,
        price: 10,
        bid: 9.99,
        ask: 10.01,
        marketValue: 1000,
        unrealizedPnl: -1,
        unrealizedPct: -0.001,
        weight: 0.01,
        quoteAsOf: quote.asOf,
      },
    ],
    ...overrides,
  };
}

function order(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: 'o1',
    clientOrderId: 'client-1',
    symbol: 'CTB',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 10,
    filledQuantity: 0,
    remainingQuantity: 10,
    limitPrice: 9.5,
    stopPrice: null,
    triggered: false,
    status: 'OPEN',
    averagePrice: null,
    rejectionCode: null,
    statusReason: null,
    quoteAtSubmission: { mid: 10, bid: 9.99, ask: 10.01, asOf: quote.asOf },
    providerId: 'pif-simulated-v1',
    submittedAt: '2026-11-09T10:00:00.000Z',
    expiresAt: null,
    closedAt: null,
    ...overrides,
  };
}

const metric = (value: number | null, unavailableReason: string | null = null): Metric => ({ value, unavailableReason, requirement: 'Needs data.' });

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
    concentration: { largestWeight: metric(0.01), exposure: metric(0.01), hhi: metric(1), effectiveHoldings: metric(1) },
    performance: {
      profit: metric(-2.5),
      timeWeightedReturn: metric(-0.000025),
      moneyWeightedReturn: metric(null, 'the portfolio is younger than one day.'),
      completeDays: 0,
    },
    risk: {
      valueAtRisk95: metric(null, 'fewer than 20 daily observations.'),
      expectedShortfall95: metric(null, 'fewer than 20 daily observations.'),
      holdingsVolatilityDaily: metric(0.012),
      observations: 5,
      realizedVolatilityDaily: metric(null),
      realizedVolatilityAnnualized: metric(null),
      maxDrawdown: metric(0),
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
  };
}

async function settle<T>(fixture: ComponentFixture<T>) {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
}

function button(root: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === name);
}

function kpi(root: HTMLElement, label: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('.ws-kpi')).find((k) => k.querySelector('.ws-kpiLabel')?.textContent === label);
}

let marketApi: Record<string, ReturnType<typeof vi.fn>>;
let portfolioApi: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  localStorage.clear();
  marketApi = {
    status: vi.fn().mockResolvedValue(status),
    instruments: vi.fn().mockResolvedValue(snapshot),
    watchlist: vi.fn().mockResolvedValue({ items: [{ addedAt: quote.asOf, instrument: instruments[1] }] }),
    watch: vi.fn(),
    unwatch: vi.fn(),
    history: vi.fn().mockResolvedValue({
      symbol: 'CTB',
      range: '1D',
      resolution: '5-minute',
      currency: 'TND',
      provenance,
      points: [
        { at: '2026-11-09T09:00:00.000Z', mid: 9.9 },
        { at: '2026-11-09T10:00:00.000Z', mid: 10 },
      ],
    }),
  };
  portfolioApi = {
    list: vi.fn().mockResolvedValue({ portfolios: [summary()] }),
    get: vi.fn().mockResolvedValue(summary()),
    create: vi.fn(),
    orders: vi.fn().mockResolvedValue({ portfolioVersion: 4, orders: [order()] }),
    executions: vi.fn().mockResolvedValue({ executions: [] }),
    cashEntries: vi.fn().mockResolvedValue({ entries: [] }),
    cancel: vi.fn(),
    cashFlow: vi.fn(),
    analytics: vi.fn().mockResolvedValue(analytics()),
    history: vi.fn().mockResolvedValue({ convention: 'End of day, UTC.', points: [] }),
    preview: vi.fn(),
    submit: vi.fn(),
  };
});

async function render<T>(page: Type<T>) {
  TestBed.configureTestingModule({
    imports: [page],
    providers: [provideRouter([]), { provide: MarketApi, useValue: marketApi }, { provide: PortfolioApi, useValue: portfolioApi }],
  });
  const fixture = TestBed.createComponent(page);
  await settle(fixture);
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('Markets page', () => {
  it('shows server quotes, movers and the watchlist with the fictional-data notice', async () => {
    const { root } = await render(MarketsPage);
    expect(root.querySelector('.tr-provenance')?.textContent).toContain('Fictional simulated prices');
    expect(kpi(root, 'Instruments')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe('3');
    expect(kpi(root, 'Période de cotation')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe('5 min');
    expect(kpi(root, 'Meilleure perf. depuis la clôture')?.querySelector('.ws-kpiHint')?.textContent).toBe('CTB · CTB Holdings');
    expect(kpi(root, 'Pire perf. depuis la clôture')?.querySelector('.ws-kpiHint')?.textContent).toBe('MDX · MDX Holdings');
    const captions = Array.from(root.querySelectorAll('caption')).map((c) => c.textContent);
    expect(captions).toEqual(['Liste de suivi', 'Tous les instruments']);
    expect(root.textContent).toContain('Actions 0.25 % (min 0,500 DT) · Fonds 0.10 % (min 0,250 DT)');
    const trade = root.querySelector<HTMLAnchorElement>('a.btn[href^="/trading"]');
    expect(trade?.getAttribute('href')).toBe('/trading?symbol=MDX');
  });

  it('filters by asset class and toggles the watchlist through the API', async () => {
    marketApi['watch'].mockResolvedValue({ items: instruments.map((i) => ({ addedAt: quote.asOf, instrument: i })) });
    const { fixture, root } = await render(MarketsPage);
    const select = root.querySelector<HTMLSelectElement>('#markets-class')!;
    select.value = 'FUND';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    const rows = root.querySelectorAll('table')[1].querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('TFX');

    root.querySelector<HTMLButtonElement>('[aria-label="Ajouter TFX à la liste de suivi"]')!.click();
    await settle(fixture);
    expect(marketApi['watch']).toHaveBeenCalledWith('TFX');
    expect(root.querySelector('[aria-label="Retirer TFX de la liste de suivi"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows an honest error state when market data cannot be loaded', async () => {
    marketApi['instruments'].mockRejectedValue(new ApiError(503, 'Service unavailable.'));
    const { root } = await render(MarketsPage);
    expect(root.querySelector('.form-error-banner')?.textContent).toBe('Service unavailable.');
    expect(root.querySelector('.ws-empty[data-tone="error"]')?.textContent).toContain('Données de marché indisponibles');
  });
  it('stops refreshing when the page is destroyed', async () => {
    const clear = vi.spyOn(window, 'clearInterval');
    const { fixture } = await render(MarketsPage);
    fixture.destroy();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe('Trading desk page', () => {
  it('describes order results from the server response', () => {
    const filled = {
      replayed: false,
      order: order({ type: 'MARKET', status: 'FILLED', filledQuantity: 10, remainingQuantity: 0, averagePrice: 10.01 }),
      executions: [{ fee: 0.5 }],
    } as unknown as SubmitOrderResult;
    expect(resultMessage(filled)).toEqual({
      tone: 'pos',
      text: 'Acheté 10 CTB à 10,010 DT en moyenne (frais 0,500 DT).',
    });
    expect(resultMessage({ ...filled, replayed: true }).text).toMatch(
      /^Cet ordre avait déjà été passé ; voici son résultat\. Acheté/,
    );
    const rejected = { ...filled, order: order({ status: 'REJECTED', statusReason: 'Not enough cash.' }), executions: [] };
    expect(resultMessage(rejected)).toEqual({ tone: 'neg', text: 'Ordre refusé : Not enough cash.' });
    const working = { ...filled, order: order(), executions: [] };
    expect(resultMessage(working).text).toBe("Votre ordre d'achat à cours limité de 10 CTB à 9,500 DT est en cours.");
  });

  it('loads the portfolio, quotes, chart and working orders', async () => {
    const { root } = await render(TradingDeskPage);
    expect(kpi(root, 'Capitaux propres')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe('100\u202f000,000 DT');
    expect(kpi(root, 'Ordres ouverts')?.querySelector('a')?.getAttribute('href')).toBe('/portfolios');
    expect(root.querySelector('.tr-instrumentRow[data-selected="true"]')?.textContent).toContain('CTB');
    expect(marketApi['history']).toHaveBeenCalledWith('CTB', '1D');
    expect(root.querySelector('figure.ch-figure svg')?.getAttribute('aria-label')).toContain('CTB mid price over 1D');
    expect(root.querySelector('.tr-chartHead')?.textContent?.replace(/\s+/g, ' ')).toContain('depuis la clôture précédente');
    expect(portfolioApi['orders']).toHaveBeenCalledWith('p1', 'open', 50);
    expect(root.querySelector('mtr-order-ticket form')).not.toBeNull();
  });

  it('offers to create a portfolio when the user has none', async () => {
    portfolioApi['list'].mockResolvedValue({ portfolios: [] });
    const { root } = await render(TradingDeskPage);
    expect(root.textContent).toContain('Commencer avec un portefeuille virtuel');
    expect(root.querySelector('mtr-portfolio-picker')).toBeNull();
    expect(root.textContent).toContain('Create a portfolio to trade');
  });

  it('cancels a working order and reports it', async () => {
    portfolioApi['cancel'].mockResolvedValue({ order: order({ status: 'CANCELLED' }), portfolio: summary({ openOrders: 0 }) });
    const { fixture, root } = await render(TradingDeskPage);
    button(root, 'Annuler Achat CTB')!.click();
    await settle(fixture);
    expect(portfolioApi['cancel']).toHaveBeenCalledWith('p1', 'o1');
    expect(root.querySelector('.tr-toast')?.textContent).toContain("Ordre d'achat de CTB annulé.");
  });
  it('remembers only the active portfolio id', async () => {
    rememberPortfolio('p1');
    await render(TradingDeskPage);
    expect(Object.keys(localStorage)).toEqual(['pif.activePortfolioId']);
    expect(localStorage.getItem('pif.activePortfolioId')).toBe('p1');
  });
});

describe('Portfolios page', () => {
  it('shows server metrics and explains the ones that cannot be computed yet', async () => {
    const { root } = await render(PortfoliosPage);
    expect(kpi(root, 'Rendement pondéré dans le temps')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe(
      pct(-0.000025, true),
    );
    expect(kpi(root, "Rendement pondéré par l'argent")?.textContent).toContain(
      'Not available: the portfolio is younger than one day.',
    );
    const risk = root.querySelector('.tr-metricGrid')!;
    expect(risk.textContent).toContain('Not available: fewer than 20 daily observations.');
    expect(root.textContent).toContain("L'historique se constitue au fil des jours");
    expect(root.querySelector('.ch-allocBar')?.getAttribute('aria-label')).toBe('Allocation par instrument et trésorerie');
    expect(root.textContent).toContain('Equity crash');
  });

  it('records a deposit with the expected version and confirms it', async () => {
    portfolioApi['cashFlow'].mockResolvedValue(summary({ version: 5, cash: 99500 }));
    const { fixture, root } = await render(PortfoliosPage);
    const amount = root.querySelector<HTMLInputElement>('#cash-amount')!;
    amount.value = '500';
    amount.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    root
      .querySelector<HTMLFormElement>('form[aria-label="Déposer ou retirer de la trésorerie virtuelle"]')!
      .dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(portfolioApi['cashFlow']).toHaveBeenCalledWith('p1', { type: 'DEPOSIT', amount: 500, expectedVersion: 4 });
    expect(root.querySelector('.tr-toast')?.textContent).toContain('Déposé 500,000 DT.');
  });

  it('reloads after a version conflict and tells the user', async () => {
    portfolioApi['cashFlow'].mockRejectedValue(new ApiError(409, 'Changed.', 'PORTFOLIO_CHANGED'));
    const { fixture, root } = await render(PortfoliosPage);
    const amount = root.querySelector<HTMLInputElement>('#cash-amount')!;
    amount.value = '10';
    amount.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    root
      .querySelector<HTMLFormElement>('form[aria-label="Déposer ou retirer de la trésorerie virtuelle"]')!
      .dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Le portefeuille a changé pendant la saisie',
    );
    expect(root.querySelector('.tr-toast')).toBeNull();
  });

  it('switches the history between orders, trades and cash', async () => {
    const { fixture, root } = await render(PortfoliosPage);
    expect(root.querySelector('mtr-orders-table')).not.toBeNull();
    button(root, 'Trésorerie')!.click();
    await fixture.whenStable();
    expect(root.querySelector('mtr-orders-table')).toBeNull();
    expect(root.textContent).toContain('Aucun mouvement de trésorerie');
  });
});
