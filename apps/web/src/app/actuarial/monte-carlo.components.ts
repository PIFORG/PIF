import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Interval, SimulatedProbability, SimulationRunDetail, SimulationRunSummary } from '../core/api/actuarial-api';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { IconComponent } from '../shared/icon/icon.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { count, decimal, probability, ratio, tnd, tndShort, tndWhole } from './actuarial-format';
import { ColumnChartComponent, type ActuarialMessage, type ChartMarker } from './actuarial-parts.components';

/* The result panels of apps/web/src/components/actuarial/MonteCarloLab.tsx. Every figure is read from the stored run. */

export const FREQUENCY_LABEL = { BINOMIAL: 'Binomial', POISSON: 'Poisson' } as const;
export const SEVERITY_LABEL = { DETERMINISTIC: 'Fixed', GAMMA: 'Gamma', LOGNORMAL: 'Lognormal' } as const;
const DASH = '\u2014';

const unbroken = (text: string) => text.replace(/ /g, '\u00a0');
const range = (i: Interval, format: (v: number) => string) => `${unbroken(format(i.lower))} – ${unbroken(format(i.upper))}`;

export function runName(run: Pick<SimulationRunSummary, 'label' | 'seed'>): string {
  return run.label ? `“${run.label}”` : `the run with seed ${run.seed}`;
}

function within(value: boolean | null): string {
  if (value === null) return DASH;
  return value ? 'Yes' : 'No';
}

@Component({
  selector: 'p[mtr-simulated-note]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'ac-provenance' },
  template: `
    <svg mtrIcon name="info" [size]="16" />
    <span>
      <strong>Simulated values from fictional assumptions.</strong> Each figure is a Monte Carlo estimate shown with a 95% confidence interval, next to the exact model value when it
      can be computed. No observed claims data is used.
    </span>
  `,
})
export class SimulatedNoteComponent {}

@Component({
  selector: 'div[mtr-run-kpis]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { class: 'ac-kpis' },
  template: `
    @let r = run().results;
    @let p = r.probabilities;
    <div mtr-kpi label="Simulated mean E[S]" icon="actuarial" [hint]="meanHint()">
      <span class="num">{{ tndShort(r.statistics.mean) }}</span>
    </div>
    <div mtr-kpi label="99.5% VaR" [hint]="'TVaR ' + tndShort(tail().tailValueAtRisk)">
      <span class="num">{{ tndShort(tail().valueAtRisk) }}</span>
    </div>
    <div
      mtr-kpi
      label="P(claims > claims budget)"
      [hint]="'95% CI ' + interval(p.claimsExceedBudget.interval)"
      [tone]="p.claimsExceedBudget.simulated > 0.25 ? 'warning' : 'default'"
    >
      <span class="num">{{ probability(p.claimsExceedBudget.simulated) }}</span>
    </div>
    <div
      mtr-kpi
      label="P(capital insufficient)"
      [hint]="'95% CI ' + interval(p.capitalInsufficient.interval)"
      [tone]="p.capitalInsufficient.simulated > 0.005 ? 'warning' : 'default'"
    >
      <span class="num">{{ probability(p.capitalInsufficient.simulated) }}</span>
    </div>
    <div mtr-kpi label="Expected shortfall" hint="E[(S − budget − capital)⁺]">
      <span class="num">{{ tndShort(r.expectedShortfall) }}</span>
    </div>
  `,
})
export class RunKpisComponent {
  readonly run = input.required<SimulationRunDetail>();
  protected readonly tndShort = tndShort;
  protected readonly probability = probability;
  protected readonly interval = (i: Interval) => range(i, probability);
  protected readonly tail = computed(() => {
    const risk = this.run().results.risk;
    return risk.find((x) => x.level === 0.995) ?? risk[risk.length - 1];
  });
  protected readonly meanHint = computed(() => {
    const r = this.run().results;
    return `95% CI ${range(r.statistics.meanInterval, tndShort)}; exact ${tndShort(r.analytic.mean)}`;
  });
}

@Component({
  selector: 'mtr-distribution-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, ColumnChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let r = run().results;
    <section mtr-panel panelId="distribution" heading="Simulated distribution of total claims" [description]="'Share of the ' + count(r.simulations) + ' simulated periods in each range of total claims S.'">
      <dl class="ac-stats">
        <div>
          <dt>Median</dt>
          <dd>{{ tnd(r.statistics.median) }}</dd>
        </div>
        <div>
          <dt>Standard deviation</dt>
          <dd>
            {{ tnd(r.statistics.sd) }}
            <span class="ac-hint">Exact {{ tnd(r.analytic.sd) }}</span>
          </dd>
        </div>
        <div>
          <dt>Skewness</dt>
          <dd>{{ r.statistics.skewness === null ? dash : decimal(r.statistics.skewness, 3) }}</dd>
        </div>
        <div>
          <dt>Smallest, largest</dt>
          <dd>{{ tndShort(r.statistics.min) }}, {{ tndShort(r.statistics.max) }}</dd>
        </div>
        <div>
          <dt>Claims per period</dt>
          <dd>
            {{ decimal(r.claimCount.mean, 2) }}
            <span class="ac-hint">Exact {{ decimal(r.claimCount.analyticMean, 2) }}; at most {{ count(r.claimCount.max) }}</span>
          </dd>
        </div>
      </dl>
      <figure
        mtr-column-chart
        [from]="r.histogram.from"
        [binWidth]="r.histogram.binWidth"
        [values]="shares()"
        [markers]="markers()"
        [formatX]="tndShort"
        [formatY]="ratio1"
        seriesLabel="Share of simulated periods"
        [summary]="summary()"
      ></figure>
      @if (r.histogram.above > 0) {
        <p class="ac-note">
          {{ count(r.histogram.above) }} periods above {{ tndShort(r.histogram.from + r.histogram.binWidth * r.histogram.counts.length) }} (beyond the 99.9% quantile) are included in every
          statistic but not drawn.
        </p>
      }
    </section>
  `,
})
export class DistributionPanelComponent {
  readonly run = input.required<SimulationRunDetail>();
  protected readonly dash = DASH;
  protected readonly tnd = tnd;
  protected readonly tndShort = tndShort;
  protected readonly count = count;
  protected readonly decimal = decimal;
  protected readonly ratio1 = (v: number) => ratio(v, 1);
  protected readonly shares = computed(() => {
    const r = this.run().results;
    return r.histogram.counts.map((c) => c / r.simulations);
  });
  protected readonly markers = computed(() => {
    const r = this.run().results;
    const t = r.thresholds;
    const tail = r.risk.find((x) => x.level === 0.995);
    const markers: ChartMarker[] = [
      { label: 'Simulated mean', value: r.statistics.mean, tone: 'cyan' },
      { label: 'Claims budget', value: t.claimsBudget, tone: 'amber' },
      { label: 'Budget + capital', value: t.capitalThreshold, tone: 'neg' },
    ];
    if (tail) markers.push({ label: '99.5% VaR', value: tail.valueAtRisk, tone: 'brand' });
    return markers;
  });
  protected readonly summary = computed(() => {
    const r = this.run().results;
    return `Histogram of ${count(r.simulations)} simulated totals. Mean ${tnd(r.statistics.mean)}; ${probability(r.probabilities.claimsExceedBudget.simulated)} of periods exceed the claims budget of ${tnd(r.thresholds.claimsBudget)}.`;
  });
}

@Component({
  selector: 'mtr-threshold-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let t = run().results.thresholds;
    <section mtr-panel panelId="thresholds" heading="Premium and capital thresholds" description="What the simulated claims are compared with.">
      <dl class="ac-stats" style="margin-bottom: 0">
        <div>
          <dt>Premium charged P</dt>
          <dd>
            {{ tnd(t.premiumCharged) }}
            <span class="ac-hint">{{ t.premiumSource === 'MODEL' ? 'Model gross premium' : 'Entered by you; model premium ' + tnd(t.modelGrossPremium) }}</span>
          </dd>
        </div>
        <div>
          <dt>Fixed expenses F</dt>
          <dd>{{ tnd(t.fixedExpenses) }}</dd>
        </div>
        <div>
          <dt>Variable expenses vP</dt>
          <dd>{{ tnd(t.variableExpenses) }}</dd>
        </div>
        <div>
          <dt>Claims budget B = P − F − vP</dt>
          <dd>{{ tnd(t.claimsBudget) }}</dd>
        </div>
        <div>
          <dt>Initial capital C</dt>
          <dd>{{ tnd(t.initialCapital) }}</dd>
        </div>
        <div>
          <dt>Capital threshold B + C</dt>
          <dd>{{ tnd(t.capitalThreshold) }}</dd>
        </div>
      </dl>
    </section>
  `,
})
export class ThresholdPanelComponent {
  readonly run = input.required<SimulationRunDetail>();
  protected readonly tnd = tnd;
}

@Component({
  selector: 'mtr-comparison-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let r = run().results;
    <section
      mtr-panel
      panelId="comparison"
      heading="Simulated against exact"
      description="Simulated estimates with their 95% confidence intervals; exact values come from the model itself, not from the simulation."
    >
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Simulated estimates with 95% confidence intervals and exact model values</caption>
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col" class="num">Simulated</th>
              <th scope="col" class="num">Exact (model)</th>
              <th scope="col" class="num">Exact in interval</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                Mean E[S]
                <span class="ac-hint">Normal interval, ± 1.96 sd/√n</span>
              </th>
              <td class="num">
                {{ tndWhole(r.statistics.mean) }}
                <span class="ac-hint">95%: {{ wholeRange(r.statistics.meanInterval) }}</span>
              </td>
              <td class="num">{{ tndWhole(r.analytic.mean) }}</td>
              <td class="num">{{ within(r.analytic.meanWithinInterval) }}</td>
            </tr>
            @for (row of probabilityRows(); track row.label) {
              <tr>
                <th scope="row">
                  {{ row.label }}
                  <span class="ac-hint">{{ row.hint }}; {{ count(row.value.count) }} of {{ count(r.simulations) }} periods; Wilson interval</span>
                </th>
                <td class="num">
                  {{ probability(row.value.simulated) }}
                  <span class="ac-hint">95%: {{ probabilityRange(row.value.interval) }}</span>
                </td>
                <td class="num">{{ probability(row.value.exact) }}</td>
                <td class="num">{{ within(row.value.withinInterval) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="table-wrap ac-rows" style="margin-top: var(--space-4)">
        <table class="data-table">
          <caption class="sr-only">Simulated value-at-risk and tail value-at-risk with 95% confidence intervals and exact values</caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col" class="num">VaR simulated</th>
              <th scope="col" class="num">VaR exact</th>
              <th scope="col" class="num">TVaR simulated</th>
              <th scope="col" class="num">TVaR exact</th>
            </tr>
          </thead>
          <tbody>
            @for (row of r.risk; track row.level) {
              <tr>
                <th scope="row">{{ ratio(row.level, 1) }}</th>
                <td class="num">
                  {{ tndWhole(row.valueAtRisk) }}
                  <span class="ac-hint">95%: {{ wholeRange(row.valueAtRiskInterval) }}</span>
                </td>
                <td class="num">{{ row.exactValueAtRisk === null ? dash : tndWhole(row.exactValueAtRisk) }}</td>
                <td class="num">
                  {{ tndWhole(row.tailValueAtRisk) }}
                  <span class="ac-hint">{{ row.tailValueAtRiskInterval ? '95%: ' + wholeRange(row.tailValueAtRiskInterval) : 'Too few tail periods for an interval' }}</span>
                </td>
                <td class="num">{{ row.exactTailValueAtRisk === null ? dash : tndWhole(row.exactTailValueAtRisk) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="ac-note">
        {{ exactNote() }} About 1 interval in 20 misses the exact value by chance alone; a miss on a single line is not an error. VaR intervals come from order statistics; TVaR intervals are
        asymptotic and need at least 10 periods beyond the VaR. Simulated amounts are shown in whole dinars.
      </p>
    </section>
  `,
})
export class ComparisonPanelComponent {
  readonly run = input.required<SimulationRunDetail>();
  protected readonly dash = DASH;
  protected readonly tndWhole = tndWhole;
  protected readonly count = count;
  protected readonly ratio = ratio;
  protected readonly probability = probability;
  protected readonly within = within;
  protected readonly wholeRange = (i: Interval) => range(i, tndWhole);
  protected readonly probabilityRange = (i: Interval) => range(i, probability);

  protected readonly probabilityRows = computed<{ label: string; hint: string; value: SimulatedProbability }[]>(() => {
    const p = this.run().results.probabilities;
    return [
      { label: 'P(S > claims budget)', hint: 'Technical underwriting loss', value: p.claimsExceedBudget },
      { label: 'P(S > premium charged)', hint: 'Claims alone exceed the premium', value: p.claimsExceedPremium },
      { label: 'P(S > budget + capital)', hint: 'Capital insufficient at the end of the period', value: p.capitalInsufficient },
    ];
  });

  protected readonly exactNote = computed(() => {
    const distribution = this.run().results.analytic.distribution;
    if (!distribution.available) return `Exact distribution unavailable: ${distribution.reason}`;
    return distribution.method === 'PANJER'
      ? 'Exact values: Panjer recursion on the same model, as in the pricing studio.'
      : 'Exact values: closed-form distribution of the same model (every claim costs the same).';
  });
}

@Component({
  selector: 'mtr-exceedance-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, LineChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let c = chart();
    <section mtr-panel panelId="exceedance" heading="Exceedance curve" description="Probability that total claims exceed each amount.">
      <figure mtr-line-chart [series]="c.series" [formatY]="ratio0" [yMin]="0" [height]="180" [xLabels]="c.xLabels" [summary]="c.summary"></figure>
    </section>
  `,
})
export class ExceedancePanelComponent {
  readonly run = input.required<SimulationRunDetail>();
  protected readonly ratio0 = (v: number) => ratio(v, 0);
  protected readonly chart = computed(() => {
    const curve = this.run().results.exceedanceCurve;
    const hasExact = curve.every((pt) => pt.exact !== null);
    const series: ChartSeries[] = [{ label: 'Simulated P(S > x)', values: curve.map((pt) => pt.simulated), tone: 'brand' }];
    if (hasExact) series.push({ label: 'Exact P(S > x)', values: curve.map((pt) => pt.exact ?? 0), tone: 'cyan', dashed: true });
    const first = curve[0].threshold;
    const last = curve[curve.length - 1].threshold;
    return {
      series,
      xLabels: [tndShort(first), tndShort(last)] as [string, string],
      summary: `Exceedance probability from ${tnd(first)} to ${tnd(last)}${hasExact ? ', simulated and exact' : ', simulated only'}.`,
    };
  });
}

@Component({
  selector: 'mtr-convergence-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, LineChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let c = chart();
    <section mtr-panel panelId="convergence" heading="Convergence of the mean" description="Running estimate of E[S] with its 95% band as periods are added.">
      <figure mtr-line-chart [series]="c.series" [formatY]="tndShort" [height]="180" [xLabels]="c.xLabels" [summary]="c.summary"></figure>
    </section>
  `,
})
export class ConvergencePanelComponent {
  readonly run = input.required<SimulationRunDetail>();
  protected readonly tndShort = tndShort;
  protected readonly chart = computed(() => {
    const points = this.run().results.convergence;
    const exact = this.run().results.analytic.mean;
    const first = points[0];
    const last = points[points.length - 1];
    const series: ChartSeries[] = [
      { label: 'Running mean', values: points.map((pt) => pt.mean), tone: 'brand' },
      { label: 'Upper 95% bound', values: points.map((pt) => pt.upper), tone: 'muted', dashed: true },
      { label: 'Lower 95% bound', values: points.map((pt) => pt.lower), tone: 'muted', dashed: true },
      { label: 'Exact E[S]', values: points.map(() => exact), tone: 'cyan', dashed: true },
    ];
    return {
      series,
      xLabels: [`${count(first.simulations)} periods`, `${count(last.simulations)} periods`] as [string, string],
      summary: `Running mean of total claims from ${count(first.simulations)} to ${count(last.simulations)} periods, ending at ${tnd(last.mean)} against an exact ${tnd(exact)}.`,
    };
  });
}

@Component({
  selector: 'mtr-run-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DistributionPanelComponent, ThresholdPanelComponent, ComparisonPanelComponent, ExceedancePanelComponent, ConvergencePanelComponent],
  host: { style: 'display: contents' },
  template: `
    @let r = run().results;
    @if (outdated()) {
      <div class="form-error-banner" role="status">
        The results below belong to the run with seed {{ run().seed }}. The inputs have changed since; press Run simulation to recompute.
      </div>
    }
    @if (run().stale) {
      <div class="form-error-banner" role="status">
        This run was computed with an older engine version ({{ run().engineVersion }}). Run it again to use the current engine.
      </div>
    }
    <p class="ac-runMeta">
      <span>
        <strong>{{ run().label ?? 'Unlabelled run' }}</strong>
      </span>
      <span>{{ frequencyLabel[run().portfolio.frequency] }} × {{ severityLabel[run().portfolio.severity] }}, {{ count(run().portfolio.policies) }} policies</span>
      <span>{{ count(r.simulations) }} periods, seed <span class="num">{{ r.seed }}</span></span>
      <span>{{ r.engineVersion }}, {{ count(run().durationMs) }} ms</span>
    </p>
    <mtr-distribution-panel [run]="run()" />
    <mtr-threshold-panel [run]="run()" />
    <mtr-comparison-panel [run]="run()" />
    <div class="ac-twoUp">
      <mtr-exceedance-panel [run]="run()" />
      <mtr-convergence-panel [run]="run()" />
    </div>
  `,
})
export class RunResultsComponent {
  readonly run = input.required<SimulationRunDetail>();
  readonly outdated = input.required<boolean>();
  protected readonly count = count;
  protected readonly frequencyLabel = FREQUENCY_LABEL;
  protected readonly severityLabel = SEVERITY_LABEL;
}

@Component({
  selector: 'mtr-simulation-runs-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="runs" heading="Your runs" [description]="description()">
      @if (message(); as m) {
        <p [class]="m.tone === 'error' ? 'field-error' : 'field-hint'" [attr.role]="m.tone === 'error' ? 'alert' : 'status'">{{ m.text }}</p>
      }
      @if (history(); as h) {
        @if (h.runs.length === 0) {
          <div mtr-empty-state icon="info" heading="No runs yet" description="Every completed simulation is listed here so you can compare and reload it."></div>
        } @else {
          <div class="table-wrap ac-rows">
            <table class="data-table">
              <caption class="sr-only">Your simulation runs, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col" class="num">Mean</th>
                  <th scope="col" class="num">99.5% VaR</th>
                  <th scope="col" class="num">P(S &gt; budget)</th>
                  <th scope="col" class="num">P(capital insufficient)</th>
                  <th scope="col"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (s of h.runs; track s.id) {
                  <tr [attr.aria-current]="s.id === activeId() ? 'true' : null">
                    <th scope="row">
                      {{ s.label ?? 'Unlabelled run' }}
                      <span class="ac-hint"
                        >{{ count(s.simulations) }} periods, seed {{ s.seed }}, {{ frequencyLabel[s.portfolio.frequency] }} × {{ severityLabel[s.portfolio.severity] }}, capital
                        {{ tndShort(s.headline.initialCapital) }}, {{ createdAt(s.createdAt) }}</span
                      >
                      @if (s.stale) {
                        <span class="ac-hint">Older engine version</span>
                      }
                    </th>
                    <td class="num">{{ tndShort(s.headline.mean) }}</td>
                    <td class="num">{{ s.headline.valueAtRisk995 === null ? dash : tndShort(s.headline.valueAtRisk995) }}</td>
                    <td class="num">{{ probability(s.headline.probabilityClaimsExceedBudget) }}</td>
                    <td class="num">{{ probability(s.headline.probabilityCapitalInsufficient) }}</td>
                    <td>
                      <div class="ac-rowActions">
                        <button type="button" class="btn btn-ghost btn-sm" (click)="loadRun.emit(s)">
                          Charger<span class="sr-only"> {{ s.label ?? 'simulation avec graine ' + s.seed }}</span>
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="deleteRun.emit(s)">
                          Supprimer<span class="sr-only"> {{ s.label ?? 'simulation avec graine ' + s.seed }}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else {
        <div mtr-panel-skeleton [rows]="2"></div>
      }
    </section>
  `,
})
export class SimulationRunsPanelComponent {
  readonly history = input.required<{ kept: number; runs: SimulationRunSummary[] } | null>();
  readonly message = input.required<ActuarialMessage | null>();
  readonly activeId = input.required<string | null>();
  readonly loadRun = output<SimulationRunSummary>();
  readonly deleteRun = output<SimulationRunSummary>();

  protected readonly dash = DASH;
  protected readonly count = count;
  protected readonly tndShort = tndShort;
  protected readonly probability = probability;
  protected readonly frequencyLabel = FREQUENCY_LABEL;
  protected readonly severityLabel = SEVERITY_LABEL;
  protected readonly createdAt = (iso: string) => new Date(iso).toLocaleString('en-GB');
  protected readonly description = computed(() => {
    const kept = this.history()?.kept;
    return `Compare runs side by side. ${kept ? `The ${kept} most recent are kept. ` : ''}Each keeps its inputs, seed and summary results, never the individual simulated losses.`;
  });
}

const SIMULATION_METHOD = [
  'Period       N ~ Binomial or Poisson (exact samplers), then S = X₁ + … + X_N',
  'Severity     Fixed: S = m·N   Gamma: S ~ Gamma(N·α, θ)   Lognormal: N draws of exp(μ + σZ)',
  'Stream       mulberry32 seeded generator; the same seed and inputs give the same results',
  'Mean         S̄ ± 1.96·s/√n',
  'VaR_α        the ⌈nα⌉-th smallest simulated total; 95% interval from order statistics',
  'TVaR_α       mean of the totals at or above VaR_α (discrete tail); asymptotic interval',
  'Probability  share of periods above the threshold; Wilson 95% interval',
  'Budget       B = P − F − v·P     Capital insufficient: S > B + C',
  'Shortfall    E[(S − B − C)⁺]',
].join('\n');

@Component({
  selector: 'mtr-simulation-method-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="method" heading="How the simulation works">
      <details class="ac-explain">
        <summary>Show the method</summary>
        <pre class="ac-formula">{{ method }}</pre>
        <p class="ac-note">
          Individual simulated losses are summarised on the server and never stored. Investment income, reinsurance and regulatory capital rules are out of scope; “capital insufficient” only
          means claims exceed the claims budget plus the capital entered here.
        </p>
      </details>
    </section>
  `,
})
export class SimulationMethodPanelComponent {
  protected readonly method = SIMULATION_METHOD;
}
