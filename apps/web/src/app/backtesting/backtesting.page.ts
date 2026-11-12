import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BACKTEST_STRATEGIES,
  BacktestApi,
  type BacktestResult,
  type BacktestStrategyId,
} from '../core/api/backtest-api';
import { MarketApi, type InstrumentView } from '../core/api/trading-api';
import { formatNumber } from '../core/format/finance';
import { FR } from '../core/i18n/fr';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { dateTime, describeTradingError, dt, pct } from '../trading/trading-format';
import { ProvenanceNoteComponent, SignedAmountComponent } from '../trading/trading-parts.components';

@Component({
  selector: 'mtr-backtesting-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    PageHeadingComponent,
    ...WORKSPACE_PRIMITIVES,
    LineChartComponent,
    ProvenanceNoteComponent,
    SignedAmountComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './backtesting.page.html',
})
export class BacktestingPage {
  private readonly backtests = inject(BacktestApi);
  private readonly market = inject(MarketApi);
  private destroyed = false;

  protected readonly copy = FR.backtesting;
  protected readonly nav = FR.nav;
  protected readonly strategies = BACKTEST_STRATEGIES;
  protected readonly instruments = signal<InstrumentView[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly runError = signal<string | null>(null);
  protected readonly running = signal(false);
  protected readonly result = signal<BacktestResult | null>(null);

  protected readonly strategy = signal<BacktestStrategyId>('BUY_AND_HOLD');
  protected readonly selected = signal<string[]>(['CTB']);
  protected readonly start = signal('2026-01-01T00:00:00.000Z');
  protected readonly end = signal(new Date().toISOString());
  protected readonly initialCash = signal(100_000);
  protected readonly feeBps = signal(25);
  protected readonly slippageBps = signal(5);
  protected readonly shortPeriod = signal(10);
  protected readonly longPeriod = signal(30);
  protected readonly rebalanceEvery = signal(21);

  protected readonly dt = dt;
  protected readonly pct = pct;
  protected readonly dateTime = dateTime;
  protected readonly twoDecimals = (v: number) => formatNumber(v, 2);
  protected readonly plainPct = (v: number) => pct(v);

  protected readonly showMaParams = computed(() => this.strategy() === 'MA_CROSSOVER');
  protected readonly showRebalanceParams = computed(() => this.strategy() === 'PERIODIC_REBALANCE');

  protected readonly equityChart = computed(() => {
    const points = this.result()?.equityCurve ?? [];
    if (points.length < 2) return { enough: false as const };
    const series: ChartSeries[] = [{ label: 'Valeur', values: points.map((p) => p.equity), tone: 'brand', area: true }];
    const first = points[0];
    const last = points[points.length - 1];
    return {
      enough: true as const,
      series,
      summary: `Valeur de ${dt(first.equity)} à ${dt(last.equity)}.`,
      xLabels: [dateTime(first.at), dateTime(last.at)] as [string, string],
      minSpan: Math.max(1, last.equity * 0.01),
    };
  });

  protected readonly drawdownChart = computed(() => {
    const points = this.result()?.drawdown ?? [];
    if (points.length < 2) return { enough: false as const };
    const series: ChartSeries[] = [
      { label: 'Repli', values: points.map((p) => -p.drawdown), tone: 'cyan', area: true },
    ];
    const first = points[0];
    const last = points[points.length - 1];
    return {
      enough: true as const,
      series,
      summary: `Repli en fraction négative de la valeur au pic.`,
      xLabels: [dateTime(first.at), dateTime(last.at)] as [string, string],
      minSpan: 0.01,
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.loadInstruments();
  }

  private async loadInstruments(): Promise<void> {
    try {
      const snap = await this.market.instruments();
      if (this.destroyed) return;
      this.instruments.set(snap.instruments);
      this.loadError.set(null);
      if (!this.selected().length && snap.instruments[0]) this.selected.set([snap.instruments[0].symbol]);
    } catch (err) {
      if (this.destroyed) return;
      this.instruments.set([]);
      this.loadError.set(describeTradingError(err, 'Les instruments n\'ont pas pu être chargés.'));
    }
  }

  protected toggleSymbol(symbol: string, checked: boolean): void {
    this.selected.update((list) => {
      if (checked) return list.includes(symbol) ? list : [...list, symbol];
      return list.filter((s) => s !== symbol);
    });
  }

  protected isSelected(symbol: string): boolean {
    return this.selected().includes(symbol);
  }

  protected async run(): Promise<void> {
    if (!this.selected().length) {
      this.runError.set('Sélectionnez au moins un instrument.');
      return;
    }
    this.running.set(true);
    this.runError.set(null);
    try {
      const params: BacktestRunRequestParams = {};
      if (this.strategy() === 'MA_CROSSOVER') {
        params.shortPeriod = this.shortPeriod();
        params.longPeriod = this.longPeriod();
      }
      if (this.strategy() === 'PERIODIC_REBALANCE') params.rebalanceEvery = this.rebalanceEvery();

      const result = await this.backtests.run({
        strategy: this.strategy(),
        symbols: this.selected(),
        start: this.start(),
        end: this.end(),
        params,
        initialCash: this.initialCash(),
        feeBps: this.feeBps(),
        slippageBps: this.slippageBps(),
      });
      if (this.destroyed) return;
      this.result.set(result);
    } catch (err) {
      if (!this.destroyed) this.runError.set(describeTradingError(err, 'Le backtest n\'a pas pu être exécuté.'));
    } finally {
      if (!this.destroyed) this.running.set(false);
    }
  }
}

type BacktestRunRequestParams = {
  shortPeriod?: number;
  longPeriod?: number;
  rebalanceEvery?: number;
};
