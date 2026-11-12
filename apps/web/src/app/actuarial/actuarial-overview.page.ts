import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActuarialApi, type ActuarialOverview } from '../core/api/actuarial-api';
import { FR } from '../core/i18n/fr';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { count, decimal, probability, ratio, tnd, tndShort } from './actuarial-format';
import { ACTUARIAL_WORKSPACES, ActuarialTabsComponent, ColumnChartComponent, EstimateNoteComponent, describeActuarialError, type ChartMarker } from './actuarial-parts.components';

const WORKSPACE_TEXT: Record<string, string> = {
  pricing: 'Claim frequency and severity, aggregate loss, premiums, ratios and sensitivities.',
  'monte-carlo': 'Seeded simulation of total claims with VaR, TVaR and confidence intervals.',
  reserving: 'Paid, case reserves, IBNR and ultimate claims on a development triangle.',
  capital: 'Assets, liabilities and the probability that capital is insufficient.',
  alm: 'Asset–liability cash flows, duration gaps, rate shocks and liquidity.',
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
      { label: 'Expected claims', value: r.aggregate.mean, tone: 'cyan' },
      { label: 'Claims budget', value: r.premium.totals.claimsBudget, tone: 'amber' },
    ];
  });

  protected readonly chartSummary = computed(() => {
    const r = this.data()?.reference.pricing;
    if (!r) return '';
    return `Reference portfolio total claims: expected ${tnd(r.aggregate.mean)}; probability of exceeding the claims budget ${probability(r.probabilities.underwritingLoss)}.`;
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
      if (!this.destroyed) this.error.set(describeActuarialError(err, 'The actuarial overview could not be loaded.'));
    }
  }
}
