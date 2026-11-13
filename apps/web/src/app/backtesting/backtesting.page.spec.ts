import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BacktestApi, type BacktestResult } from '../core/api/backtest-api';
import { MarketApi } from '../core/api/trading-api';
import { ApiError } from '../core/api/types';
import { BacktestingPage } from './backtesting.page';

const provenance = {
  providerId: 'pif-simulated-v1',
  kind: 'FICTIONAL' as const,
  currency: 'TND',
  description: 'Deterministic simulated prices.',
};

function result(): BacktestResult {
  return {
    provenance,
    executionConvention: 'NEXT_CLOSE',
    assumptions: ['Prices are FICTIONAL.'],
    strategy: 'BUY_AND_HOLD',
    symbols: ['CTB'],
    start: '2026-01-02T00:00:00.000Z',
    end: '2026-03-01T00:00:00.000Z',
    initialCash: 100000,
    feeBps: 25,
    slippageBps: 5,
    params: {},
    barCount: 40,
    metrics: {
      totalReturn: 0.05,
      annualizedReturn: 0.2,
      volatilityAnnualized: 0.15,
      maxDrawdown: 0.03,
      sharpe: 1.1,
      totalFees: 12.5,
      totalSlippageCost: 2,
      tradeCount: 1,
      buyCount: 1,
      sellCount: 0,
      winRate: null,
      benchmarkTotalReturn: 0.04,
      excessReturnVsBenchmark: 0.01,
      calendarDays: 58,
      annualization: '(1+R)^(365/nDays)-1',
    },
    equityCurve: [
      { at: '2026-01-02T00:00:00.000Z', equity: 100000, cash: 100000, positionsValue: 0, drawdown: 0 },
      { at: '2026-03-01T00:00:00.000Z', equity: 105000, cash: 0, positionsValue: 105000, drawdown: 0 },
    ],
    drawdown: [
      { at: '2026-01-02T00:00:00.000Z', drawdown: 0 },
      { at: '2026-03-01T00:00:00.000Z', drawdown: 0 },
    ],
    trades: [
      {
        at: '2026-01-03T00:00:00.000Z',
        symbol: 'CTB',
        side: 'BUY',
        quantity: 100,
        price: 42.5,
        fee: 1,
        slippageCost: 0.2,
        cashAfter: 0,
      },
    ],
    finalCash: 0,
    finalPositions: { CTB: 100 },
  };
}

async function settle<T>(fixture: ComponentFixture<T>) {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
}

describe('BacktestingPage', () => {
  let marketApi: { instruments: ReturnType<typeof vi.fn> };
  let backtestApi: { run: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    marketApi = {
      instruments: vi.fn().mockResolvedValue({
        provenance,
        asOf: '2026-11-12T00:00:00.000Z',
        instruments: [
          {
            id: '1',
            symbol: 'CTB',
            name: 'Carthage Bank',
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
            quote: null,
            previousClose: null,
            changePct: null,
          },
        ],
      }),
    };
    backtestApi = { run: vi.fn().mockResolvedValue(result()) };
  });

  async function render() {
    TestBed.configureTestingModule({
      imports: [BacktestingPage],
      providers: [
        provideRouter([]),
        { provide: MarketApi, useValue: marketApi },
        { provide: BacktestApi, useValue: backtestApi },
      ],
    });
    const fixture = TestBed.createComponent(BacktestingPage);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('loads instruments and runs a backtest with FICTIONAL provenance', async () => {
    const { fixture, root } = await render();
    expect(root.querySelector('h1')?.textContent).toBe('Tests historiques');
    expect(marketApi.instruments).toHaveBeenCalled();
    await (fixture.componentInstance as unknown as Runnable).run();
    await settle(fixture);
    expect(backtestApi.run).toHaveBeenCalled();
    expect(root.textContent).toMatch(/Fictional|FICTIONAL/i);
    expect(root.textContent).toContain('NEXT_CLOSE');
    expect(root.textContent).toContain('CTB');
  });

  it('surfaces a run error without inventing metrics', async () => {
    backtestApi.run.mockRejectedValue(new ApiError(503, 'Service unavailable.'));
    const { fixture, root } = await render();
    await (fixture.componentInstance as unknown as Runnable).run();
    await settle(fixture);
    expect(root.textContent).toContain('Service unavailable.');
  });
});

/** The page's protected run action, reached the way the template's submit button calls it. */
interface Runnable {
  run(): Promise<void>;
}
