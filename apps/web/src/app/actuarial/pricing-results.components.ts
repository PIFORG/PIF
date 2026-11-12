import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PricingResult } from '../core/api/actuarial-api';
import { AllocationBarComponent, LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { count, decimal, probability, ratio, tnd, tndShort } from './actuarial-format';
import { ColumnChartComponent, type ChartMarker } from './actuarial-parts.components';

/* apps/web/src/components/actuarial/results.tsx: every figure is read from the server's pricing result. */

const FREQUENCY_LABEL = { BINOMIAL: 'Binomiale', POISSON: 'Poisson' } as const;
const SEVERITY_LABEL = { DETERMINISTIC: 'Déterministe', GAMMA: 'Gamma', LOGNORMAL: 'Log-normale' } as const;
const DASH = '\u2014';
const ratio1 = (v: number) => ratio(v, 1);

@Component({
  selector: 'div[mtr-premium-kpis]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { class: 'ac-kpis' },
  template: `
    @let r = result();
    <div mtr-kpi label="Prime brute par police" icon="actuarial" [hint]="count(r.frequency.policies) + ' polices'">
      <span class="num">{{ tnd(r.premium.perPolicy.grossPremium) }}</span>
    </div>
    <div mtr-kpi label="Prime brute totale" hint="Prime commerciale sur la période">
      <span class="num">{{ tndShort(r.premium.totals.grossPremium) }}</span>
    </div>
    <div mtr-kpi label="Sinistres attendus E[S]" [hint]="decimal(r.frequency.mean, 2) + ' sinistres attendus'">
      <span class="num">{{ tndShort(r.premium.totals.purePremium) }}</span>
    </div>
    <div mtr-kpi label="Ratio combiné" hint="Sinistres attendus et frais ÷ prime" [tone]="r.premium.ratios.combined >= 1 ? 'negative' : 'default'">
      <span class="num">{{ ratio(r.premium.ratios.combined, 1) }}</span>
    </div>
    <div
      mtr-kpi
      label="P(perte de souscription)"
      [hint]="loss() === null ? 'Distribution indisponible' : 'Les sinistres dépassent le budget sinistres'"
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
  if (method === 'EXPECTED_VALUE') return `θ = ${ratio(parameter, 1)} d'E[S]`;
  if (method === 'STANDARD_DEVIATION') return `k = ${decimal(parameter)} × écart-type(S)`;
  return 'Aucun chargement';
}

@Component({
  selector: 'mtr-premium-build-up',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, AllocationBarComponent],
  host: { style: 'display: contents' },
  template: `
    @let premium = result().premium;
    <section mtr-panel panelId="premium" heading="Construction de la prime" description="Des sinistres attendus à la prime commerciale facturée aux assurés.">
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Composantes de la prime pour le portefeuille et par police</caption>
          <thead>
            <tr>
              <th scope="col">Composante</th>
              <th scope="col" class="num">Portefeuille</th>
              <th scope="col" class="num">Par police</th>
              <th scope="col" class="num">Part de la brute</th>
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
        <div mtr-allocation-bar label="Répartition de la prime brute" [items]="allocation()"></div>
      </div>
      <dl class="ac-stats" style="margin-top: var(--space-4); margin-bottom: 0">
        <div>
          <dt>Ratio de sinistralité</dt>
          <dd>{{ ratio(premium.ratios.loss, 1) }}</dd>
        </div>
        <div>
          <dt>Ratio de frais</dt>
          <dd>{{ ratio(premium.ratios.expense, 1) }}</dd>
        </div>
        <div>
          <dt>Résultat de souscription attendu</dt>
          <dd [class.ac-neg]="premium.totals.expectedUnderwritingResult < 0">{{ tnd(premium.totals.expectedUnderwritingResult) }}</dd>
        </div>
        <div>
          <dt>Prime pure par police-année</dt>
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
      { label: 'Prime pure', hint: 'E[S] = E[N] × E[X]', total: totals.purePremium, perPolicy: perPolicy.purePremium, isTotal: false },
      { label: 'Chargement de risque', hint: loadingHint(result), total: totals.riskLoading, perPolicy: perPolicy.riskLoading, isTotal: false },
      { label: 'Frais fixes et par police', hint: 'Administration, gestion des sinistres', total: totals.fixedExpenses, perPolicy: perPolicy.fixedExpenses, isTotal: false },
      { label: 'Prime technique', hint: 'Prime pure + chargement + frais fixes', total: totals.technicalPremium, perPolicy: perPolicy.technicalPremium, isTotal: true },
      {
        label: 'Frais variables',
        hint: `${ratio(result.assumptions.expenses.variableRate, 1)} de la prime brute`,
        total: totals.variableExpenses,
        perPolicy: perPolicy.variableExpenses,
        isTotal: false,
      },
      { label: 'Marge de profit', hint: `${ratio(result.assumptions.profitMarginRate, 1)} de la prime brute`, total: totals.profitMargin, perPolicy: perPolicy.profitMargin, isTotal: false },
      { label: 'Prime brute (commerciale)', hint: 'Prime technique ÷ (1 − taux variable − marge)', total: totals.grossPremium, perPolicy: perPolicy.grossPremium, isTotal: true },
    ];
  });

  protected readonly allocation = computed(() => {
    const totals = this.result().premium.totals;
    return [
      { label: 'Sinistres attendus', weight: this.share(totals.purePremium) },
      { label: 'Chargement de risque', weight: this.share(totals.riskLoading) },
      { label: 'Frais fixes', weight: this.share(totals.fixedExpenses) },
      { label: 'Frais variables', weight: this.share(totals.variableExpenses) },
      { label: 'Marge de profit', weight: this.share(totals.profitMargin) },
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
      heading="Distribution des sinistres agrégés"
      description="Sinistres totaux S = X₁ + … + X_N sur la période, comparés à la part de prime restante pour les sinistres après frais."
    >
      <dl class="ac-stats">
        <div>
          <dt>E[S]</dt>
          <dd>{{ tnd(r.aggregate.mean) }}</dd>
        </div>
        <div>
          <dt>Écart-type</dt>
          <dd>{{ tnd(r.aggregate.sd) }}</dd>
        </div>
        <div>
          <dt>Coefficient de variation</dt>
          <dd>{{ r.aggregate.cv === null ? dash : decimal(r.aggregate.cv, 4) }}</dd>
        </div>
        <div>
          <dt>P(S &gt; budget sinistres)</dt>
          <dd>{{ probability(r.probabilities.underwritingLoss) }}</dd>
        </div>
        <div>
          <dt>P(S &gt; prime brute)</dt>
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
          seriesLabel="Probabilité des sinistres totaux dans l'intervalle"
          [summary]="summary()"
        ></figure>
      } @else {
        <div mtr-empty-state icon="info" heading="Distribution complète indisponible" [description]="unavailableReason()"></div>
      }
      <div class="table-wrap ac-rows" style="margin-top: var(--space-4)">
        <table class="data-table">
          <caption class="sr-only">Quantiles (value-at-risk) et tail value-at-risk des sinistres totaux</caption>
          <thead>
            <tr>
              <th scope="col">Niveau de confiance</th>
              <th scope="col" class="num">Quantile (VaR)</th>
              <th scope="col" class="num">Moyenne de queue (TVaR)</th>
              <th scope="col" class="num">Approximation normale</th>
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
      <p class="ac-note">{{ distributionNote() }} L'approximation normale est affichée pour comparaison seulement : elle sous-estime les totaux de sinistres asymétriques.</p>
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
      { label: 'Sinistres attendus', value: aggregate.mean, tone: 'cyan' },
      { label: 'Budget sinistres', value: premium.totals.claimsBudget, tone: 'amber' },
    ];
    if (var995?.valueAtRisk) markers.push({ label: 'Quantile 99,5 %', value: var995.valueAtRisk, tone: 'neg' });
    return markers;
  });

  protected readonly summary = computed(() => {
    const { aggregate, premium, probabilities } = this.result();
    return `Distribution des sinistres totaux. Attendu ${tnd(aggregate.mean)}, écart-type ${tnd(aggregate.sd)}. Probabilité que les sinistres dépassent le budget sinistres de ${tnd(premium.totals.claimsBudget)} : ${probability(probabilities.underwritingLoss)}.`;
  });

  protected readonly unavailableReason = computed(() => {
    const dist = this.result().aggregate.distribution;
    return dist.available ? 'Aucune distribution renvoyée.' : dist.reason;
  });

  protected readonly distributionNote = computed(() => {
    const dist = this.result().aggregate.distribution;
    if (!dist.available) return 'Les moments sont exacts ; les quantiles nécessitent la distribution.';
    return dist.method === 'EXACT'
      ? 'Distribution exacte : chaque sinistre coûte le même montant, donc S = coût × N.'
      : `Récursion de Panjer sur une grille de ${tnd(dist.span)} (discrétisation préservant la moyenne) ; ${probability(dist.capturedMass)} de la probabilité est sur la grille.`;
  });
}

@Component({
  selector: 'mtr-frequency-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES, ColumnChartComponent],
  host: { style: 'display: contents' },
  template: `
    @let f = result().frequency;
    <section mtr-panel panelId="frequency" heading="Fréquence des sinistres" [description]="description()">
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
            <span class="ac-hint">{{ isBinomial() ? 'Inférieur à 1 pour la binomiale' : 'Exactement 1 pour Poisson' }}</span>
          </dd>
        </div>
        <div>
          <dt>{{ isBinomial() ? 'Probabilité de sinistre par police' : 'P(une police a un sinistre)' }}</dt>
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
        [seriesLabel]="f.distribution.binWidth > 1 ? 'P(N dans un intervalle de ' + f.distribution.binWidth + ' sinistres)' : 'P(N = k)'"
        [summary]="'Nombre de sinistres : moyenne ' + decimal(f.mean, 2) + ', écart-type ' + decimal(f.sd, 2) + '.'"
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
    return `Modèle ${FREQUENCY_LABEL[f.family]} sur ${decimal(f.exposure, 2)} années-polices.`;
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
    <section mtr-panel panelId="severity" heading="Coût du sinistre (sévérité)" [description]="description()">
      <dl class="ac-stats">
        <div>
          <dt>Moyenne E[X]</dt>
          <dd>{{ tnd(s.mean) }}</dd>
        </div>
        <div>
          <dt>Écart-type</dt>
          <dd>{{ tnd(s.sd) }}</dd>
        </div>
        <div>
          <dt>Médiane</dt>
          <dd>{{ tnd(q(0.5)) }}</dd>
        </div>
        <div>
          <dt>Quantile 99,5 %</dt>
          <dd>
            {{ tnd(q(0.995)) }}
            <span class="ac-hint">{{ decimal(s.tailRatio, 2) }} × la moyenne</span>
          </dd>
        </div>
        @if (s.family === 'GAMMA') {
          <div>
            <dt>Forme α, échelle θ</dt>
            <dd>{{ decimal(param('shape'), 4) }}, {{ decimal(param('scale'), 2) }}</dd>
          </div>
        }
        @if (s.family === 'LOGNORMAL') {
          <div>
            <dt>μ, σ of ln X</dt>
            <dd>
              {{ decimal(param('mu'), 4) }}, {{ decimal(param('sigma'), 4) }}
              <span class="ac-hint">Pas la moyenne ni l'écart-type du coût</span>
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
          heading="Chaque sinistre coûte le même montant"
          [description]="'Sévérité déterministe : chaque sinistre coûte exactement ' + tnd(s.mean) + ' ; seul le nombre de sinistres est incertain.'"
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
    return `Modèle ${SEVERITY_LABEL[result.severity.family]}${result.trendFactor !== 1 ? `, revalorisé de ×${decimal(result.trendFactor, 4)}` : ''}.`;
  });

  protected readonly curve = computed(() => {
    const s = this.result().severity;
    if (!s.curve) return null;
    const series: ChartSeries[] = [{ label: 'Densité (probabilité par 1 000 DT de coût)', values: s.curve.map((p) => p.density * 1000), tone: 'cyan', area: true }];
    return {
      series,
      xLabels: [tndShort(0), tndShort(s.curve[s.curve.length - 1].x)] as [string, string],
      summary: `Densité du coût de sinistre de 0 au quantile 99,5 % ${tnd(this.q(0.995))}. Moyenne ${tnd(s.mean)}, médiane ${tnd(this.q(0.5))}.`,
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
    <section mtr-panel panelId="sensitivity" heading="Sensibilité" description="Une hypothèse à la fois. Comparez une retarification du portefeuille au maintien de la prime actuelle.">
      <div class="table-wrap ac-rows">
        <table class="data-table">
          <caption class="sr-only">Prime et résultat attendu selon des changements d'hypothèses un par un</caption>
          <thead>
            <tr>
              <th scope="col">Changement</th>
              <th scope="col" class="num">Prime retarifée par police</th>
              <th scope="col" class="num">Variation de prime</th>
              <th scope="col" class="num">Résultat attendu à la prime actuelle</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Cas de base</th>
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
  'Fréquence   Binomiale : N ~ Bin(n, p_t), p_t = 1 − (1 − p)^t     Poisson : N ~ Poisson(λ), λ = n·t·μ',
  'Sévérité    Gamma : forme 1/c², échelle m·c²     Log-normale : σ² = ln(1 + c²), μ = ln m − σ²/2',
  'Inflation   E[X] = m × (1 + i)^années',
  'Agrégat     E[S] = E[N]·E[X]     Var(S) = E[N]·Var(X) + Var(N)·E[X]²',
  'Chargement  RL = θ·E[S] (espérance)  ou  k·sd(S) (écart-type)',
  'Technique   P_T = E[S] + RL + frais fixes + n·par police',
  'Brute       P_G = P_T ÷ (1 − v − m)   (v, m = parts de la prime brute)',
  'Résultat    E[résultat] = P_G − E[S] − frais fixes − v·P_G = RL + m·P_G',
  'Ratios      sinistres = E[S]/P_G   frais = (fixes + v·P_G)/P_G   combiné = sinistres + frais',
].join('\n');

@Component({
  selector: 'mtr-pricing-formula-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="method" heading="Comment la prime est calculée">
      <details class="ac-explain">
        <summary>Afficher les formules</summary>
        <pre class="ac-formula">{{ formulas }}</pre>
        <p class="ac-note">
          Hors périmètre ici : revenus de placement, réassurance, coût du capital et provisions réglementaires. Les coûts de sinistre n'utilisent jamais une loi normale car ils ne peuvent pas être négatifs.
        </p>
      </details>
    </section>
  `,
})
export class PricingFormulaPanelComponent {
  protected readonly formulas = PRICING_FORMULAS;
}
