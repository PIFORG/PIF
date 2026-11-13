import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { describeApiError } from '../core/api/errors';
import {
  StressApi,
  type BankId,
  type BankRun,
  type EmulatorTarget,
  type FactorDefinition,
  type ModelCard,
  type FactorKey,
  type ResilienceStatus,
  type StressCatalog,
  type StressFactorValues,
  type StressRunResult,
} from '../core/api/stress-api';
import { FR } from '../core/i18n/fr';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { mdt, num, pp, prob, pts, ratio } from './stress-format';

const DEFAULT_PRESET = 'recession';

const STATUS_TONE: Record<ResilienceStatus, 'positive' | 'warning' | 'negative'> = {
  RESILIENT: 'positive',
  UNDER_WATCH: 'warning',
  VULNERABLE: 'negative',
};

/**
 * Bank stress testing: one scenario applied to a conventional and a participative fictional bank. Every figure comes
 * from POST /api/stress/run; the page only formats and lays out what the server computed.
 */
@Component({
  selector: 'mtr-stress-testing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeadingComponent, ...WORKSPACE_PRIMITIVES, LineChartComponent],
  host: { style: 'display: contents' },
  templateUrl: './stress-testing.page.html',
  styleUrl: './stress-testing.page.css',
})
export class StressTestingPage {
  private readonly api = inject(StressApi);
  private destroyed = false;
  private runSeq = 0;

  protected readonly nav = FR.nav;
  protected readonly catalog = signal<StressCatalog | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly result = signal<StressRunResult | null>(null);
  protected readonly running = signal(false);
  protected readonly runError = signal<string | null>(null);

  protected readonly presetId = signal<string | null>(DEFAULT_PRESET);
  protected readonly factors = signal<StressFactorValues | null>(null);
  protected readonly intensity = signal(1);
  protected readonly selectedBank = signal<BankId>('CONVENTIONAL');

  protected readonly modelCard = signal<ModelCard | null>(null);
  protected readonly modelError = signal<string | null>(null);
  protected readonly targets: { id: EmulatorTarget; short: string }[] = [
    { id: 'CET1_CHANGE_PP', short: 'Ratio CET1' },
    { id: 'LCR_CHANGE_PP', short: 'LCR' },
  ];
  protected readonly modelIds = ['MEAN', 'LINEAR', 'GBM'] as const;

  protected readonly mdt = mdt;
  protected readonly ratio = ratio;
  protected readonly pp = pp;
  protected readonly pts = pts;
  protected readonly prob = prob;
  protected readonly num = num;
  protected readonly statusTone = STATUS_TONE;

  protected readonly scenarioName = computed(() => {
    const id = this.presetId();
    if (id === null) return 'Scénario personnalisé';
    return this.catalog()?.presets.find((p) => p.id === id)?.name ?? id;
  });

  protected readonly banks = computed(() => this.result()?.banks ?? []);
  protected readonly selected = computed<BankRun | null>(
    () => this.banks().find((b) => b.id === this.selectedBank()) ?? null,
  );
  protected readonly selectedProfile = computed(
    () => this.catalog()?.banks.find((b) => b.id === this.selectedBank()) ?? null,
  );

  /** Capital bridge of the selected bank, with bar widths relative to the largest step. */
  protected readonly bridge = computed(() => {
    const run = this.selected();
    if (!run) return null;
    const max = Math.max(1e-9, ...run.capitalBridge.steps.map((s) => Math.abs(s.amount)));
    return {
      start: run.capitalBridge.start,
      end: run.capitalBridge.end,
      steps: run.capitalBridge.steps.map((s) => ({
        ...s,
        width: (Math.abs(s.amount) / max) * 100,
        direction: s.amount < 0 ? 'down' : 'up',
      })),
    };
  });

  /** Shapley contributions of each factor to the CET1 change, side by side for both banks. */
  protected readonly attribution = computed(() => {
    const r = this.result();
    if (!r) return null;
    const conv = r.banks.find((b) => b.id === 'CONVENTIONAL');
    const part = r.banks.find((b) => b.id === 'PARTICIPATIVE');
    if (!conv || !part) return null;
    const rows = conv.attribution.cet1Ratio.map((c, i) => ({
      factor: c.factor,
      label: c.label,
      conventional: c.value,
      participative: part.attribution.cet1Ratio[i]?.value ?? 0,
    }));
    const max = Math.max(1e-12, ...rows.flatMap((row) => [Math.abs(row.conventional), Math.abs(row.participative)]));
    return {
      rows: rows.map((row) => ({
        ...row,
        convWidth: (Math.abs(row.conventional) / max) * 50,
        partWidth: (Math.abs(row.participative) / max) * 50,
        active: Math.abs(row.conventional) > 1e-9 || Math.abs(row.participative) > 1e-9,
      })),
      totals: { conventional: conv.attribution.cet1RatioTotal, participative: part.attribution.cet1RatioTotal },
    };
  });

  protected readonly sensitivityChart = computed(() => {
    const r = this.result();
    if (!r || r.sensitivity.length < 2) return null;
    const min = r.thresholds.cet1Minimum * 100;
    const series: ChartSeries[] = [
      { label: 'Banque conventionnelle', values: r.sensitivity.map((p) => p.CONVENTIONAL.cet1Ratio * 100), tone: 'brand' },
      { label: 'Banque participative', values: r.sensitivity.map((p) => p.PARTICIPATIVE.cet1Ratio * 100), tone: 'cyan' },
      { label: `Seuil CET1 ${num(min, 0)} %`, values: r.sensitivity.map(() => min), tone: 'muted', dashed: true },
    ];
    const first = r.sensitivity[0];
    const last = r.sensitivity[r.sensitivity.length - 1];
    return {
      series,
      summary: `Ratio CET1 projeté selon l'intensité du scénario, de ${num(first.intensity, 0)} à ${num(last.intensity, 0)} fois les chocs définis.`,
      xLabels: [`Intensité ${num(first.intensity, 0)} (aucun choc)`, `Intensité ${num(last.intensity, 0)}`] as [string, string],
    };
  });

  protected readonly formatPercentAxis = (v: number) => `${num(v, 1)} %`;

  /** Model estimate of the selected bank, with contribution bars scaled to the largest |φ| of model or engine. */
  protected readonly ai = computed(() => {
    const est = this.selected()?.aiEstimate;
    if (!est) return null;
    return {
      outside: est.outsideTrainingRange.map(
        (key) => this.catalog()?.factors.find((f) => f.key === key)?.label ?? key,
      ),
      targets: this.targets.map((t) => {
        const e = est[t.id];
        const max = Math.max(1e-9, ...e.contributions.flatMap((c) => [Math.abs(c.model), Math.abs(c.engine)]));
        return {
          ...t,
          estimate: e,
          rows: e.contributions.map((c) => ({
            ...c,
            modelWidth: (Math.abs(c.model) / max) * 50,
            engineWidth: (Math.abs(c.engine) / max) * 50,
            active: Math.abs(c.model) > 1e-6 || Math.abs(c.engine) > 1e-6,
          })),
        };
      }),
    };
  });

  /** Breach detection scores, test then extrapolation, linear then boosting. */
  protected readonly breachRows = computed(() => {
    const card = this.modelCard();
    if (!card) return [];
    const splits = [
      ['test', 'Test'],
      ['extrapolation', 'Extrapolation'],
    ] as const;
    const models = [
      ['LINEAR', 'Régression linéaire'],
      ['GBM', 'Gradient boosting'],
    ] as const;
    return splits.flatMap(([split, splitLabel]) =>
      models.map(([id, label], i) => ({
        key: `${split}-${id}`,
        split: i === 0 ? splitLabel : '',
        model: label,
        scores: card.breachDetection[split][id],
      })),
    );
  });

  /** Permutation importance of the boosting model per target, as bars relative to the most important feature. */
  protected readonly importance = computed(() => {
    const card = this.modelCard();
    if (!card) return null;
    return this.targets.map((t) => {
      const items = card.targets[t.id].permutationImportance;
      const max = Math.max(1e-9, ...items.map((i) => Math.max(0, i.gbm)));
      return {
        ...t,
        label: card.targets[t.id].label,
        rounds: card.targets[t.id].boostingRounds,
        rows: [...items].sort((a, b) => b.gbm - a.gbm).map((i) => ({ ...i, width: (Math.max(0, i.gbm) / max) * 100 })),
      };
    });
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const catalog = await this.api.catalog();
      if (this.destroyed) return;
      this.catalog.set(catalog);
      const preset = catalog.presets.find((p) => p.id === DEFAULT_PRESET) ?? catalog.presets[0];
      this.presetId.set(preset?.id ?? null);
      this.factors.set(preset ? { ...preset.factors } : this.neutral(catalog.factors));
      void this.loadModel();
      await this.run();
    } catch (err) {
      if (this.destroyed) return;
      this.loadError.set(describeApiError(err, "Le module de tests de résistance n'a pas pu être chargé."));
    }
  }

  private async loadModel(): Promise<void> {
    try {
      const card = await this.api.model();
      if (!this.destroyed) this.modelCard.set(card);
    } catch (err) {
      if (!this.destroyed) this.modelError.set(describeApiError(err, "La fiche du modèle d'IA n'a pas pu être chargée."));
    }
  }

  protected r2(value: number): string {
    return num(value, 4);
  }

  /** An unsigned error in percentage points (no + sign: errors here are absolute values). */
  protected errorPts(value: number): string {
    return `${num(value, 2)} pp`;
  }

  protected fidelity(same: boolean | null): string {
    if (same === null) return 'Aucune variation à expliquer pour ce scénario';
    return same ? 'Même facteur principal que le moteur' : 'Facteur principal différent du moteur';
  }

  protected share(value: number | null): string {
    return value === null ? '—' : ratio(value, 1);
  }

  private neutral(defs: FactorDefinition[]): StressFactorValues {
    return Object.fromEntries(defs.map((d) => [d.key, d.neutral])) as StressFactorValues;
  }

  protected selectPreset(id: string): void {
    const preset = this.catalog()?.presets.find((p) => p.id === id);
    if (!preset) return;
    this.presetId.set(id);
    this.factors.set({ ...preset.factors });
    void this.run();
  }

  protected setFactor(key: FactorKey, raw: string | number): void {
    const def = this.catalog()?.factors.find((f) => f.key === key);
    const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!def || !Number.isFinite(value)) return;
    const clamped = Math.min(def.max, Math.max(def.min, value));
    this.factors.update((f) => (f ? { ...f, [key]: clamped } : f));
    this.presetId.set(null);
  }

  protected setIntensity(raw: string | number): void {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(value)) this.intensity.set(Math.min(this.catalog()?.maxIntensity ?? 2, Math.max(0, value)));
  }

  protected factorValue(key: FactorKey): number {
    return this.factors()?.[key] ?? 0;
  }

  protected factorStep(def: FactorDefinition): number {
    return def.unit === '×' ? 0.1 : def.unit === 'pb' ? 25 : 1;
  }

  protected async run(): Promise<void> {
    const factors = this.factors();
    if (!factors) return;
    const seq = ++this.runSeq;
    this.running.set(true);
    this.runError.set(null);
    try {
      const preset = this.presetId();
      const result = await this.api.run(
        preset === null ? { factors, intensity: this.intensity() } : { scenario: preset, intensity: this.intensity() },
      );
      if (this.destroyed || seq !== this.runSeq) return;
      this.result.set(result);
    } catch (err) {
      if (this.destroyed || seq !== this.runSeq) return;
      this.runError.set(describeApiError(err, "Le test de résistance n'a pas pu être exécuté."));
    } finally {
      if (!this.destroyed && seq === this.runSeq) this.running.set(false);
    }
  }

  protected bankLabel(id: BankId): string {
    return id === 'CONVENTIONAL' ? 'Conventionnelle' : 'Participative';
  }
}
