import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { describeApiError } from '../core/api/errors';
import {
  StressApi,
  type AbsorptionItem,
  type BankId,
  type BankRun,
  type EmulatorTarget,
  type FactorDefinition,
  type ModelCard,
  type FactorKey,
  type ResilienceStatus,
  type StressCatalog,
  type StressFactorValues,
  type StressPreview,
  type StressRunRequest,
  type StressRunResult,
} from '../core/api/stress-api';
import { FR } from '../core/i18n/fr';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { mdt, num, pp, prob, pts, ratio } from './stress-format';

const DEFAULT_PRESET = 'recession';
/** Delay before asking the model for a preview while a slider moves, and before running the engine once it stops. */
const PREVIEW_DELAY_MS = 80;
const RUN_DELAY_MS = 350;
/** Top of the capital gauge, as a ratio. */
const GAUGE_TOP = 0.2;

const STATUS_TONE: Record<ResilienceStatus, 'positive' | 'warning' | 'negative'> = {
  RESILIENT: 'positive',
  UNDER_WATCH: 'warning',
  VULNERABLE: 'negative',
};

/**
 * Bank stress testing: one scenario applied to a conventional and a participative fictional bank. Every figure comes
 * from POST /api/stress/run; the page only formats and lays out what the server computed.
 */
interface Gauge {
  /** Positions on the gauge, in % of its width. */
  minimum: number;
  buffer: number;
  baseline: number;
  stressed: number;
  stressedValue: number;
  lcrValue: number;
  isPreview: boolean;
  zone: 'positive' | 'warning' | 'negative';
}

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
  private previewSeq = 0;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private runTimer: ReturnType<typeof setTimeout> | null = null;

  /** The latest model preview, and the request it answers. */
  protected readonly preview = signal<StressPreview | null>(null);
  private readonly previewKey = signal<string | null>(null);
  /** The request the displayed engine result answers. */
  private readonly resultKey = signal<string | null>(null);
  /** The preview that was on screen for exactly the request the engine has just confirmed, to show its error. */
  protected readonly confirmedPreview = signal<StressPreview | null>(null);

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

  private readonly currentKey = computed(() => (this.factors() ? JSON.stringify(this.requestBody()) : null));

  /** True while the shocks on screen differ from those of the displayed engine result. */
  protected readonly stale = computed(() => this.result() !== null && this.currentKey() !== this.resultKey());

  /** The model preview for the shocks on screen, shown only while the exact result is out of date. */
  protected readonly livePreview = computed(() => {
    const p = this.preview();
    if (!p?.ready || !this.stale() || this.previewKey() !== this.currentKey()) return null;
    return p;
  });

  /** Capital gauge per bank: thresholds, the one-year baseline and the stressed value (exact or previewed). */
  protected readonly gauges = computed(() => {
    const r = this.result();
    if (!r) return {} as Record<BankId, Gauge>;
    const live = this.livePreview();
    const pos = (v: number) => Math.max(0, Math.min(100, (v / GAUGE_TOP) * 100));
    const out = {} as Record<BankId, Gauge>;
    for (const b of r.banks) {
      const previewed = live?.banks.find((p) => p.id === b.id) ?? null;
      const stressed = previewed ? previewed.cet1Ratio : b.projections.stressed.cet1Ratio;
      out[b.id] = {
        minimum: pos(r.thresholds.cet1Minimum),
        buffer: pos(r.thresholds.cet1Minimum + r.thresholds.cet1Buffer),
        baseline: pos(b.projections.baseline.cet1Ratio),
        stressed: pos(stressed),
        stressedValue: stressed,
        lcrValue: previewed ? previewed.lcr : b.projections.stressed.lcr,
        isPreview: previewed !== null,
        zone: stressed < r.thresholds.cet1Minimum ? 'negative'
          : stressed < r.thresholds.cet1Minimum + r.thresholds.cet1Buffer ? 'warning' : 'positive',
      };
    }
    return out;
  });

  /** "Who bears the shock": both banks on one height scale, so their losses compare at a glance. */
  protected readonly mirrors = computed(() => {
    const r = this.result();
    if (!r) return null;
    const max = Math.max(1e-9, ...r.banks.map((b) => b.lossAbsorption.total));
    const blocks = (items: AbsorptionItem[], total: number) =>
      items.map((i) => ({ ...i, share: total > 0 ? (i.amount / total) * 100 : 0 }));
    return r.banks.map((b) => ({
      id: b.id,
      name: b.name,
      total: b.lossAbsorption.total,
      height: (b.lossAbsorption.total / max) * 100,
      sources: blocks(b.lossAbsorption.sources, b.lossAbsorption.total),
      absorbers: blocks(b.lossAbsorption.absorbers, b.lossAbsorption.total),
      reference: b.lossAbsorption.reference,
    }));
  });

  /** SHAP-style waterfall of the selected bank: from the one-year baseline to the stressed CET1 ratio, factor by factor. */
  protected readonly waterfall = computed(() => {
    const b = this.selected();
    const r = this.result();
    if (!b || !r) return null;
    const start = b.projections.baseline.cet1Ratio;
    const end = b.projections.stressed.cet1Ratio;
    const steps = b.attribution.cet1Ratio
      .filter((c) => Math.abs(c.value) > 1e-7)
      .sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
    let level = start;
    const raw = steps.map((s) => {
      const from = level;
      level += s.value;
      return { ...s, from, to: level };
    });
    const values = [start, end, r.thresholds.cet1Minimum, ...raw.map((s) => s.to)];
    const span = Math.max(...values) - Math.min(...values) || 0.01;
    const lo = Math.min(...values) - span * 0.06;
    const hi = Math.max(...values) + span * 0.06;
    const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
    return {
      start: { value: start, at: x(start) },
      end: { value: end, at: x(end) },
      threshold: x(r.thresholds.cet1Minimum),
      lo,
      hi,
      rows: raw.map((s) => ({
        factor: s.factor,
        label: s.label,
        value: s.value,
        left: x(Math.min(s.from, s.to)),
        width: Math.max(0.6, (Math.abs(s.value) / (hi - lo)) * 100),
        sign: s.value < 0 ? 'neg' : 'pos',
      })),
    };
  });

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
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      if (this.previewTimer) clearTimeout(this.previewTimer);
      if (this.runTimer) clearTimeout(this.runTimer);
    });
    void this.load();
  }

  private requestBody(): StressRunRequest {
    const preset = this.presetId();
    const factors = this.factors() ?? undefined;
    return preset === null ? { factors, intensity: this.intensity() } : { scenario: preset, intensity: this.intensity() };
  }

  /** While a slider moves: update the value and ask the model for an instant estimate. */
  protected slide(key: FactorKey, raw: string): void {
    this.setFactor(key, raw);
    this.schedulePreview();
  }

  protected slideIntensity(raw: string): void {
    this.setIntensity(raw);
    this.schedulePreview();
  }

  /** Once the user lets go (or types a value): compute the exact result. */
  protected settleScenario(): void {
    if (this.runTimer) clearTimeout(this.runTimer);
    this.runTimer = setTimeout(() => {
      this.runTimer = null;
      void this.run();
    }, RUN_DELAY_MS);
  }

  private schedulePreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      void this.requestPreview();
    }, PREVIEW_DELAY_MS);
  }

  private async requestPreview(): Promise<void> {
    if (!this.factors()) return;
    const body = this.requestBody();
    const key = JSON.stringify(body);
    const seq = ++this.previewSeq;
    try {
      const preview = await this.api.preview(body);
      if (this.destroyed || seq !== this.previewSeq) return;
      this.preview.set(preview);
      this.previewKey.set(key);
    } catch {
      // A failed preview only delays feedback: the exact run that follows reports any real error.
    }
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
    if (this.runTimer) {
      clearTimeout(this.runTimer);
      this.runTimer = null;
    }
    const seq = ++this.runSeq;
    const body = this.requestBody();
    this.running.set(true);
    this.runError.set(null);
    try {
      const result = await this.api.run(body);
      if (this.destroyed || seq !== this.runSeq) return;
      const key = JSON.stringify(body);
      this.confirmedPreview.set(this.previewKey() === key && this.preview()?.ready ? this.preview() : null);
      this.result.set(result);
      this.resultKey.set(key);
    } catch (err) {
      if (this.destroyed || seq !== this.runSeq) return;
      this.runError.set(describeApiError(err, "Le test de résistance n'a pas pu être exécuté."));
    } finally {
      if (!this.destroyed && seq === this.runSeq) this.running.set(false);
    }
  }

  /** "The AI preview announced x % (error y pp)" for a bank, once the engine has confirmed the previewed scenario. */
  protected previewCheck(b: BankRun): { value: number; error: number } | null {
    if (this.stale()) return null;
    const p = this.confirmedPreview()?.banks.find((x) => x.id === b.id);
    return p ? { value: p.cet1Ratio, error: p.cet1Ratio - b.projections.stressed.cet1Ratio } : null;
  }

  protected bankLabel(id: BankId): string {
    return id === 'CONVENTIONAL' ? 'Conventionnelle' : 'Participative';
  }
}
