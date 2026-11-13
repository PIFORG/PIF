import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { hasErrorCode } from '../core/api/errors';
import {
  PortfolioApi,
  rememberPortfolio,
  rememberedPortfolio,
  type CashEntryView,
  type EquityHistory,
  type ExecutionView,
  type Metric,
  type OrderView,
  type PortfolioAnalytics,
  type PortfolioSummary,
} from '../core/api/trading-api';
import { formatNumber } from '../core/format/finance';
import { AllocationBarComponent, LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { dateTime, describeTradingError, dt, pct, sectorLabel } from './trading-format';
import {
  CreatePortfolioFormComponent,
  MetricValueComponent,
  PortfolioPickerComponent,
  ProvenanceNoteComponent,
  SignedAmountComponent,
} from './trading-parts.components';
import { CashLedgerTableComponent, OrdersTableComponent, PositionsTableComponent, TradesTableComponent } from './trading-tables.components';

interface Detail {
  analytics: PortfolioAnalytics;
  history: EquityHistory;
  orders: OrderView[];
  executions: ExecutionView[];
  entries: CashEntryView[];
}

type HistoryTab = 'orders' | 'trades' | 'cash';

const CASH_AMOUNT = /^\d+(\.\d{1,3})?$/;

@Component({
  selector: 'div[mtr-metric-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MetricValueComponent],
  template: `
    <dt>{{ label() }}</dt>
    <dd>
      <mtr-metric-value [metric]="metric()" [format]="format()" />
      <span class="tr-requirement">{{ metric().requirement }}</span>
    </dd>
  `,
})
export class MetricRowComponent {
  readonly label = input.required<string>();
  readonly metric = input.required<Metric>();
  readonly format = input.required<(value: number) => string>();
}

@Component({
  selector: 'mtr-cash-flow-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <form (submit)="submit($event)" novalidate aria-label="Déposer ou retirer de la trésorerie virtuelle" class="tr-ticket">
      <div class="tr-segmented" role="group" aria-label="Mouvement">
        <button type="button" [attr.aria-pressed]="type() === 'DEPOSIT'" (click)="type.set('DEPOSIT')">Déposer</button>
        <button type="button" [attr.aria-pressed]="type() === 'WITHDRAWAL'" (click)="type.set('WITHDRAWAL')">Retirer</button>
      </div>
      <div class="field">
        <label class="field-label" for="cash-amount">Montant (DT)</label>
        <input
          id="cash-amount"
          class="input num"
          inputmode="decimal"
          autocomplete="off"
          [value]="amount()"
          (input)="amount.set($any($event.target).value)"
          [attr.aria-invalid]="invalid()"
          aria-describedby="cash-amount-hint"
        />
        <p id="cash-amount-hint" [class]="invalid() ? 'field-error' : 'field-hint'">{{ hint() }}</p>
      </div>
      @if (error()) {
        <p class="form-error-banner" role="alert">{{ error() }}</p>
      }
      <button type="submit" class="btn btn-secondary" [disabled]="!valid() || pending()">{{ pending() ? 'Enregistrement…' : type() === 'DEPOSIT' ? 'Déposer' : 'Retirer' }}</button>
    </form>
  `,
})
export class CashFlowFormComponent {
  private readonly api = inject(PortfolioApi);
  readonly portfolio = input.required<PortfolioSummary>();
  /** The refreshed portfolio and a confirmation; the message is empty after a reload caused by a version conflict. */
  readonly done = output<{ summary: PortfolioSummary; message: string }>();

  protected readonly type = signal<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  protected readonly amount = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal(false);
  protected readonly valid = computed(() => {
    const value = Number(this.amount());
    return CASH_AMOUNT.test(this.amount().trim()) && value > 0 && value <= 1_000_000;
  });
  protected readonly invalid = computed(() => this.amount().length > 0 && !this.valid());
  protected readonly hint = computed(() =>
    this.invalid()
      ? 'Saisissez un montant positif jusqu\'à 1 000 000 DT, avec au plus 3 décimales.'
      : this.type() === 'WITHDRAWAL'
        ? `Jusqu'à ${dt(this.portfolio().availableCash)} est disponible au retrait.`
        : 'Trésorerie virtuelle uniquement.',
  );

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.valid() || this.pending()) return;
    const portfolio = this.portfolio();
    const type = this.type();
    const value = Number(this.amount());
    this.pending.set(true);
    this.error.set(null);
    try {
      const summary = await this.api.cashFlow(portfolio.id, { type, amount: value, expectedVersion: portfolio.version });
      this.amount.set('');
      this.done.emit({
        summary,
        message: `${type === 'DEPOSIT' ? 'Déposé' : 'Retiré'} ${dt(value)}. Les dépôts et retraits modifient les capitaux propres mais ne constituent pas un profit.`,
      });
    } catch (err) {
      this.error.set(
        hasErrorCode(err, 'PORTFOLIO_CHANGED')
          ? 'Le portefeuille a changé pendant la saisie (un ordre a peut-être été exécuté). Il a été rechargé ; vérifiez le solde et réessayez.'
          : describeTradingError(err, 'Le mouvement de trésorerie n\'a pas pu être enregistré.'),
      );
      if (hasErrorCode(err, 'PORTFOLIO_CHANGED')) {
        try {
          this.done.emit({ summary: await this.api.get(portfolio.id), message: '' });
        } catch {
          /* the error above already tells the user what to do */
        }
      }
    } finally {
      this.pending.set(false);
    }
  }
}

/** /portfolios: apps/web/src/components/trading/PortfolioWorkspace.tsx */
@Component({
  selector: 'mtr-portfolios-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageHeadingComponent,
    HeadingActionsSlot,
    ...WORKSPACE_PRIMITIVES,
    LineChartComponent,
    AllocationBarComponent,
    CreatePortfolioFormComponent,
    MetricValueComponent,
    PortfolioPickerComponent,
    ProvenanceNoteComponent,
    SignedAmountComponent,
    MetricRowComponent,
    CashFlowFormComponent,
    PositionsTableComponent,
    OrdersTableComponent,
    TradesTableComponent,
    CashLedgerTableComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './portfolios.page.html',
})
export class PortfoliosPage {
  private readonly api = inject(PortfolioApi);
  private destroyed = false;

  protected readonly portfolios = signal<PortfolioSummary[] | null>(null);
  protected readonly activeId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = signal<Detail | null>(null);
  protected readonly detailError = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly tab = signal<HistoryTab>('orders');
  protected readonly message = signal<string | null>(null);

  protected readonly dt = dt;
  protected readonly sectorLabel = sectorLabel;
  protected readonly pct = pct;
  protected readonly dateTime = dateTime;
  protected readonly signedPct = (v: number) => pct(v, true);
  protected readonly plainPct = (v: number) => pct(v);
  protected readonly twoDecimals = (v: number) => formatNumber(v, 2);
  protected readonly wholeNumber = (v: number) => formatNumber(v, 0);

  protected readonly portfolio = computed(() => this.portfolios()?.find((p) => p.id === this.activeId()) ?? null);
  protected readonly hasPortfolios = computed(() => (this.portfolios()?.length ?? 0) > 0);
  protected readonly analytics = computed(() => this.detail()?.analytics ?? null);
  protected readonly showCreate = computed(() => {
    const list = this.portfolios();
    if (list === null) return false;
    return (list.length === 0 || this.creating()) && (!this.error() || this.creating());
  });

  protected readonly equityChart = computed(() => {
    const points = this.detail()?.history.points ?? [];
    if (points.length <= 2) {
      return {
        enough: false as const,
        description: `Le graphique commence après la première fin de journée (00:00 UTC). Pour l'instant : ${dt(points[0]?.equity ?? 0)} à la création, ${dt(points[points.length - 1]?.equity ?? 0)} maintenant.`,
      };
    }
    const first = points[0];
    const last = points[points.length - 1];
    const series: ChartSeries[] = [
      { label: 'Capitaux propres', values: points.map((p) => p.equity), tone: 'brand', area: true },
      { label: 'Apports nets', values: points.map((p) => p.netContributions), tone: 'muted', dashed: true },
    ];
    return {
      enough: true as const,
      series,
      summary: `Capitaux propres de ${dt(first.equity)} à ${dt(last.equity)} ; apports nets ${dt(last.netContributions)}.`,
      xLabels: [dateTime(first.at), dateTime(last.at)] as [string, string],
      minSpan: Math.max(1, last.equity * 0.01),
    };
  });

  protected readonly allocationItems = computed(() => {
    const a = this.analytics();
    if (!a) return [];
    return [
      ...a.allocation.byInstrument.filter((line) => line.weight !== null).map((line) => ({ label: line.name, weight: line.weight as number })),
      ...(a.allocation.cash.weight !== null ? [{ label: 'Trésorerie', weight: a.allocation.cash.weight }] : []),
    ];
  });

  constructor() {
    void this.loadPortfolios();
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));

    effect(() => {
      const id = this.activeId();
      untracked(() => {
        rememberPortfolio(id);
        this.detail.set(null);
        if (id) void this.loadDetail(id);
      });
    });
  }

  private replacePortfolio(summary: PortfolioSummary): void {
    this.portfolios.update((list) => (list ? list.map((p) => (p.id === summary.id ? summary : p)) : [summary]));
  }

  private async loadPortfolios(): Promise<void> {
    try {
      const { portfolios: list } = await this.api.list();
      if (this.destroyed) return;
      this.portfolios.set(list);
      this.error.set(null);
      const wanted = this.activeId() ?? rememberedPortfolio();
      this.activeId.set(list.find((p) => p.id === wanted)?.id ?? list[0]?.id ?? null);
    } catch (err) {
      if (this.destroyed) return;
      this.portfolios.update((list) => list ?? []);
      this.error.set(describeTradingError(err, 'Vos portefeuilles n\'ont pas pu être chargés.'));
    }
  }

  protected async loadDetail(id: string): Promise<void> {
    this.detailError.set(null);
    try {
      const [analytics, history, orders, executions, entries, summary] = await Promise.all([
        this.api.analytics(id),
        this.api.history(id),
        this.api.orders(id, 'all', 100),
        this.api.executions(id, 100),
        this.api.cashEntries(id, 100),
        this.api.get(id),
      ]);
      if (this.destroyed) return;
      this.detail.set({ analytics, history, orders: orders.orders, executions: executions.executions, entries: entries.entries });
      this.replacePortfolio(summary);
    } catch (err) {
      if (!this.destroyed) this.detailError.set(describeTradingError(err, 'Ce portefeuille n\'a pas pu être chargé.'));
    }
  }

  protected retryDetail(): void {
    const id = this.activeId();
    if (id) void this.loadDetail(id);
  }

  protected onCreated(created: PortfolioSummary): void {
    this.portfolios.update((list) => [...(list ?? []), created]);
    this.activeId.set(created.id);
    this.creating.set(false);
  }

  protected onCashFlow({ summary, message }: { summary: PortfolioSummary; message: string }): void {
    this.replacePortfolio(summary);
    if (message) this.message.set(message);
    void this.loadDetail(summary.id);
  }
}
