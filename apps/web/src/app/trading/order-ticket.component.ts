import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { hasErrorCode } from '../core/api/errors';
import {
  PortfolioApi,
  type InstrumentView,
  type OrderPreviewResult,
  type PortfolioSummary,
  type SubmitOrderResult,
  type TradeOrderType,
  type TradeSide,
} from '../core/api/trading-api';
import { EmptyStateComponent } from '../shared/workspace/workspace.components';
import { emptyTicket, termsKey, ticketErrors, toOrderTerms, type TicketDraft } from './ticket-draft';
import { describeTradingError, dt, price, shortTime, units } from './trading-format';

const TYPE_LABEL: Record<TradeOrderType, string> = { MARKET: 'Market', LIMIT: 'Limit', STOP: 'Stop-loss' };

function newClientOrderId(): string {
  const source: Crypto = globalThis.crypto;
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** apps/web/src/components/trading/OrderTicket.tsx. Previews and fills come from the server; nothing is simulated here. */
@Component({
  selector: 'mtr-order-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent],
  host: { style: 'display: contents' },
  templateUrl: './order-ticket.component.html',
})
export class OrderTicketComponent {
  private readonly api = inject(PortfolioApi);

  readonly portfolio = input.required<PortfolioSummary | null>();
  readonly instruments = input.required<InstrumentView[]>();
  readonly draft = model.required<TicketDraft>();
  readonly result = output<SubmitOrderResult>();
  /** Emitted when the server says our view of the portfolio is out of date. */
  readonly stale = output<void>();

  protected readonly preview = signal<{ key: string; result: OrderPreviewResult } | null>(null);
  protected readonly busy = signal<'preview' | 'submit' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly showErrors = signal(false);
  private readonly now = signal(Date.now());
  /** One idempotency key per order intent: a retried confirm can never place the same order twice. */
  private intent: { key: string; clientOrderId: string } | null = null;

  protected readonly typeLabel = TYPE_LABEL;
  protected readonly sides: TradeSide[] = ['BUY', 'SELL'];
  protected readonly types: TradeOrderType[] = ['MARKET', 'LIMIT', 'STOP'];
  protected readonly dt = dt;
  protected readonly price = price;
  protected readonly units = units;
  protected readonly shortTime = shortTime;

  protected readonly instrument = computed(() => this.instruments().find((i) => i.symbol === this.draft().symbol) ?? null);
  protected readonly errors = computed(() => ticketErrors(this.draft(), this.instrument()?.lotSize ?? 1));
  private readonly valid = computed(() => Object.keys(this.errors()).length === 0);
  private readonly currentKey = computed(() => (this.valid() ? termsKey(toOrderTerms(this.draft())) : null));
  protected readonly review = computed(() => {
    const preview = this.preview();
    return preview && preview.key === this.currentKey() ? preview.result : null;
  });
  protected readonly held = computed(
    () => this.portfolio()?.positions.find((p) => p.symbol === this.draft().symbol)?.quantity ?? 0,
  );
  protected readonly expired = computed(() => {
    const review = this.review();
    return review ? this.now() >= new Date(review.quote.validUntil).getTime() : false;
  });
  protected readonly sideWord = computed(() => (this.draft().side === 'BUY' ? 'buy' : 'sell'));
  protected readonly quote = computed(() => this.instrument()?.quote ?? null);
  protected readonly priceError = computed(() => this.errors().limitPrice ?? this.errors().stopPrice);
  protected readonly confirmable = computed(() => {
    const review = this.review();
    return !!review && !review.rejection;
  });
  protected readonly reviewTitle = computed(() => {
    const draft = this.draft();
    return `Review: ${this.sideWord()} ${units(Number(draft.quantity))} ${draft.symbol} · ${TYPE_LABEL[draft.type]}`;
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.review()) return;
      const timer = window.setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => window.clearInterval(timer));
    });
  }

  protected update(patch: Partial<TicketDraft>): void {
    this.error.set(null);
    this.notice.set(null);
    this.draft.set({ ...this.draft(), ...patch });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected async requestPreview(reason?: string): Promise<void> {
    const portfolio = this.portfolio();
    if (!portfolio) return;
    this.showErrors.set(true);
    const key = this.currentKey();
    if (!this.valid() || !key) return;
    this.busy.set('preview');
    this.error.set(null);
    this.notice.set(reason ?? null);
    try {
      const result = await this.api.preview(portfolio.id, toOrderTerms(this.draft()));
      if (this.intent?.key !== key) this.intent = { key, clientOrderId: newClientOrderId() };
      this.now.set(Date.now());
      this.preview.set({ key, result });
    } catch (err) {
      this.preview.set(null);
      this.error.set(describeTradingError(err, 'The order could not be previewed.'));
    } finally {
      this.busy.set(null);
    }
  }

  private async confirm(): Promise<void> {
    const portfolio = this.portfolio();
    const review = this.review();
    const intent = this.intent;
    if (!portfolio || !review || !this.currentKey() || !intent || review.rejection) return;
    if (this.expired()) {
      await this.requestPreview(
        'The quote you previewed has expired. Here is the order at the new price; confirm again if it still suits you.',
      );
      return;
    }
    const draft = this.draft();
    this.busy.set('submit');
    this.error.set(null);
    this.notice.set(null);
    try {
      const result = await this.api.submit(portfolio.id, {
        ...toOrderTerms(draft),
        clientOrderId: intent.clientOrderId,
        expectedVersion: review.portfolioVersion,
        quoteAsOf: review.quote.asOf,
      });
      this.intent = null;
      this.preview.set(null);
      this.showErrors.set(false);
      this.draft.set({ ...emptyTicket(draft.symbol), side: draft.side, type: draft.type });
      this.result.emit(result);
    } catch (err) {
      if (hasErrorCode(err, 'QUOTE_CHANGED', 'PORTFOLIO_CHANGED')) {
        this.stale.emit();
        this.busy.set(null);
        await this.requestPreview(
          hasErrorCode(err, 'QUOTE_CHANGED')
            ? 'The price moved to a new quote before you confirmed. The preview below uses the new price.'
            : 'Your portfolio changed (an order filled or cash moved). The preview below is up to date.',
        );
        return;
      }
      if (hasErrorCode(err, 'DUPLICATE_SUBMISSION')) this.stale.emit();
      this.error.set(
        err instanceof TypeError
          ? 'The server could not be reached, so we cannot tell whether the order was placed. Confirm again: the same order reference is reused, so it can never be placed twice.'
          : describeTradingError(err, 'The order could not be submitted.'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const review = this.review();
    if (review && !review.rejection) void this.confirm();
    else void this.requestPreview();
  }
}
