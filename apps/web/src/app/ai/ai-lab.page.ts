import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AiApi,
  type AiExplanation,
  type AiInsightsResponse,
  type AiModelCard,
  type AiOverview,
} from '../core/api/ai-api';
import { describeApiError } from '../core/api/errors';
import { formatNumber, formatPercent } from '../core/format/finance';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';

const DEFAULT_MODEL = 'market-return-gbm';

type Quality = 'strong' | 'modest' | 'weak' | 'unsuitable';

@Component({
  selector: 'mtr-ai-lab-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  templateUrl: './ai-lab.page.html',
  styleUrl: './ai-lab.page.css',
})
export class AiLabPage {
  private readonly api = inject(AiApi);
  private destroyed = false;

  protected readonly overview = signal<AiOverview | null>(null);
  protected readonly insights = signal<AiInsightsResponse | null>(null);
  protected readonly model = signal<AiModelCard | null>(null);
  protected readonly explanation = signal<AiExplanation | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly selectedInsight = signal<string | null>(null);
  protected readonly selectedModelId = signal(DEFAULT_MODEL);
  protected readonly formatNumber = formatNumber;
  protected readonly formatPercent = formatPercent;

  protected readonly predictiveQuality = computed((): Quality => {
    const r2 = this.model()?.metrics.test.r2;
    if (r2 === undefined) return 'weak';
    if (r2 < 0) return 'unsuitable';
    if (r2 < 0.05) return 'weak';
    if (r2 < 0.2) return 'modest';
    return 'strong';
  });

  protected readonly predictiveQualityLabel = computed(() => {
    switch (this.predictiveQuality()) {
      case 'strong':
        return 'Correcte';
      case 'modest':
        return 'Modeste';
      case 'weak':
        return 'Faible';
      default:
        return 'Sous la référence';
    }
  });

  protected readonly decisionQuality = computed((): Quality => {
    const q = this.predictiveQuality();
    if (q === 'strong' || q === 'modest') return q;
    return 'unsuitable';
  });

  protected readonly decisionQualityLabel = computed(() => {
    switch (this.decisionQuality()) {
      case 'strong':
        return 'Peut informer';
      case 'modest':
        return 'Indicative seulement';
      default:
        return 'Non recommandable';
    }
  });

  protected readonly r2Interpretation = computed(() => {
    const m = this.model();
    if (!m) return '';
    const r2 = m.metrics.test.r2;
    const base = m.metrics.baselineMeanTest.r2;
    if (r2 < 0) {
      return `R² test = ${formatNumber(r2, 3)} : le modèle fait moins bien que la référence moyenne (R² référence = ${formatNumber(base, 3)}). Badge technique « exécutable » ≠ qualité prédictive.`;
    }
    if (r2 < 0.05) {
      return `R² test = ${formatNumber(r2, 3)} : gain faible face à la référence. Les recommandations de l'agent restent purement pédagogiques.`;
    }
    return `R² test = ${formatNumber(r2, 3)} (référence moyenne = ${formatNumber(base, 3)}). Interpréter avec les limites listées ci-dessous.`;
  });

  protected readonly importanceBars = computed(() => {
    const rows = this.model()?.globalImportance ?? [];
    const max = Math.max(...rows.map((r) => Math.abs(r.importanceMean)), 1e-9);
    return rows.map((r) => ({ ...r, widthPct: Math.min(100, (Math.abs(r.importanceMean) / max) * 100) }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  protected async onModelChange(event: Event): Promise<void> {
    const id = (event.target as HTMLSelectElement).value;
    this.selectedModelId.set(id);
    this.loading.set(true);
    try {
      const model = await this.api.model(id);
      if (!this.destroyed) this.model.set(model);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Impossible de charger le modèle.'));
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [overview, insights, model] = await Promise.all([
        this.api.overview(),
        this.api.insights(),
        this.api.model(this.selectedModelId()),
      ]);
      if (this.destroyed) return;
      this.overview.set(overview);
      this.insights.set(insights);
      this.model.set(model);
      const first = insights.insights.find((i) => i.hasExplanation);
      if (first) await this.showExplanation(first.id);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, "Impossible de charger le laboratoire d'IA."));
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  protected async showExplanation(id: string): Promise<void> {
    this.selectedInsight.set(id);
    try {
      const explanation = await this.api.explanation(id);
      if (!this.destroyed) this.explanation.set(explanation);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, "Impossible de charger l'explication."));
    }
  }
}
