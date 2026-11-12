import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SAMPLE_CURRENCY, sampleBenchmarkCurve, sampleEquityCurve, sampleRisk, sampleSummary, sampleWatchlist } from '../core/demo/sample-workspace';
import { formatMoney, formatNumber, formatPercent } from '../core/format/finance';
import { EmblemComponent } from '../shared/brand/brand.component';
import { LineChartComponent, SparklineComponent, type ChartSeries } from '../shared/charts/charts.components';
import { ChangeComponent, DemoModeLabelComponent } from '../shared/workspace/workspace.components';

/** apps/web/src/components/marketing/ProductPreview.tsx: code-built composition of the workspace, rendered from labelled sample fixtures. */
@Component({
  selector: 'figure[mtr-product-preview]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmblemComponent, LineChartComponent, SparklineComponent, ChangeComponent, DemoModeLabelComponent],
  host: { class: 'mk-window', 'aria-labelledby': 'preview-caption' },
  template: `
    <div class="mk-chrome" aria-hidden="true">
      <span class="mk-dots"><i></i><i></i><i></i></span>
      <span class="mk-chromeTitle">Market Trading Room — Vue d'ensemble</span>
    </div>
    <div class="mk-body">
      <div class="mk-rail" aria-hidden="true">
        <svg mtrEmblem [size]="22"></svg>
        @for (i of railItems; track i) {
          <span class="mk-railItem" [attr.data-active]="i === 0 ? 'true' : null"></span>
        }
      </div>
      <div class="mk-content">
        <div class="mk-head">
          <div>
            <p class="mk-headLabel">Valeur du portefeuille simulé</p>
            <p class="mk-headValue num">{{ equity }}</p>
          </div>
          <div class="mk-headMeta">
            <span mtr-change [value]="summary.dayChangePct"></span>
            <span mtr-demo-label></span>
          </div>
        </div>
        <div class="mk-grid">
          <div class="mk-chartCard">
            <figure
              mtr-line-chart
              [height]="150"
              summary="Graphique d'exemple : portefeuille simulé fictif comparé à un indice fictif sur 64 séances."
              [formatY]="formatAxis"
              [series]="series"
            ></figure>
          </div>
          <div class="mk-side">
            <ul class="mk-watch" aria-label="Liste de surveillance (exemple)">
              @for (q of watchlist; track q.symbol) {
                <li>
                  <span class="mk-sym">{{ q.symbol }}</span>
                  <svg mtr-sparkline [values]="q.spark" [width]="56" [height]="18" [label]="q.symbol + ' — tendance exemple'"></svg>
                  <span class="mk-quote">
                    <span class="num">{{ formatNumber(q.last) }}</span>
                    <span mtr-change [value]="q.change"></span>
                  </span>
                </li>
              }
            </ul>
            <dl class="mk-risk">
              <div>
                <dt>VaR 1 jour (95 %)</dt>
                <dd class="num">{{ var95 }}</dd>
              </div>
              <div>
                <dt>Volatilité</dt>
                <dd class="num">{{ volatility }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
    <figcaption id="preview-caption" class="mk-caption">Aperçu produit à partir de données d'exemple fictives. Ce ne sont ni des cotations de marché ni un compte réel.</figcaption>
  `,
})
export class ProductPreviewComponent {
  protected readonly summary = sampleSummary();
  protected readonly equity = formatMoney(this.summary.equity, SAMPLE_CURRENCY);
  protected readonly railItems = [0, 1, 2, 3, 4, 5];
  protected readonly series: ChartSeries[] = [
    { label: 'Portefeuille (exemple)', values: sampleEquityCurve.map((p) => p.value), tone: 'brand', area: true },
    { label: 'Indice (exemple)', values: sampleBenchmarkCurve.map((p) => p.value), tone: 'muted', dashed: true },
  ];
  protected readonly formatAxis = (v: number) => formatMoney(v, SAMPLE_CURRENCY, { compact: true });
  protected readonly watchlist = sampleWatchlist.slice(0, 4);
  protected readonly formatNumber = formatNumber;
  protected readonly var95 = formatPercent(sampleRisk.var95);
  protected readonly volatility = formatPercent(sampleRisk.annualVolatility, { digits: 1 });
}
