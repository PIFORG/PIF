import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  PortfolioApi,
  type InstrumentView,
  type OrderPreviewResult,
  type PortfolioSummary,
  type SubmitOrderResult,
} from '../core/api/trading-api';
import { ApiError } from '../core/api/types';
import { OrderTicketComponent } from './order-ticket.component';
import { emptyTicket, type TicketDraft } from './ticket-draft';

/** Port of apps/web/src/components/trading/OrderTicket.test.tsx. */

const provenance = { providerId: 'pif-simulated-v1', kind: 'FICTIONAL' as const, currency: 'TND', description: 'Simulated.' };
const quote = {
  mid: 10,
  bid: 9.99,
  ask: 10.01,
  spreadBps: 20,
  depth: 500,
  asOf: '2026-11-09T10:00:00.000Z',
  validUntil: '2999-01-01T00:00:00.000Z',
};

const instrument: InstrumentView = {
  id: 'i1',
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
  quote,
  previousClose: 9.9,
  changePct: 1.01,
};

const portfolio = { id: 'p1', name: 'Core', version: 3, availableCash: 1000, positions: [] } as unknown as PortfolioSummary;

function previewResult(overrides: Partial<OrderPreviewResult> = {}): OrderPreviewResult {
  return {
    accepted: true,
    rejection: null,
    referencePrice: 10.01,
    estimate: { notional: 500.5, fee: 1.251, total: 501.751 },
    executesNow: true,
    fillableNow: 50,
    availableCash: 1000,
    held: 0,
    equity: 1000,
    warnings: [],
    portfolioVersion: 3,
    quote: { symbol: 'CTB', ...quote },
    provenance,
    ...overrides,
  };
}

@Component({
  imports: [OrderTicketComponent],
  template: `<mtr-order-ticket [portfolio]="portfolio()" [instruments]="instruments" [(draft)]="draft" (result)="onResult($event)" (stale)="onStale()" />`,
})
class HarnessComponent {
  portfolio = signal<PortfolioSummary | null>(portfolio);
  instruments = [instrument];
  draft = signal<TicketDraft>(emptyTicket('CTB'));
  onResult = vi.fn<(result: SubmitOrderResult) => void>();
  onStale = vi.fn<() => void>();
}

describe('OrderTicket', () => {
  let api: { preview: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<HarnessComponent>;
  let root: HTMLElement;

  async function render() {
    TestBed.configureTestingModule({ imports: [HarnessComponent], providers: [{ provide: PortfolioApi, useValue: api }] });
    fixture = TestBed.createComponent(HarnessComponent);
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }

  /** Lets awaited API mocks resolve, then renders. */
  async function settle() {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  }

  function byLabel(text: string): HTMLInputElement {
    const label = Array.from(root.querySelectorAll('label')).find((l) => l.textContent?.trim() === text);
    return root.querySelector(`#${label?.htmlFor}`) as HTMLInputElement;
  }

  function button(name: string | RegExp): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll('button')).find((b) => {
      const text = b.textContent?.trim() ?? '';
      return typeof name === 'string' ? text === name : name.test(text);
    });
  }

  async function type(label: string, value: string) {
    const input = byLabel(label);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function click(name: string) {
    button(name)?.click();
    await settle();
  }

  beforeEach(() => {
    api = { preview: vi.fn(), submit: vi.fn() };
  });

  it('shows field errors instead of calling the server for an invalid quantity', async () => {
    await render();
    await type('Units', '2.5');
    await click('Preview order');
    expect(root.textContent).toContain('Enter a whole number of units, at least 1.');
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('previews on the server, then confirms with the previewed version, quote time and one order reference', async () => {
    api.preview.mockResolvedValue(previewResult());
    const result = { replayed: false, order: { status: 'FILLED' }, executions: [], evaluation: null, portfolio } as unknown as SubmitOrderResult;
    api.submit.mockResolvedValue(result);
    await render();

    await type('Units', '50');
    await click('Preview order');
    expect(root.querySelector('.tr-review h3')?.textContent).toBe('Review: buy 50 CTB · Market');
    expect(api.preview).toHaveBeenCalledWith('p1', { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 50 });
    const values = Array.from(root.querySelectorAll('.tr-reviewRows dd')).map((dd) => dd.textContent?.trim());
    expect(values).toContain('1,251 DT');
    expect(values).toContain('501,751 DT');

    await click('Confirm buy');
    expect(fixture.componentInstance.onResult).toHaveBeenCalledWith(result);
    const [, body] = api.submit.mock.calls[0];
    expect(body).toMatchObject({ symbol: 'CTB', quantity: 50, expectedVersion: 3, quoteAsOf: quote.asOf });
    expect(body.clientOrderId).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(fixture.componentInstance.draft().quantity).toBe('');
  });

  it('does not offer to confirm an order the server would reject', async () => {
    api.preview.mockResolvedValue(
      previewResult({
        accepted: false,
        executesNow: false,
        rejection: { code: 'INSUFFICIENT_CASH', message: 'This order needs 2,001.000 DT but only 1,000.000 DT is available.' },
      }),
    );
    await render();
    await type('Units', '200');
    await click('Preview order');
    expect(root.querySelector('.tr-review h3')?.textContent).toBe('This order would be rejected');
    expect(root.textContent).toMatch(/only 1,000.000 DT is available/);
    expect(button(/Confirm/)).toBeUndefined();
  });

  it('re-previews when the quote moved, keeping the same order reference', async () => {
    api.preview
      .mockResolvedValueOnce(previewResult())
      .mockResolvedValueOnce(previewResult({ quote: { symbol: 'CTB', ...quote, asOf: '2026-11-09T10:05:00.000Z' } }));
    api.submit.mockRejectedValueOnce(new ApiError(409, 'The price has moved.', 'QUOTE_CHANGED'));
    await render();

    await type('Units', '50');
    await click('Preview order');
    await click('Confirm buy');

    expect(root.textContent).toMatch(/The price moved to a new quote before you confirmed/);
    expect(api.preview).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.onStale).toHaveBeenCalled();

    api.submit.mockResolvedValueOnce({ replayed: false, order: { status: 'FILLED' }, executions: [], evaluation: null, portfolio });
    await click('Confirm buy');
    expect(api.submit).toHaveBeenCalledTimes(2);
    expect(api.submit.mock.calls[1][1].clientOrderId).toBe(api.submit.mock.calls[0][1].clientOrderId);
    expect(api.submit.mock.calls[1][1].quoteAsOf).toBe('2026-11-09T10:05:00.000Z');
  });

  it('only allows stop orders on the sell side', async () => {
    await render();
    await click('Stop-loss');
    await type('Units', '5');
    await type('Stop price (DT)', '9.5');
    await click('Preview order');
    expect(root.textContent).toMatch(/Stop orders are protective sells/);
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('asks for a portfolio when there is none', async () => {
    await render();
    fixture.componentInstance.portfolio.set(null);
    await fixture.whenStable();
    expect(root.textContent).toContain('Create a portfolio to trade');
    expect(root.querySelector('form')).toBeNull();
  });
});
