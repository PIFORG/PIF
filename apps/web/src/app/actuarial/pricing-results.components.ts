import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PricingResult } from '../core/api/actuarial-api';
import { AllocationBarComponent, LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { count, decimal, probability, ratio, tnd, tndShort } from './actuarial-format';
import { ColumnChartComponent, type ChartMarker } from './actuarial-parts.components';

/* apps/web/src/components/actuarial/results.tsx: every figure is read from the server's pricing result. */

const FREQUENCY_LABEL = { BINOMIAL: 'Binomial', POISSON: 'Poisson' } as const;
const SEVERITY_LABEL = { DETERMINISTIC: 'Deterministic', GAMMA: 'Gamma', LOGNORMAL: 'Lognormal' } as const;
const DASH = '\u2014';
const ratio1 = (v: number) => ratio(v, 1);

@Component({
  selector: 'div[mtr-premium-kpis]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { class: 'ac-kpis' },
  template: `
    @let r = result();
    <div mtr-kpi label="Gross premium per policy" icon="actuarial" [hint]="count(r.frequency.policies) + ' policies'">
      <span class="num">{{ tnd(r.premium.perPolicy.grossPremium) }}</span>
    </div>
    <div mtr-kpi label="Total gross premium" hint="Commercial premium for the period">
      <span class="num">{{ tndShort(r.premium.totals.grossPremium) }}</span>
    </div>
    <div mtr-kpi label="Expected claims E[S]" [hint]="decimal(r.frequency.mean, 2) + ' claims expected'">
      <span class="num">{{ tndShort(r.premium.totals.purePremium) }}</span>
    </div>
    <div mtr-kpi label="Combined ratio" hint="Expected claims and expenses ÷ premium" [tone]="r.premium.ratios.combined >= 1 ? 'negative' : 'default'">
      <span class="num">{{ ratio(r.premium.ratios.combined, 1) }}</span>
    </div>
    <div
      mtr-kpi
      label="P(underwriting loss)"
      [hint]="loss() === null ? 'Distribution unavailable' : 'Claims exceed the claims budget'"
      [tone]="(loss() ?? 0) > 0.25 ? 'warning' : 'default'"
    >
      <span class="num">{{ probability(loss()) }}</span>
    </div>
  `,
})
export class PremiumKpisComponent {
  readonly result = input.required<PricingResult>();
  protected readonly loss = computed(() => this.result().probabilities.underwritingLoss);
  protected readonly tnd = tnd;
  protected readonly tndShort = tndShort;
  protected readonly count = count;
  protected readonly decimal = decimal;
  protected readonly ratio = ratio;
  protected readonly probability = probability;
}

function loadingHint(result: PricingResult): string {
  const { method, parameter } = result.assumptions.riskLoading;
  if (method === 'EXPECTED_VALUE') return `θ = ${ratio(parameter, 1)} of E[S]`;
  if (method === 'STANDARD_DEVIATION') return `k = ${decimal(parameter)} × sd(S)`;
  return 'No loading';
}

@Component({
  selector: 'mtr-premium-build-up',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, AllocationBarComponent],
  host: { style: 'display: contents' },
  template: `
    @let premium = result().premium;
    <section mtr-panel panelId="premium" heading="Premium build-up" description="From expected claims to the commercial premium charged to policyholders.">
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Premium components for the portfolio and per policy</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col" class="num">Portfolio</th>
              <th scope="col" class="num">Per policy</th>
              <th scope="col" class="num">Share of gross</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.label) {
              <tr [attr.data-total]="row.isTotal ? 'true' : null">
                <th scope="row">
                  {{ row.label }}
                  <span class="ac-hint">{{ row.hint }}</span>
                </th>
                <td class="num">{{ tnd(row.total) }}</td>
                <td class="num">{{ tnd(row.perPolicy) }}</td>
                <td class="num">{{ ratio(share(row.total), 1) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div style="margin-top: var(--space-4)">
        <div mtr-allocation-bar label="What the gross premium pays for" [items]="allocation()"></div>
      </div>
      <dl class="ac-stats" style="margin-top: var(--space-4); margin-bottom: 0">
        <div>
          <dt>Loss ratio</dt>
          <dd>{{ ratio(premium.ratios.loss, 1) }}</dd>
        </div>
        <div>
          <dt>Expense ratio</dt>
          <dd>{{ ratio(premium.ratios.expense, 1) }}</dd>
        </div>
        <div>
          <dt>Expected underwriting result</dt>
          <dd [class.ac-neg]="premium.totals.expectedUnderwritingResult < 0">{{ tnd(premium.totals.expectedUnderwritingResult) }}</dd>
        </div>
        <div>
          <dt>Pure premium per policy-year</dt>
          <dd>{{ tnd(premium.purePremiumPerExposure) }}</dd>
        </div>
      </dl>
    </section>
  `,
})
export class PremiumBuildUpComponent {
  readonly result = input.required<PricingResult>();
  protected readonly tnd = tnd;
  protected readonly ratio = ratio;

  protected share(x: number): number {
    const gross = this.result().premium.totals.grossPremium;
    return gross > 0 ? x / gross : 0;
  }

  protected readonly rows = computed(() => {
    const result = this.result();
    const { totals, perPolicy } = result.premium;
    return [
      { label: 'Pure premium', hint: 'E[S] = E[N] × E[X]', total: totals.purePremium, perPolicy: perPolicy.purePremium, isTotal: false },
      { label: 'Risk loading', hint: loadingHint(result), total: totals.riskLoading, perPolicy: perPolicy.riskLoading, isTotal: false },
      { label: 'Fixed and per-policy expenses', hint: 'Administration, claims handling', total: totals.fixedExpenses, perPolicy: perPolicy.fixedExpenses, isTotal: false },
      { label: 'Technical premium', hint: 'Pure premium + loading + fixed expenses', total: totals.technicalPremium, perPolicy: perPolicy.technicalPremium, isTotal: true },
      {
        label: 'Variable expenses',
        hint: `${ratio(result.assumptions.expenses.variableRate, 1)} of gross premium`,
        total: totals.variableExpenses,
        perPolicy: perPolicy.variableExpenses,
        isTotal: false,
      },
      { label: 'Profit margin', hint: `${ratio(result.assumptions.profitMarginRate, 1)} of gross premium`, total: totals.profitMargin, perPolicy: perPolicy.profitMargin, isTotal: false },
      { label: 'Gross (commercial) premium', hint: 'Technical premium ÷ (1 − variable rate − margin)', total: totals.grossPremium, perPolicy: perPolicy.grossPremium, isTotal: true },
    ];
  });

  protected readonly allocation = computed(() => {
    const totals = this.result().premium.totals;
    return [
      { label: 'Expected claims', weight: this.share(totals.purePremium) },
      { label: 'Risk loading', weight: this.share(totals.riskLoading) },
      { label: 'Fixed expenses', weight: this.share(totals.fixedExpenses) },
      { label: 'Variable expenses', weight: this.share(totals.variableExpenses) },
      { label: 'Profit margin', weight: this.share(totals.profitMargin) },
    ];
  });
}

@Component({
  selector: 'mtr-loss-distribution-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, ColumnChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let r = result();
    <section
      mtr-panel
      panelId="aggregate"
      heading="Aggregate claims distribution"
      description="Total claims S = X₁ + … + X_N for the period, compared with the premium left for claims after expenses."
    >
      <dl class="ac-stats">
        <div>
          <dt>E[S]</dt>
          <dd>{{ tnd(r.aggregate.mean) }}</dd>
        </div>
        <div>
          <dt>Standard deviation</dt>
          <dd>{{ tnd(r.aggregate.sd) }}</dd>
        </div>
        <div>
          <dt>Coefficient of variation</dt>
          <dd>{{ r.aggregate.cv === null ? dash : decimal(r.aggregate.cv, 4) }}</dd>
        </div>
        <div>
          <dt>P(S &gt; claims budget)</dt>
          <dd>{{ probability(r.probabilities.underwritingLoss) }}</dd>
        </div>
        <div>
          <dt>P(S &gt; gross premium)</dt>
          <dd>{{ probability(r.probabilities.claimsExceedPremium) }}</dd>
        </div>
      </dl>
      @if (r.aggregate.histogram; as h) {
        <figure
          mtr-column-chart
          [from]="h.from"
          [binWidth]="h.binWidth"
          [values]="h.probabilities"
          [markers]="markers()"
          [formatX]="tndShort"
          [formatY]="ratio1"
          seriesLabel="Probability of total claims in range"
          [summary]="summary()"
        ></figure>
      } @else {
        <div mtr-empty-state icon="info" heading="Full distribution not available" [description]="unavailableReason()"></div>
      }
      <div class="table-wrap ac-rows" style="margin-top: var(--space-4)">
        <table class="data-table">
          <caption class="sr-only">Quantiles (value-at-risk) and tail value-at-risk of total claims</caption>
          <thead>
            <tr>
              <th scope="col">Confidence level</th>
              <th scope="col" class="num">Quantile (VaR)</th>
              <th scope="col" class="num">Tail mean (TVaR)</th>
              <th scope="col" class="num">Normal approximation</th>
            </tr>
          </thead>
          <tbody>
            @for (row of r.aggregate.risk; track row.level) {
              <tr>
                <th scope="row">{{ ratio(row.level, 1) }}</th>
                <td class="num">{{ tnd(row.valueAtRisk) }}</td>
                <td class="num">{{ tnd(row.tailValueAtRisk) }}</td>
                <td class="num">{{ tnd(row.normalApproximation) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="ac-note">{{ distributionNote() }} The normal approximation is shown for comparison only: it understates skewed claim totals.</p>
    </section>
  `,
})
export class LossDistributionPanelComponent {
  readonly result = input.required<PricingResult>();
  protected readonly dash = DASH;
  protected readonly tnd = tnd;
  protected readonly tndShort = tndShort;
  protected readonly ratio = ratio;
  protected readonly ratio1 = ratio1;
  protected readonly decimal = decimal;
  protected readonly probability = probability;

  protected readonly markers = computed(() => {
    const { aggregate, premium } = this.result();
    const var995 = aggregate.risk.find((r) => r.level === 0.995);
    const markers: ChartMarker[] = [
      { label: 'Expected claims', value: aggregate.mean, tone: 'cyan' },
      { label: 'Claims budget', value: premium.totals.claimsBudget, tone: 'amber' },
    ];
    if (var995?.valueAtRisk) markers.push({ label: '99.5% quantile', value: var995.valueAtRisk, tone: 'neg' });
    return markers;
  });

  protected readonly summary = computed(() => {
    const { aggregate, premium, probabilities } = this.result();
    return `Distribution of total claims. Expected ${tnd(aggregate.mean)}, standard deviation ${tnd(aggregate.sd)}. Probability that claims exceed the claims budget of ${tnd(premium.totals.claimsBudget)}: ${probability(probabilities.underwritingLoss)}.`;
  });

  protected readonly unavailableReason = computed(() => {
    const dist = this.result().aggregate.distribution;
    return dist.available ? 'No distribution returned.' : dist.reason;
  });

  protected readonly distributionNote = computed(() => {
    const dist = this.result().aggregate.distribution;
    if (!dist.available) return 'Moments are exact; quantiles need the distribution.';
    return dist.method === 'EXACT'
      ? 'Exact distribution: every claim costs the same, so S = cost × N.'
      : `Panjer recursion on a ${tnd(dist.span)} grid (mean-preserving discretisation); ${probability(dist.capturedMass)} of the probability is on the grid.`;
  });
}

@Component({
  selector: 'mtr-frequency-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, ColumnChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let f = result().frequency;
    <section mtr-panel panelId="frequency" heading="Claim frequency" [description]="description()">
      <dl class="ac-stats">
        <div>
          <dt>E[N]</dt>
          <dd>{{ decimal(f.mean, 3) }}</dd>
        </div>
        <div>
          <dt>Var(N)</dt>
          <dd>{{ decimal(f.variance, 3) }}</dd>
        </div>
        <div>
          <dt>Var ÷ mean</dt>
          <dd>
            {{ f.dispersionIndex === null ? dash : decimal(f.dispersionIndex, 4) }}
            <span class="ac-hint">{{ isBinomial() ? 'Below 1 for the binomial' : 'Exactly 1 for Poisson' }}</span>
          </dd>
        </div>
        <div>
          <dt>{{ isBinomial() ? 'Claim probability per policy' : 'P(a policy has a claim)' }}</dt>
          <dd>{{ probability(f.probabilityPolicyClaims) }}</dd>
        </div>
        <div>
          <dt>P(N &gt; E[N])</dt>
          <dd>{{ probability(f.probabilityAboveMean) }}</dd>
        </div>
      </dl>
      <figure
        mtr-column-chart
        [from]="f.distribution.from - 0.5"
        [binWidth]="f.distribution.binWidth"
        [values]="f.distribution.probabilities"
        [markers]="markers()"
        [formatX]="formatCount"
        [formatY]="ratio1"
        [seriesLabel]="f.distribution.binWidth > 1 ? 'P(N in a range of ' + f.distribution.binWidth + ' claims)' : 'P(N = k)'"
        [summary]="'Number of claims: mean ' + decimal(f.mean, 2) + ', standard deviation ' + decimal(f.sd, 2) + '.'"
        [height]="160"
      ></figure>
    </section>
  `,
})
export class FrequencyPanelComponent {
  readonly result = input.required<PricingResult>();
  protected readonly dash = DASH;
  protected readonly decimal = decimal;
  protected readonly probability = probability;
  protected readonly ratio1 = ratio1;
  protected readonly formatCount = (v: number) => (Number.isInteger(v) ? count(v) : decimal(v, 2));
  protected readonly isBinomial = computed(() => this.result().frequency.family === 'BINOMIAL');
  protected readonly description = computed(() => {
    const f = this.result().frequency;
    return `${FREQUENCY_LABEL[f.family]} model over ${decimal(f.exposure, 2)} policy-years.`;
  });
  protected readonly markers = computed<ChartMarker[]>(() => [{ label: 'E[N]', value: this.result().frequency.mean, tone: 'cyan' }]);
}

@Component({
  selector: 'mtr-severity-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, LineChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let s = result().severity;
    <section mtr-panel panelId="severity" heading="Claim cost (severity)" [description]="description()">
      <dl class="ac-stats">
        <div>
          <dt>Mean E[X]</dt>
          <dd>{{ tnd(s.mean) }}</dd>
        </div>
        <div>
          <dt>Standard deviation</dt>
          <dd>{{ tnd(s.sd) }}</dd>
        </div>
        <div>
          <dt>Median</dt>
          <dd>{{ tnd(q(0.5)) }}</dd>
        </div>
        <div>
          <dt>99.5% quantile</dt>
          <dd>
            {{ tnd(q(0.995)) }}
            <span class="ac-hint">{{ decimal(s.tailRatio, 2) }} × the mean</span>
          </dd>
        </div>
        @if (s.family === 'GAMMA') {
          <div>
            <dt>Shape α, scale θ</dt>
            <dd>{{ decimal(param('shape'), 4) }}, {{ decimal(param('scale'), 2) }}</dd>
          </div>
        }
        @if (s.family === 'LOGNORMAL') {
          <div>
            <dt>μ, σ of ln X</dt>
            <dd>
              {{ decimal(param('mu'), 4) }}, {{ decimal(param('sigma'), 4) }}
              <span class="ac-hint">Not the mean and sd of the cost</span>
            </dd>
          </div>
        }
      </dl>
      @if (curve(); as c) {
        <figure mtr-line-chart [series]="c.series" [formatY]="decimal3" [yMin]="0" [xLabels]="c.xLabels" [height]="160" [summary]="c.summary"></figure>
      } @else {
        <div
          mtr-empty-state
          icon="info"
          heading="Every claim costs the same"
          [description]="'Deterministic severity: each claim costs exactly ' + tnd(s.mean) + ', so only the number of claims is uncertain.'"
        ></div>
      }
    </section>
  `,
})
export class SeverityPanelComponent {
  readonly result = input.required<PricingResult>();
  protected readonly tnd = tnd;
  protected readonly decimal = decimal;
  protected readonly decimal3 = (v: number) => decimal(v, 3);

  protected q(level: number): number | null {
    return this.result().severity.quantiles.find((x) => x.level === level)?.value ?? null;
  }

  protected param(name: string): number {
    return this.result().severity.parameters[name];
  }

  protected readonly description = computed(() => {
    const result = this.result();
    return `${SEVERITY_LABEL[result.severity.family]} model${result.trendFactor !== 1 ? `, inflated by ×${decimal(result.trendFactor, 4)}` : ''}.`;
  });

  protected readonly curve = computed(() => {
    const s = this.result().severity;
    if (!s.curve) return null;
    const series: ChartSeries[] = [{ label: 'Density (probability per 1,000 DT of cost)', values: s.curve.map((p) => p.density * 1000), tone: 'cyan', area: true }];
    return {
      series,
      xLabels: [tndShort(0), tndShort(s.curve[s.curve.length - 1].x)] as [string, string],
      summary: `Claim cost density from 0 to the 99.5% quantile ${tnd(this.q(0.995))}. Mean ${tnd(s.mean)}, median ${tnd(this.q(0.5))}.`,
    };
  });
}

@Component({
  selector: 'mtr-pricing-sensitivity-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let r = result();
    <section mtr-panel panelId="sensitivity" heading="Sensitivity" description="One assumption changed at a time. Compare repricing the book with keeping today’s premium.">
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Premium and expected result under one-at-a-time assumption changes</caption>
          <thead>
            <tr>
              <th scope="col">Change</th>
              <th scope="col" class="num">Repriced premium per policy</th>
              <th scope="col" class="num">Premium change</th>
              <th scope="col" class="num">Expected result at today’s premium</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Base case</th>
              <td class="num">{{ tnd(r.premium.perPolicy.grossPremium) }}</td>
              <td class="num">{{ dash }}</td>
              <td class="num">{{ tnd(r.premium.totals.expectedUnderwritingResult) }}</td>
            </tr>
            @for (line of r.sensitivities; track line.driver) {
              <tr>
                <th scope="row">{{ line.label }}</th>
                <td class="num">{{ tnd(line.repricedPerPolicy) }}</td>
                <td class="num">{{ ratio(line.premiumChange, 2) }}</td>
                <td class="num" [class.ac-neg]="line.resultAtBasePremium < 0">{{ tnd(line.resultAtBasePremium) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class PricingSensitivityPanelComponent {
  readonly result = input.required<PricingResult>();
  protected readonly dash = DASH;
  protected readonly tnd = tnd;
  protected readonly ratio = ratio;
}

const PRICING_FORMULAS = [
  'Frequency   Binomial: N ~ Bin(n, p_t), p_t = 1 − (1 − p)^t     Poisson: N ~ Poisson(λ), λ = n·t·μ',
  'Severity    Gamma: shape 1/c², scale m·c²     Lognormal: σ² = ln(1 + c²), μ = ln m − σ²/2',
  'Inflation   E[X] = m × (1 + i)^years',
  'Aggregate   E[S] = E[N]·E[X]     Var(S) = E[N]·Var(X) + Var(N)·E[X]²',
  'Chargement  RL = θ·E[S] (valeur attendue)  ou  k·sd(S) (écart-type)',
  'Technical   P_T = E[S] + RL + fixed + n·per-policy',
  'Gross       P_G = P_T ÷ (1 − v − m)   (v, m are shares of the gross premium)',
  'Result      E[result] = P_G − E[S] − fixed − v·P_G = RL + m·P_G',
  'Ratios      loss = E[S]/P_G   expense = (fixed + v·P_G)/P_G   combined = loss + expense',
].join('\n');

@Component({
  selector: 'mtr-pricing-formula-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="method" heading="How the premium is calculated">
      <details class="ac-explain">
        <summary>Show the formulas</summary>
        <pre class="ac-formula">{{ formulas }}</pre>
        <p class="ac-note">
          Out of scope here: investment income, reinsurance, cost of capital and regulatory provisions. Claim costs never use a normal distribution because they cannot be negative.
        </p>
      </details>
    </section>
  `,
})
export class PricingFormulaPanelComponent {
  protected readonly formulas = PRICING_FORMULAS;
}
