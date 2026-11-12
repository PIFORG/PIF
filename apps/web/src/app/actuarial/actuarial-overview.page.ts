import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActuarialApi, type ActuarialOverview } from '../core/api/actuarial-api';
import { FR } from '../core/i18n/fr';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { count, decimal, probability, ratio, tnd, tndShort } from './actuarial-format';
import { ACTUARIAL_WORKSPACES, ActuarialTabsComponent, ColumnChartComponent, EstimateNoteComponent, describeActuarialError, type ChartMarker } from './actuarial-parts.components';

const WORKSPACE_TEXT: Record<string, string> = {
  pricing: 'Fréquence et sévérité des sinistres, perte agrégée, primes, ratios et sensibilités.',
  'monte-carlo': 'Simulation avec graine des sinistres totaux, VaR, TVaR et intervalles de confiance.',
  reserving: 'Paiements, provisions dossier, IBNR et sinistres ultimes sur un triangle de développement.',
  capital: 'Actifs, passifs et probabilité d’insuffisance de capital.',
  alm: 'Flux de trésorerie actif-passif, écarts de duration, chocs de taux et liquidité.',
};

/** /actuarial: apps/web/src/components/actuarial/ActuarialOverview.tsx */
@Component({
  selector: 'mtr-actuarial-overview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeadingComponent, HeadingActionsSlot, ...WORKSPACE_PRIMITIVES, ActuarialTabsComponent, EstimateNoteComponent, ColumnChartComponent],
  host: { style: 'display: contents' },
  templateUrl: './actuarial-overview.page.html',
})
export class ActuarialOverviewPage {
  private readonly api = inject(ActuarialApi);
  private destroyed = false;

  protected readonly copy = FR.actuarial;
  protected readonly data = signal<ActuarialOverview | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly dash = '\u2014';
  protected readonly tnd = tnd;
  protected readonly tndShort = tndShort;
  protected readonly count = count;
  protected readonly decimal = decimal;
  protected readonly ratio = ratio;
  protected readonly probability = probability;
  protected readonly ratio1 = (v: number) => ratio(v, 1);
  protected readonly workspaceText = (id: string) => WORKSPACE_TEXT[id] ?? '';
  protected readonly workspaceHref = (id: string) => ACTUARIAL_WORKSPACES.find((x) => x.id === id)?.href ?? null;
  protected readonly savedDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB');

  protected readonly markers = computed<ChartMarker[]>(() => {
    const r = this.data()?.reference.pricing;
    if (!r) return [];
    return [
      { label: 'Sinistres attendus', value: r.aggregate.mean, tone: 'cyan' },
      { label: 'Budget sinistres', value: r.premium.totals.claimsBudget, tone: 'amber' },
    ];
  });

  protected readonly chartSummary = computed(() => {
    const r = this.data()?.reference.pricing;
    if (!r) return '';
    return `Sinistres totaux du portefeuille de référence : attendu ${tnd(r.aggregate.mean)} ; probabilité de dépasser le budget sinistres ${probability(r.probabilities.underwritingLoss)}.`;
  });

  protected readonly quantile995 = computed(() => tnd(this.data()?.reference.pricing.aggregate.risk.find((x) => x.level === 0.995)?.valueAtRisk ?? null));

  constructor() {
    void this.load();
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  private async load(): Promise<void> {
    try {
      const res = await this.api.overview();
      if (!this.destroyed) this.data.set(res);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeActuarialError(err, 'La synthèse actuarielle n’a pas pu se charger.'));
    }
  }
}
