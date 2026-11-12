import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  PortfolioApi,
  rememberPortfolio,
  rememberedPortfolio,
  type EquityHistory,
  type Metric,
  type OrderTerms,
  type PortfolioAnalytics,
  type PortfolioSummary,
  type PreTradeRiskResult,
  type TradeSide,
} from '../core/api/trading-api';
import { formatNumber } from '../core/format/finance';
import { sectorLabel } from '../trading/trading-format';
import { FR } from '../core/i18n/fr';
import { AllocationBarComponent, LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { dateTime, describeTradingError, dt, pct } from '../trading/trading-format';
import { MetricValueComponent, PortfolioPickerComponent, ProvenanceNoteComponent, SignedAmountComponent } from '../trading/trading-parts.components';

interface Detail {
  analytics: PortfolioAnalytics;
  history: EquityHistory;
}

@Component({
  selector: 'div[mtr-risk-metric-row]',
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
export class RiskMetricRowComponent {
  readonly label = input.required<string>();
  readonly metric = input.required<Metric>();
  readonly format = input.required<(value: number) => string>();
}

/** /risk: portfolio risk analytics from GET /portfolios/:id/analytics and /history */
@Component({
  selector: 'mtr-risk-analytics-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    PageHeadingComponent,
    HeadingActionsSlot,
    ...WORKSPACE_PRIMITIVES,
    LineChartComponent,
    AllocationBarComponent,
    MetricValueComponent,
    PortfolioPickerComponent,
    ProvenanceNoteComponent,
    SignedAmountComponent,
    RiskMetricRowComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './risk-analytics.page.html',
})
export class RiskAnalyticsPage {
  private readonly api = inject(PortfolioApi);
  private destroyed = false;

  protected readonly copy = FR.risk;
  protected readonly nav = FR.nav;
  protected readonly portfolios = signal<PortfolioSummary[] | null>(null);
  protected readonly activeId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = signal<Detail | null>(null);
  protected readonly detailError = signal<string | null>(null);

  protected readonly preSymbol = signal('CTB');
  protected readonly preSide = signal<TradeSide>('BUY');
  protected readonly preQuantity = signal(10);
  protected readonly preTrade = signal<PreTradeRiskResult | null>(null);
  protected readonly preTradeError = signal<string | null>(null);
  protected readonly preTradeLoading = signal(false);

  protected readonly dt = dt;
  protected readonly pct = pct;
  protected readonly dateTime = dateTime;
  protected readonly signedPct = (v: number) => pct(v, true);
  protected readonly plainPct = (v: number) => pct(v);
  protected readonly twoDecimals = (v: number) => formatNumber(v, 2);

  protected readonly portfolio = computed(() => this.portfolios()?.find((p) => p.id === this.activeId()) ?? null);
  protected readonly hasPortfolios = computed(() => (this.portfolios()?.length ?? 0) > 0);
  protected readonly analytics = computed(() => this.detail()?.analytics ?? null);

  protected readonly equityChart = computed(() => {
    const points = this.detail()?.history.points ?? [];
    if (points.length <= 2) {
      return {
        enough: false as const,
        description: `Le graphique commence après la première fin de journée du portefeuille (00:00 UTC). Pour l'instant : ${dt(points[0]?.equity ?? 0)} à la création, ${dt(points[points.length - 1]?.equity ?? 0)} maintenant. Le drawdown des indicateurs utilise un indice ajusté des flux, calculé par le serveur.`,
      };
    }
    const first = points[0];
    const last = points[points.length - 1];
    const series: ChartSeries[] = [
      { label: 'Valeur', values: points.map((p) => p.equity), tone: 'brand', area: true },
      { label: 'Apports nets', values: points.map((p) => p.netContributions), tone: 'muted', dashed: true },
    ];
    return {
      enough: true as const,
      series,
      summary: `La valeur est passée de ${dt(first.equity)} à ${dt(last.equity)} ; les apports nets sont de ${dt(last.netContributions)}. Le drawdown maximal ci-dessus porte sur un indice pondéré dans le temps, pas sur cette courbe brute.`,
      xLabels: [dateTime(first.at), dateTime(last.at)] as [string, string],
      minSpan: Math.max(1, last.equity * 0.01),
    };
  });

  /** Client visual of peak-to-trough on raw equity (illustrative). KPI drawdown remains the server flow-adjusted metric. */
  protected readonly drawdownChart = computed(() => {
    const points = this.detail()?.history.points ?? [];
    if (points.length <= 2) return { enough: false as const };
    let peak = points[0].equity;
    const dd: number[] = [];
    for (const p of points) {
      peak = Math.max(peak, p.equity);
      dd.push(peak > 0 ? (peak - p.equity) / peak : 0);
    }
    const first = points[0];
    const last = points[points.length - 1];
    return {
      enough: true as const,
      series: [{ label: 'Repli (valeur brute)', values: dd, tone: 'muted', area: true }] as ChartSeries[],
      summary: `Repli illustratif sur la valeur brute (flux non retirés). L'indicateur serveur utilise l'indice pondéré dans le temps.`,
      xLabels: [dateTime(first.at), dateTime(last.at)] as [string, string],
      minSpan: 0.01,
    };
  });

  protected readonly allocationItems = computed(() => {
    const a = this.analytics();
    if (!a) return [];
    return [
      ...a.allocation.byInstrument.filter((line) => line.weight !== null).map((line) => ({ label: line.name, weight: line.weight as number })),
      ...(a.allocation.cash.weight !== null ? [{ label: 'Espèces', weight: a.allocation.cash.weight }] : []),
    ];
  });

  protected readonly assetClassItems = computed(() => {
    const a = this.analytics();
    if (!a) return [];
    return a.allocation.byAssetClass
      .filter((line) => line.weight !== null)
      .map((line) => ({ label: sectorLabel(line.name), weight: line.weight as number }));
  });

  constructor() {
    void this.loadPortfolios();
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));

    effect(() => {
      const id = this.activeId();
      untracked(() => {
        rememberPortfolio(id);
        this.detail.set(null);
        this.preTrade.set(null);
        this.preTradeError.set(null);
        if (id) void this.loadDetail(id);
      });
    });
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
      this.portfolios.set([]);
      this.error.set(describeTradingError(err, 'Your portfolios could not be loaded.'));
    }
  }

  protected async loadDetail(id: string): Promise<void> {
    this.detailError.set(null);
    try {
      const [analytics, history, summary] = await Promise.all([this.api.analytics(id), this.api.history(id), this.api.get(id)]);
      if (this.destroyed) return;
      this.detail.set({ analytics, history });
      this.portfolios.update((list) => (list ? list.map((p) => (p.id === summary.id ? summary : p)) : [summary]));
    } catch (err) {
      if (!this.destroyed) this.detailError.set(describeTradingError(err, 'Risk analytics could not be loaded.'));
    }
  }

  protected retryDetail(): void {
    const id = this.activeId();
    if (id) void this.loadDetail(id);
  }

  protected async runPreTrade(): Promise<void> {
    const id = this.activeId();
    if (!id) return;
    this.preTradeLoading.set(true);
    this.preTradeError.set(null);
    const terms: OrderTerms = {
      symbol: this.preSymbol().trim().toUpperCase(),
      side: this.preSide(),
      type: 'MARKET',
      quantity: Math.max(1, Math.floor(Number(this.preQuantity()) || 0)),
    };
    try {
      const result = await this.api.preTradeRisk(id, terms);
      if (!this.destroyed) this.preTrade.set(result);
    } catch (err) {
      if (!this.destroyed) {
        this.preTrade.set(null);
        this.preTradeError.set(describeTradingError(err, 'Pre-trade risk could not be evaluated.'));
      }
    } finally {
      if (!this.destroyed) this.preTradeLoading.set(false);
    }
  }
}
