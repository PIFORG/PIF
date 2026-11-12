import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Interval, SimulatedProbability, SimulationRunDetail, SimulationRunSummary } from '../core/api/actuarial-api';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { IconComponent } from '../shared/icon/icon.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { count, decimal, probability, ratio, tnd, tndShort, tndWhole } from './actuarial-format';
import { ColumnChartComponent, type ActuarialMessage, type ChartMarker } from './actuarial-parts.components';

/* The result panels of apps/web/src/components/actuarial/MonteCarloLab.tsx. Every figure is read from the stored run. */

export const FREQUENCY_LABEL = { BINOMIAL: 'Binomiale', POISSON: 'Poisson' } as const;
export const SEVERITY_LABEL = { DETERMINISTIC: 'Fixe', GAMMA: 'Gamma', LOGNORMAL: 'Log-normale' } as const;
const DASH = '\u2014';

const unbroken = (text: string) => text.replace(/ /g, '\u00a0');
const range = (i: Interval, format: (v: number) => string) => `${unbroken(format(i.lower))} – ${unbroken(format(i.upper))}`;

export function runName(run: Pick<SimulationRunSummary, 'label' | 'seed'>): string {
  return run.label ? `« ${run.label} »` : `l'exécution de graine ${run.seed}`;
}

function within(value: boolean | null): string {
  if (value === null) return DASH;
  return value ? 'Oui' : 'Non';
}

@Component({
  selector: 'p[mtr-simulated-note]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'ac-provenance' },
  template: `
    <svg mtrIcon name="info" [size]="16" />
    <span>
      <strong>Valeurs simulées à partir d'hypothèses fictives.</strong> Chaque chiffre est une estimation Monte Carlo avec un intervalle de confiance à 95 %, à côté de la valeur exacte du modèle lorsqu'elle est calculable. Aucune donnée de sinistres observée n'est utilisée.
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
    <div mtr-kpi label="Moyenne simulée E[S]" icon="actuarial" [hint]="meanHint()">
      <span class="num">{{ tndShort(r.statistics.mean) }}</span>
    </div>
    <div mtr-kpi label="99.5% VaR" [hint]="'TVaR ' + tndShort(tail().tailValueAtRisk)">
      <span class="num">{{ tndShort(tail().valueAtRisk) }}</span>
    </div>
    <div
      mtr-kpi
      label="P(sinistres > budget sinistres)"
      [hint]="'95% CI ' + interval(p.claimsExceedBudget.interval)"
      [tone]="p.claimsExceedBudget.simulated > 0.25 ? 'warning' : 'default'"
    >
      <span class="num">{{ probability(p.claimsExceedBudget.simulated) }}</span>
    </div>
    <div
      mtr-kpi
      label="P(capital insuffisant)"
      [hint]="'95% CI ' + interval(p.capitalInsufficient.interval)"
      [tone]="p.capitalInsufficient.simulated > 0.005 ? 'warning' : 'default'"
    >
      <span class="num">{{ probability(p.capitalInsufficient.simulated) }}</span>
    </div>
    <div mtr-kpi label="Déficit attendu" hint="E[(S − budget − capital)⁺]">
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
    return `IC 95 % ${range(r.statistics.meanInterval, tndShort)} ; exact ${tndShort(r.analytic.mean)}`;
  });
}

@Component({
  selector: 'mtr-distribution-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, ColumnChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let r = run().results;
    <section mtr-panel panelId="distribution" heading="Distribution simulée des sinistres totaux" [description]="'Part des ' + count(r.simulations) + ' périodes simulées dans chaque tranche de sinistres totaux S.'">
      <dl class="ac-stats">
        <div>
          <dt>Médiane</dt>
          <dd>{{ tnd(r.statistics.median) }}</dd>
        </div>
        <div>
          <dt>Écart-type</dt>
          <dd>
            {{ tnd(r.statistics.sd) }}
            <span class="ac-hint">Exact {{ tnd(r.analytic.sd) }}</span>
          </dd>
        </div>
        <div>
          <dt>Asymétrie</dt>
          <dd>{{ r.statistics.skewness === null ? dash : decimal(r.statistics.skewness, 3) }}</dd>
        </div>
        <div>
          <dt>Min, max</dt>
          <dd>{{ tndShort(r.statistics.min) }}, {{ tndShort(r.statistics.max) }}</dd>
        </div>
        <div>
          <dt>Sinistres par période</dt>
          <dd>
            {{ decimal(r.claimCount.mean, 2) }}
            <span class="ac-hint">Exact {{ decimal(r.claimCount.analyticMean, 2) }} ; au plus {{ count(r.claimCount.max) }}</span>
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
        seriesLabel="Part des périodes simulées"
        [summary]="summary()"
      ></figure>
      @if (r.histogram.above > 0) {
        <p class="ac-note">
          {{ count(r.histogram.above) }} périodes au-dessus de {{ tndShort(r.histogram.from + r.histogram.binWidth * r.histogram.counts.length) }} (au-delà du quantile 99,9 %) sont incluses dans chaque
          statistique mais non tracées.
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
      { label: 'Moyenne simulée', value: r.statistics.mean, tone: 'cyan' },
      { label: 'Budget sinistres', value: t.claimsBudget, tone: 'amber' },
      { label: 'Budget + capital', value: t.capitalThreshold, tone: 'neg' },
    ];
    if (tail) markers.push({ label: '99.5% VaR', value: tail.valueAtRisk, tone: 'brand' });
    return markers;
  });
  protected readonly summary = computed(() => {
    const r = this.run().results;
    return `Histogramme de ${count(r.simulations)} totaux simulés. Moyenne ${tnd(r.statistics.mean)} ; ${probability(r.probabilities.claimsExceedBudget.simulated)} des périodes dépassent le budget sinistres de ${tnd(r.thresholds.claimsBudget)}.`;
  });
}

@Component({
  selector: 'mtr-threshold-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    @let t = run().results.thresholds;
    <section mtr-panel panelId="thresholds" heading="Seuils de prime et de capital" description="À quoi les sinistres simulés sont comparés.">
      <dl class="ac-stats" style="margin-bottom: 0">
        <div>
          <dt>Prime encaissée P</dt>
          <dd>
            {{ tnd(t.premiumCharged) }}
            <span class="ac-hint">{{ t.premiumSource === 'MODEL' ? 'Prime brute du modèle' : 'Saisie par vous ; prime du modèle ' + tnd(t.modelGrossPremium) }}</span>
          </dd>
        </div>
        <div>
          <dt>Frais fixes F</dt>
          <dd>{{ tnd(t.fixedExpenses) }}</dd>
        </div>
        <div>
          <dt>Frais variables vP</dt>
          <dd>{{ tnd(t.variableExpenses) }}</dd>
        </div>
        <div>
          <dt>Budget sinistres B = P − F − vP</dt>
          <dd>{{ tnd(t.claimsBudget) }}</dd>
        </div>
        <div>
          <dt>Capital initial C</dt>
          <dd>{{ tnd(t.initialCapital) }}</dd>
        </div>
        <div>
          <dt>Seuil de capital B + C</dt>
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
      heading="Simulé contre exact"
      description="Estimations simulées avec intervalles de confiance à 95 % ; les valeurs exactes viennent du modèle lui-même, pas de la simulation."
    >
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Estimations simulées avec intervalles à 95 % et valeurs exactes du modèle</caption>
          <thead>
            <tr>
              <th scope="col">Grandeur</th>
              <th scope="col" class="num">Simulé</th>
              <th scope="col" class="num">Exact (modèle)</th>
              <th scope="col" class="num">Exact dans l'intervalle</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                Moyenne E[S]
                <span class="ac-hint">Intervalle normal, ± 1,96 écart-type/√n</span>
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
                  <span class="ac-hint">{{ row.hint }} ; {{ count(row.value.count) }} sur {{ count(r.simulations) }} périodes ; intervalle de Wilson</span>
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
          <caption class="sr-only">VaR et TVaR simulés avec intervalles à 95 % et valeurs exactes</caption>
          <thead>
            <tr>
              <th scope="col">Niveau</th>
              <th scope="col" class="num">VaR simulée</th>
              <th scope="col" class="num">VaR exacte</th>
              <th scope="col" class="num">TVaR simulée</th>
              <th scope="col" class="num">TVaR exacte</th>
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
                  <span class="ac-hint">{{ row.tailValueAtRiskInterval ? '95 % : ' + wholeRange(row.tailValueAtRiskInterval) : 'Trop peu de périodes en queue pour un intervalle' }}</span>
                </td>
                <td class="num">{{ row.exactTailValueAtRisk === null ? dash : tndWhole(row.exactTailValueAtRisk) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="ac-note">
        {{ exactNote() }} Environ 1 intervalle sur 20 manque la valeur exacte par le seul effet du hasard ; un échec sur une seule ligne n'est pas une erreur. Les intervalles de VaR viennent des statistiques d'ordre ; ceux de TVaR sont asymptotiques et nécessitent au moins 10 périodes au-delà de la VaR. Les montants simulés sont affichés en dinars entiers.
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
      { label: 'P(S > budget sinistres)', hint: 'Perte technique de souscription', value: p.claimsExceedBudget },
      { label: 'P(S > prime encaissée)', hint: 'Les sinistres seuls dépassent la prime', value: p.claimsExceedPremium },
      { label: 'P(S > budget + capital)', hint: 'Capital insuffisant en fin de période', value: p.capitalInsufficient },
    ];
  });

  protected readonly exactNote = computed(() => {
    const distribution = this.run().results.analytic.distribution;
    if (!distribution.available) return `Distribution exacte indisponible : ${distribution.reason}`;
    return distribution.method === 'PANJER'
      ? 'Valeurs exactes : récursion de Panjer sur le même modèle, comme dans le studio de tarification.'
      : 'Valeurs exactes : distribution en forme close du même modèle (chaque sinistre coûte le même montant).';
  });
}

@Component({
  selector: 'mtr-exceedance-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, LineChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let c = chart();
    <section mtr-panel panelId="exceedance" heading="Courbe de dépassement" description="Probabilité que les sinistres totaux dépassent chaque montant.">
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
    const series: ChartSeries[] = [{ label: 'P(S > x) simulée', values: curve.map((pt) => pt.simulated), tone: 'brand' }];
    if (hasExact) series.push({ label: 'P(S > x) exacte', values: curve.map((pt) => pt.exact ?? 0), tone: 'cyan', dashed: true });
    const first = curve[0].threshold;
    const last = curve[curve.length - 1].threshold;
    return {
      series,
      xLabels: [tndShort(first), tndShort(last)] as [string, string],
      summary: `Probabilité de dépassement de ${tnd(first)} à ${tnd(last)}${hasExact ? ', simulée et exacte' : ', simulée seulement'}.`,
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
    <section mtr-panel panelId="convergence" heading="Convergence de la moyenne" description="Estimation courante de E[S] avec sa bande à 95 % au fur et à mesure des périodes.">
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
      { label: 'Moyenne courante', values: points.map((pt) => pt.mean), tone: 'brand' },
      { label: 'Borne sup. 95 %', values: points.map((pt) => pt.upper), tone: 'muted', dashed: true },
      { label: 'Borne inf. 95 %', values: points.map((pt) => pt.lower), tone: 'muted', dashed: true },
      { label: 'E[S] exact', values: points.map(() => exact), tone: 'cyan', dashed: true },
    ];
    return {
      series,
      xLabels: [`${count(first.simulations)} périodes`, `${count(last.simulations)} périodes`] as [string, string],
      summary: `Moyenne courante des sinistres totaux de ${count(first.simulations)} à ${count(last.simulations)} périodes, terminant à ${tnd(last.mean)} face à un exact de ${tnd(exact)}.`,
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
        Les résultats ci-dessous correspondent à l'exécution de graine {{ run().seed }}. Les entrées ont changé depuis ; relancez la simulation pour recalculer.
      </div>
    }
    @if (run().stale) {
      <div class="form-error-banner" role="status">
        Cette exécution a été calculée avec une version antérieure du moteur ({{ run().engineVersion }}). Relancez-la pour utiliser le moteur actuel.
      </div>
    }
    <p class="ac-runMeta">
      <span>
        <strong>{{ run().label ?? 'Exécution sans nom' }}</strong>
      </span>
      <span>{{ frequencyLabel[run().portfolio.frequency] }} × {{ severityLabel[run().portfolio.severity] }}, {{ count(run().portfolio.policies) }} polices</span>
      <span>{{ count(r.simulations) }} périodes, graine <span class="num">{{ r.seed }}</span></span>
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
    <section mtr-panel panelId="runs" heading="Vos exécutions" [description]="description()">
      @if (message(); as m) {
        <p [class]="m.tone === 'error' ? 'field-error' : 'field-hint'" [attr.role]="m.tone === 'error' ? 'alert' : 'status'">{{ m.text }}</p>
      }
      @if (history(); as h) {
        @if (h.runs.length === 0) {
          <div mtr-empty-state icon="info" heading="Aucune exécution" description="Chaque simulation terminée est listée ici pour la comparer et la recharger."></div>
        } @else {
          <div class="table-wrap ac-rows">
            <table class="data-table">
              <caption class="sr-only">Vos exécutions de simulation, les plus récentes en premier</caption>
              <thead>
                <tr>
                  <th scope="col">Exécution</th>
                  <th scope="col" class="num">Moyenne</th>
                  <th scope="col" class="num">VaR 99,5 %</th>
                  <th scope="col" class="num">P(S &gt; budget)</th>
                  <th scope="col" class="num">P(capital insuffisant)</th>
                  <th scope="col"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (s of h.runs; track s.id) {
                  <tr [attr.aria-current]="s.id === activeId() ? 'true' : null">
                    <th scope="row">
                      {{ s.label ?? 'Exécution sans nom' }}
                      <span class="ac-hint"
                        >{{ count(s.simulations) }} périodes, graine {{ s.seed }}, {{ frequencyLabel[s.portfolio.frequency] }} × {{ severityLabel[s.portfolio.severity] }}, capital
                        {{ tndShort(s.headline.initialCapital) }}, {{ createdAt(s.createdAt) }}</span
                      >
                      @if (s.stale) {
                        <span class="ac-hint">Version antérieure du moteur</span>
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
    return `Comparez les exécutions côte à côte. ${kept ? `Les ${kept} plus récentes sont conservées. ` : ''}Chacune garde ses entrées, sa graine et ses résultats de synthèse, jamais les sinistres simulés individuels.`;
  });
}

const SIMULATION_METHOD = [
  'Période      N ~ Binomiale ou Poisson (échantillonnage exact), puis S = X₁ + … + X_N',
  'Sévérité     Fixe : S = m·N   Gamma : S ~ Gamma(N·α, θ)   Log-normale : N tirages de exp(μ + σZ)',
  'Flux         générateur mulberry32 avec graine ; mêmes graine et entrées → mêmes résultats',
  'Moyenne      S̄ ± 1,96·s/√n',
  'VaR_α        le ⌈nα⌉-ième total simulé le plus petit ; intervalle à 95 % par statistiques d\'ordre',
  'TVaR_α       moyenne des totaux ≥ VaR_α (queue discrète) ; intervalle asymptotique',
  'Probabilité  part des périodes au-dessus du seuil ; intervalle de Wilson à 95 %',
  'Budget       B = P − F − v·P     Capital insuffisant : S > B + C',
  'Déficit      E[(S − B − C)⁺]',
].join('\n');

@Component({
  selector: 'mtr-simulation-method-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="method" heading="Comment la simulation fonctionne">
      <details class="ac-explain">
        <summary>Afficher la méthode</summary>
        <pre class="ac-formula">{{ method }}</pre>
        <p class="ac-note">
          Les sinistres simulés individuels sont résumés sur le serveur et ne sont jamais stockés. Revenus de placement, réassurance et règles réglementaires de capital sont hors périmètre ; « capital insuffisant » signifie seulement que les sinistres dépassent le budget sinistres plus le capital saisi ici.
        </p>
      </details>
    </section>
  `,
})
export class SimulationMethodPanelComponent {
  protected readonly method = SIMULATION_METHOD;
}
