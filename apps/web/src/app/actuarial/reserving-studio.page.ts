import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ActuarialApi, type ReservingBasis, type ReservingCatalogue, type ReservingMethod, type ReservingResult, type ReservingRunSummary } from '../core/api/actuarial-api';
import { FR } from '../core/i18n/fr';
import { IconComponent } from '../shared/icon/icon.component';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { ActuarialTabsComponent, describeActuarialError, type ActuarialMessage } from './actuarial-parts.components';
import { formFromInputs, resizeSelections, validateReservingForm, type ReservingForm } from './reserving-form';
import {
  CashFlowPanelComponent,
  ChecksPanelComponent,
  CurvesPanelComponent,
  FactorsPanelComponent,
  MethodsPanelComponent,
  PaidIncurredPanelComponent,
  ReserveKpisComponent,
  ReservesPanelComponent,
  ReservingAssumptionsComponent,
  ReservingDataFormComponent,
  ReservingMethodNotesComponent,
  ReservingRunsPanelComponent,
  ReservingSensitivityPanelComponent,
  TrianglePanelComponent,
  type FactorSelection,
  type ReservingChange,
} from './reserving.components';

const DEBOUNCE_MS = 400;

interface Shown {
  results: ReservingResult;
  key: string;
  run: ReservingRunSummary | null;
}

/** /actuarial/reserving: apps/web/src/components/actuarial/ReservingStudio.tsx */
@Component({
  selector: 'mtr-reserving-studio-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    PageHeadingComponent,
    ...WORKSPACE_PRIMITIVES,
    ActuarialTabsComponent,
    ReservingDataFormComponent,
    ReservingAssumptionsComponent,
    ReserveKpisComponent,
    ChecksPanelComponent,
    TrianglePanelComponent,
    FactorsPanelComponent,
    ReservesPanelComponent,
    MethodsPanelComponent,
    PaidIncurredPanelComponent,
    CurvesPanelComponent,
    ReservingSensitivityPanelComponent,
    CashFlowPanelComponent,
    ReservingRunsPanelComponent,
    ReservingMethodNotesComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './reserving-studio.page.html',
})
export class ReservingStudioPage {
  private readonly api = inject(ActuarialApi);
  private destroyed = false;
  private controller: AbortController | null = null;

  protected readonly copy = FR.actuarial;
  protected readonly catalogue = signal<ReservingCatalogue | null>(null);
  protected readonly exampleId = signal('');
  protected readonly form = signal<ReservingForm | null>(null);
  protected readonly shown = signal<Shown | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly method = signal<ReservingMethod>('CHAIN_LADDER_PAID');
  protected readonly history = signal<{ kept: number; runs: ReservingRunSummary[] } | null>(null);
  protected readonly historyMessage = signal<ActuarialMessage | null>(null);

  private readonly validation = computed(() => {
    const form = this.form();
    const catalogue = this.catalogue();
    return form && catalogue ? validateReservingForm(form, catalogue.limits) : null;
  });
  private readonly request = computed(() => this.validation()?.request ?? null);
  private readonly requestKey = computed(() => {
    const request = this.request();
    return request ? JSON.stringify(request) : null;
  });
  protected readonly errors = computed(() => this.validation()?.errors ?? {});
  protected readonly invalid = computed(() => Object.keys(this.errors()).length > 0);
  protected readonly outdated = computed(() => {
    const shown = this.shown();
    return shown !== null && shown.key !== this.requestKey();
  });
  protected readonly results = computed(() => this.shown()?.results ?? null);
  protected readonly methods = computed(() => this.catalogue()?.methods ?? []);
  protected readonly exampleText = computed(() => this.catalogue()?.examples.find((e) => e.id === this.exampleId())?.description ?? null);
  protected readonly canSave = computed(() => this.request() !== null && !this.outdated() && !this.busy());

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.controller?.abort();
    });
    void this.loadCatalogue();
    void this.refreshHistory();

    effect((onCleanup) => {
      const request = this.request();
      const requestKey = this.requestKey();
      if (!request || requestKey === null || this.shown()?.key === requestKey) return;
      const timer = window.setTimeout(() => {
        this.controller?.abort();
        const current = new AbortController();
        this.controller = current;
        this.busy.set(true);
        this.api
          .analyzeReserving(request, { signal: current.signal })
          .then((res) => {
            if (current.signal.aborted) return;
            this.shown.set({ results: res.results, key: requestKey, run: null });
            this.error.set(null);
          })
          .catch((err: unknown) => {
            if (current.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
            this.error.set(describeActuarialError(err, "Les provisions n'ont pas pu être calculées. Réessayez.", "reserving"));
          })
          .finally(() => {
            if (!current.signal.aborted) this.busy.set(false);
          });
      }, DEBOUNCE_MS);
      onCleanup(() => window.clearTimeout(timer));
    });
  }

  private async loadCatalogue(): Promise<void> {
    try {
      const res = await this.api.reservingExamples();
      if (this.destroyed) return;
      this.catalogue.set(res);
      const first = res.examples[0];
      if (first) {
        this.exampleId.set(first.id);
        this.form.set(formFromInputs(first.data, first.assumptions));
      }
    } catch (err) {
      if (!this.destroyed) this.loadError.set(describeActuarialError(err, 'Les exemples de provisionnement n\'ont pas pu être chargés.', 'reserving'));
    }
  }

  private async refreshHistory(): Promise<void> {
    try {
      const res = await this.api.reservingRuns();
      if (!this.destroyed) this.history.set(res);
    } catch (err) {
      if (this.destroyed) return;
      this.history.set({ kept: 0, runs: [] });
      this.historyMessage.set({ tone: 'error', text: describeActuarialError(err, 'Vos calculs de provisionnement n\'ont pas pu être chargés.', 'reserving') });
    }
  }

  private update<K extends keyof ReservingForm>(key: K, value: ReservingForm[K]): void {
    this.form.update((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      return key === 'paid' ? resizeSelections(next) : next;
    });
    if (key !== 'selectedPaid' && key !== 'selectedIncurred') this.exampleId.set('');
  }

  protected change({ key, value }: ReservingChange): void {
    this.update(key, value as ReservingForm[typeof key]);
  }

  protected selectFactor({ basis, index, value }: FactorSelection): void {
    this.form.update((prev) => {
      if (!prev) return prev;
      const key = basis === 'PAID' ? 'selectedPaid' : 'selectedIncurred';
      const list = [...prev[key]];
      list[index] = value;
      return { ...prev, [key]: list };
    });
  }

  protected clearSelections(basis: ReservingBasis): void {
    const form = this.form();
    if (!form) return;
    this.update(
      basis === 'PAID' ? 'selectedPaid' : 'selectedIncurred',
      form.selectedPaid.map(() => ''),
    );
  }

  protected applyExample(id: string): void {
    const example = this.catalogue()?.examples.find((e) => e.id === id);
    this.exampleId.set(id);
    if (example) this.form.set(formFromInputs(example.data, example.assumptions));
  }

  protected setMethod(method: ReservingMethod): void {
    this.method.set(method);
  }

  protected async loadRun(summary: ReservingRunSummary): Promise<void> {
    try {
      const detail = await this.api.reservingRun(summary.id);
      if (this.destroyed) return;
      const loaded = formFromInputs(detail.inputs.data, detail.inputs.assumptions);
      const catalogue = this.catalogue();
      const check = catalogue ? validateReservingForm(loaded, catalogue.limits).request : null;
      this.controller?.abort();
      this.busy.set(false);
      this.form.set(loaded);
      this.exampleId.set('');
      this.shown.set({ results: detail.results, key: check ? JSON.stringify(check) : `run:${detail.id}`, run: summary });
      this.error.set(null);
      this.historyMessage.set({ tone: 'ok', text: `« ${summary.label} » chargé. Ce sont ses résultats enregistrés ; modifiez une entrée pour recalculer.` });
    } catch (err) {
      if (!this.destroyed) this.historyMessage.set({ tone: 'error', text: describeActuarialError(err, 'Le calcul n\'a pas pu être chargé.', 'reserving') });
    }
  }

  protected async deleteRun(summary: ReservingRunSummary): Promise<void> {
    if (!window.confirm(`Supprimer « ${summary.label} » ?`)) return;
    try {
      await this.api.deleteReservingRun(summary.id);
      if (this.destroyed) return;
      this.shown.update((prev) => (prev?.run?.id === summary.id ? { ...prev, run: null } : prev));
      this.historyMessage.set({ tone: 'ok', text: `« ${summary.label} » supprimé.` });
      await this.refreshHistory();
    } catch (err) {
      if (!this.destroyed) this.historyMessage.set({ tone: 'error', text: describeActuarialError(err, 'Le calcul n\'a pas pu être supprimé.', 'reserving') });
    }
  }

  protected readonly saveRun = async (label: string): Promise<boolean> => {
    const request = this.request();
    if (!request) return false;
    try {
      const detail = await this.api.saveReservingRun(label, request);
      if (this.destroyed) return false;
      this.shown.set({ results: detail.results, key: JSON.stringify(request), run: detail });
      this.historyMessage.set({ tone: 'ok', text: `« ${detail.label} » enregistré.` });
      await this.refreshHistory();
      return true;
    } catch (err) {
      if (!this.destroyed) this.historyMessage.set({ tone: 'error', text: describeActuarialError(err, 'Le calcul n\'a pas pu être enregistré.', 'reserving') });
      return false;
    }
  };
}
