import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActuarialApi, type ActuarialPreset, type RunSimulationRequest, type SimulationRunDetail, type SimulationRunSummary } from '../core/api/actuarial-api';
import { FR } from '../core/i18n/fr';
import { IconComponent } from '../shared/icon/icon.component';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { count } from './actuarial-format';
import { ActuarialTabsComponent, NumberFieldComponent, describeActuarialError, type ActuarialMessage } from './actuarial-parts.components';
import { formFromAssumptions, newSeed, validateForm, validateSimulationSettings, type AssumptionForm, type SimulationSettingsForm } from './assumption-form';
import { AssumptionsFormComponent, type AssumptionChange } from './assumptions-form.component';
import { RunKpisComponent, RunResultsComponent, SimulatedNoteComponent, SimulationMethodPanelComponent, SimulationRunsPanelComponent, runName } from './monte-carlo.components';

const DEFAULT_SETTINGS: SimulationSettingsForm = {
  simulations: '50000',
  seed: '12345',
  initialCapital: '10000',
  premiumCharged: '',
  label: '',
};

const fmt = (value: number) => String(Number(value.toFixed(3)));

/** /actuarial/monte-carlo: apps/web/src/components/actuarial/MonteCarloLab.tsx. The server runs the simulation synchronously. */
@Component({
  selector: 'mtr-monte-carlo-lab-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    PageHeadingComponent,
    ...WORKSPACE_PRIMITIVES,
    ActuarialTabsComponent,
    NumberFieldComponent,
    AssumptionsFormComponent,
    SimulatedNoteComponent,
    RunKpisComponent,
    RunResultsComponent,
    SimulationRunsPanelComponent,
    SimulationMethodPanelComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './monte-carlo-lab.page.html',
})
export class MonteCarloLabPage {
  private readonly api = inject(ActuarialApi);
  private destroyed = false;

  protected readonly copy = FR.actuarial;
  protected readonly presets = signal<ActuarialPreset[] | null>(null);
  protected readonly presetId = signal('');
  protected readonly form = signal<AssumptionForm | null>(null);
  protected readonly settings = signal<SimulationSettingsForm>(DEFAULT_SETTINGS);
  protected readonly run = signal<SimulationRunDetail | null>(null);
  private readonly runRequest = signal<string | null>(null);
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly history = signal<{ kept: number; runs: SimulationRunSummary[] } | null>(null);
  protected readonly historyMessage = signal<ActuarialMessage | null>(null);

  private readonly assumptionCheck = computed(() => {
    const form = this.form();
    return form ? validateForm(form) : null;
  });
  private readonly settingsCheck = computed(() => validateSimulationSettings(this.settings()));
  private readonly request = computed<RunSimulationRequest | null>(() => {
    const assumptions = this.assumptionCheck()?.assumptions;
    const settings = this.settingsCheck().settings;
    return assumptions && settings ? { assumptions, ...settings } : null;
  });
  protected readonly outdated = computed(() => {
    const request = this.request();
    const runRequest = this.runRequest();
    return this.run() !== null && runRequest !== null && (request === null || JSON.stringify(request) !== runRequest);
  });
  protected readonly assumptionErrors = computed(() => this.assumptionCheck()?.errors ?? {});
  protected readonly settingErrors = computed(() => this.settingsCheck().errors);
  protected readonly invalid = computed(() => Object.keys(this.assumptionErrors()).length > 0 || this.settingsCheck().settings === null);
  protected readonly runningPeriods = computed(() => {
    const settings = this.settingsCheck().settings;
    return settings ? count(settings.simulations) : '';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.loadPresets();
    void this.refreshHistory();
  }

  private async loadPresets(): Promise<void> {
    try {
      const res = await this.api.presets();
      if (this.destroyed) return;
      this.presets.set(res.presets);
      this.presetId.set(res.presets[0]?.id ?? '');
      if (res.presets[0]) this.form.set(formFromAssumptions(res.presets[0].assumptions));
    } catch (err) {
      if (!this.destroyed) this.loadError.set(describeActuarialError(err, 'The example portfolios could not be loaded.'));
    }
  }

  private async refreshHistory(): Promise<void> {
    try {
      const res = await this.api.simulations();
      if (!this.destroyed) this.history.set(res);
    } catch (err) {
      if (this.destroyed) return;
      this.history.set({ kept: 0, runs: [] });
      this.historyMessage.set({ tone: 'error', text: describeActuarialError(err, 'Your simulation runs could not be loaded.', 'simulations') });
    }
  }

  protected update({ key, value }: AssumptionChange): void {
    this.form.update((prev) => (prev ? { ...prev, [key]: value } : prev));
    this.presetId.set('');
  }

  protected applyPreset(id: string): void {
    const preset = this.presets()?.find((p) => p.id === id);
    this.presetId.set(id);
    if (preset) this.form.set(formFromAssumptions(preset.assumptions));
  }

  protected setSetting(key: keyof SimulationSettingsForm, value: string): void {
    this.settings.update((prev) => ({ ...prev, [key]: value }));
  }

  protected newSeed(): void {
    this.setSetting('seed', String(newSeed()));
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    const request = this.request();
    if (!request) return;
    this.running.set(true);
    try {
      const detail = await this.api.simulate(request);
      if (this.destroyed) return;
      this.run.set(detail);
      this.runRequest.set(JSON.stringify(request));
      this.historyMessage.set(null);
      await this.refreshHistory();
    } catch (err) {
      if (!this.destroyed) this.error.set(describeActuarialError(err, "La simulation n'a pas pu être exécutée. Réessayez.", "simulations"));
    } finally {
      this.running.set(false);
    }
  }

  protected async loadRun(summary: SimulationRunSummary): Promise<void> {
    try {
      const detail = await this.api.simulation(summary.id);
      if (this.destroyed) return;
      const loadedForm = formFromAssumptions(detail.inputs.assumptions);
      const loadedSettings: SimulationSettingsForm = {
        simulations: String(detail.simulations),
        seed: String(detail.seed),
        initialCapital: fmt(detail.inputs.initialCapital),
        premiumCharged: detail.inputs.premiumCharged === null ? '' : fmt(detail.inputs.premiumCharged),
        label: detail.label ?? '',
      };
      this.form.set(loadedForm);
      this.presetId.set('');
      this.settings.set(loadedSettings);
      this.run.set(detail);
      const loadedAssumptions = validateForm(loadedForm).assumptions;
      const loadedRun = validateSimulationSettings(loadedSettings).settings;
      this.runRequest.set(loadedAssumptions && loadedRun ? JSON.stringify({ assumptions: loadedAssumptions, ...loadedRun }) : null);
      this.error.set(null);
      this.historyMessage.set({ tone: 'ok', text: `Chargement de ${runName(summary)}. Résultats enregistrés ; relancez pour les recalculer.` });
    } catch (err) {
      if (!this.destroyed) this.historyMessage.set({ tone: 'error', text: describeActuarialError(err, "Le calcul n'a pas pu être chargé.", "simulations") });
    }
  }

  protected async deleteRun(summary: SimulationRunSummary): Promise<void> {
    if (!window.confirm(`Supprimer ${runName(summary)} ?`)) return;
    try {
      await this.api.deleteSimulation(summary.id);
      if (this.destroyed) return;
      if (this.run()?.id === summary.id) {
        this.run.set(null);
        this.runRequest.set(null);
      }
      this.historyMessage.set({ tone: 'ok', text: `${runName(summary)} supprimé.` });
      await this.refreshHistory();
    } catch (err) {
      if (!this.destroyed) this.historyMessage.set({ tone: 'error', text: describeActuarialError(err, 'The run could not be deleted.', 'simulations') });
    }
  }
}
