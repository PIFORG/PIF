import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  MarketApi,
  PortfolioApi,
  rememberPortfolio,
  rememberedPortfolio,
  type AssetClass,
  type ExecutionView,
  type HistoryRange,
  type MarketSnapshot,
  type OrderView,
  type PortfolioSummary,
  type PriceHistory,
  type SubmitOrderResult,
} from '../core/api/trading-api';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { IconComponent } from '../shared/icon/icon.component';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { OrderTicketComponent } from './order-ticket.component';
import { emptyTicket, type TicketDraft } from './ticket-draft';
import { dateTime, describeTradingError, dt, pct, price, shortTime, units } from './trading-format';
import {
  CreatePortfolioFormComponent,
  PortfolioPickerComponent,
  ProvenanceNoteComponent,
  SignedAmountComponent,
} from './trading-parts.components';
import { OrdersTableComponent, PositionsTableComponent, TradesTableComponent } from './trading-tables.components';

const RANGES: HistoryRange[] = ['1D', '5D', '1M', '3M', '6M', 'ALL'];
const REFRESH_MS = 30_000;

type Filter = 'ALL' | 'WATCHLIST' | AssetClass;
interface Toast {
  tone: 'pos' | 'neg' | 'amber';
  text: string;
}

export function resultMessage(result: SubmitOrderResult): Toast {
  const { order, executions } = result;
  const verb = order.side === 'BUY' ? 'Acheté' : 'Vendu';
  const prefix = result.replayed ? 'Cet ordre avait déjà été passé ; voici son résultat. ' : '';
  const fees = executions.reduce((sum, e) => sum + e.fee, 0);
  const filled =
    order.filledQuantity > 0
      ? `${verb} ${units(order.filledQuantity)} ${order.symbol} à ${price(order.averagePrice)} DT en moyenne (frais ${dt(fees)}).`
      : '';
  switch (order.status) {
    case 'REJECTED':
      return { tone: 'neg', text: `${prefix}Ordre refusé : ${order.statusReason ?? 'il n\'a pas passé les contrôles.'}` };
    case 'FILLED':
      return { tone: 'pos', text: `${prefix}${filled}` };
    case 'CANCELLED':
    case 'EXPIRED':
      return { tone: 'amber', text: `${prefix}${filled} ${order.statusReason ?? ''}`.trim() };
    case 'PARTIALLY_FILLED':
      return { tone: 'amber', text: `${prefix}${filled} Les ${units(order.remainingQuantity)} unités restantes restent actives.` };
    case 'OPEN':
    default: {
      const what =
        order.type === 'STOP'
          ? `Stop-loss placé : ${units(order.quantity)} ${order.symbol} seront vendus au bid s'il descend à ${price(order.stopPrice)} DT.`
          : `Votre ordre ${order.side === 'BUY' ? 'd\'achat' : 'de vente'} à cours limité de ${units(order.quantity)} ${order.symbol} à ${price(order.limitPrice)} DT est en cours.`;
      return { tone: 'pos', text: `${prefix}${what}${order.expiresAt ? ` Il expire le ${dateTime(order.expiresAt)} s'il n'est pas exécuté.` : ''}` };
    }
  }
}

/** /trading: apps/web/src/components/trading/TradingDesk.tsx */
@Component({
  selector: 'mtr-trading-desk-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IconComponent,
    PageHeadingComponent,
    HeadingActionsSlot,
    ...WORKSPACE_PRIMITIVES,
    LineChartComponent,
    OrderTicketComponent,
    CreatePortfolioFormComponent,
    PortfolioPickerComponent,
    ProvenanceNoteComponent,
    SignedAmountComponent,
    OrdersTableComponent,
    PositionsTableComponent,
    TradesTableComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './trading-desk.page.html',
})
export class TradingDeskPage {
  private readonly marketApi = inject(MarketApi);
  private readonly portfolioApi = inject(PortfolioApi);
  private destroyed = false;

  protected readonly portfolios = signal<PortfolioSummary[] | null>(null);
  protected readonly activeId = signal<string | null>(null);
  protected readonly portfolioError = signal<string | null>(null);

  protected readonly market = signal<MarketSnapshot | null>(null);
  protected readonly marketError = signal<string | null>(null);
  protected readonly watched = signal<Set<string>>(new Set());
  protected readonly query = signal('');
  protected readonly filter = signal<Filter>('ALL');

  protected readonly draft = signal<TicketDraft>(emptyTicket());
  protected readonly range = signal<HistoryRange>('1D');
  protected readonly history = signal<PriceHistory | null>(null);
  protected readonly historyError = signal<string | null>(null);

  protected readonly openOrders = signal<OrderView[] | null>(null);
  protected readonly trades = signal<ExecutionView[] | null>(null);
  protected readonly cancelling = signal<string | null>(null);
  protected readonly toast = signal<Toast | null>(null);

  protected readonly ranges = RANGES;
  protected readonly dash = '\u2014';
  protected readonly dt = dt;
  protected readonly price = price;
  protected readonly units = units;
  protected readonly shortTime = shortTime;
  protected readonly dateTime = dateTime;

  protected readonly portfolio = computed(() => this.portfolios()?.find((p) => p.id === this.activeId()) ?? null);
  protected readonly symbol = computed(() => this.draft().symbol);
  protected readonly instrument = computed(() => this.market()?.instruments.find((i) => i.symbol === this.symbol()) ?? null);
  protected readonly loading = computed(() => this.portfolios() === null);
  /** The portfolios offered by the heading picker, or null when there is nothing to pick. */
  protected readonly pickable = computed(() => {
    const list = this.portfolios();
    return list && list.length > 0 ? list : null;
  });
  protected readonly held = computed(() => this.portfolio()?.positions.find((p) => p.symbol === this.symbol()) ?? null);

  protected readonly visible = computed(() => {
    const text = this.query().trim().toLowerCase();
    const filter = this.filter();
    const watched = this.watched();
    return (this.market()?.instruments ?? []).filter((i) => {
      if (filter === 'WATCHLIST' && !watched.has(i.symbol)) return false;
      if ((filter === 'EQUITY' || filter === 'FUND') && i.assetClass !== filter) return false;
      return !text || i.symbol.toLowerCase().includes(text) || i.name.toLowerCase().includes(text) || i.sector.toLowerCase().includes(text);
    });
  });

  /** The chart of the selected instrument, or null while its history is missing or belongs to another symbol. */
  protected readonly chart = computed(() => {
    const history = this.history();
    const symbol = this.symbol();
    if (!history || history.symbol !== symbol) return null;
    const values = history.points.map((p) => p.mid);
    const first = history.points[0];
    const last = history.points[history.points.length - 1];
    const rangeChange = first && last && first.mid > 0 ? last.mid / first.mid - 1 : null;
    if (values.length <= 1) return { enough: false as const };
    const series: ChartSeries[] = [{ label: `${symbol} cours mid`, values, tone: 'brand', area: true }];
    return {
      enough: true as const,
      series,
      summary: `${symbol} mid price over ${this.range()}: from ${price(first?.mid)} to ${price(last?.mid)} DT${rangeChange !== null ? `, ${pct(rangeChange, true)}` : ''}.`,
      xLabels: [first ? dateTime(first.at) : '', last ? dateTime(last.at) : ''] as [string, string],
      minSpan: (last?.mid ?? 1) * 0.01,
      resolution: history.resolution,
      rangeChange,
    };
  });
  protected readonly formatAxis = (v: number) => v.toFixed(2);

  constructor() {
    void this.loadPortfolios();
    void this.loadMarket();
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));

    effect(() => {
      const id = this.activeId();
      untracked(() => {
        rememberPortfolio(id);
        this.openOrders.set(null);
        this.trades.set(null);
        if (id) void this.loadActivity(id);
      });
    });

    /* Quotes move every 5 minutes and resting orders are matched when the portfolio is read. */
    effect((onCleanup) => {
      const id = this.activeId();
      const timer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        void this.loadMarket();
        if (id) void this.loadActivity(id);
      }, REFRESH_MS);
      onCleanup(() => window.clearInterval(timer));
    });

    effect((onCleanup) => {
      const symbol = this.symbol();
      const range = this.range();
      if (!symbol) return;
      let cancelled = false;
      untracked(() => this.historyError.set(null));
      this.marketApi
        .history(symbol, range)
        .then((data) => {
          if (!cancelled) this.history.set(data);
        })
        .catch((err) => {
          if (!cancelled) {
            this.history.set(null);
            this.historyError.set(describeTradingError(err, 'L\'historique des prix n\'a pas pu être chargé.'));
          }
        });
      onCleanup(() => (cancelled = true));
    });
  }

  private replacePortfolio(next: PortfolioSummary): void {
    this.portfolios.update((list) => (list ? list.map((p) => (p.id === next.id ? next : p)) : [next]));
  }

  private async loadPortfolios(): Promise<void> {
    try {
      const { portfolios: list } = await this.portfolioApi.list();
      if (this.destroyed) return;
      this.portfolios.set(list);
      this.portfolioError.set(null);
      const wanted = this.activeId() ?? rememberedPortfolio();
      this.activeId.set(list.find((p) => p.id === wanted)?.id ?? list[0]?.id ?? null);
    } catch (err) {
      if (this.destroyed) return;
      this.portfolios.update((list) => list ?? []);
      this.portfolioError.set(describeTradingError(err, 'Vos portefeuilles n\'ont pas pu être chargés.'));
    }
  }

  protected async loadMarket(): Promise<void> {
    try {
      const [data, watchlist] = await Promise.all([this.marketApi.instruments(), this.marketApi.watchlist()]);
      if (this.destroyed) return;
      this.market.set(data);
      this.watched.set(new Set(watchlist.items.map((item) => item.instrument.symbol)));
      this.marketError.set(null);
      this.draft.update((d) => {
        if (d.symbol) return d;
        const requested = new URLSearchParams(window.location.search).get('symbol');
        const initial = data.instruments.find((i) => i.symbol === requested) ?? data.instruments[0];
        return { ...d, symbol: initial?.symbol ?? '' };
      });
    } catch (err) {
      if (!this.destroyed) this.marketError.set(describeTradingError(err, 'Les données de marché n\'ont pas pu être chargées.'));
    }
  }

  private async loadActivity(id: string): Promise<void> {
    try {
      const [orders, executions, summary] = await Promise.all([
        this.portfolioApi.orders(id, 'open', 50),
        this.portfolioApi.executions(id, 15),
        this.portfolioApi.get(id),
      ]);
      if (this.destroyed) return;
      this.openOrders.set(orders.orders);
      this.trades.set(executions.executions);
      this.replacePortfolio(summary);
    } catch (err) {
      if (!this.destroyed) this.portfolioError.set(describeTradingError(err, 'L\'activité du portefeuille n\'a pas pu être chargée.'));
    }
  }

  protected async toggleWatch(target: string): Promise<void> {
    const isWatched = this.watched().has(target);
    try {
      const { items } = isWatched ? await this.marketApi.unwatch(target) : await this.marketApi.watch(target);
      if (!this.destroyed) this.watched.set(new Set(items.map((item) => item.instrument.symbol)));
    } catch (err) {
      if (!this.destroyed) this.toast.set({ tone: 'neg', text: describeTradingError(err, 'La liste de suivi n\'a pas pu être mise à jour.') });
    }
  }

  protected selectSymbol(next: string, side?: 'BUY' | 'SELL'): void {
    this.draft.update((d) =>
      d.symbol === next && !side
        ? d
        : { ...emptyTicket(next), side: side ?? d.side, type: d.type === 'STOP' && side !== 'SELL' ? 'MARKET' : d.type },
    );
  }

  protected onResult(result: SubmitOrderResult): void {
    this.replacePortfolio(result.portfolio);
    this.toast.set(resultMessage(result));
    const id = this.activeId();
    if (id) void this.loadActivity(id);
  }

  protected onStale(): void {
    const id = this.activeId();
    if (id) void this.loadActivity(id);
  }

  protected onCreated(created: PortfolioSummary): void {
    this.portfolios.update((list) => [...(list ?? []), created]);
    this.activeId.set(created.id);
  }

  protected async cancelOrder(order: OrderView): Promise<void> {
    const id = this.activeId();
    if (!id) return;
    this.cancelling.set(order.id);
    try {
      const result = await this.portfolioApi.cancel(id, order.id);
      if (this.destroyed) return;
      this.replacePortfolio(result.portfolio);
      this.toast.set({ tone: 'amber', text: `Ordre ${order.side === 'BUY' ? 'd\'achat' : 'de vente'} de ${order.symbol} annulé.` });
      await this.loadActivity(id);
    } catch (err) {
      if (this.destroyed) return;
      this.toast.set({ tone: 'neg', text: describeTradingError(err, 'L\'ordre n\'a pas pu être annulé.') });
      await this.loadActivity(id);
    } finally {
      if (!this.destroyed) this.cancelling.set(null);
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setFilter(event: Event): void {
    this.filter.set(this.value(event) as Filter);
  }
}
