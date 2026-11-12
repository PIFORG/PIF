import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { ActuarialApi, type ActuarialPreset, type PricingAssumptions, type PricingResult, type ScenarioSummary } from '../core/api/actuarial-api';
import { hasErrorCode } from '../core/api/errors';
import { FR } from '../core/i18n/fr';
import { IconComponent } from '../shared/icon/icon.component';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { probability, ratio, tnd } from './actuarial-format';
import { ActuarialTabsComponent, EstimateNoteComponent, describeActuarialError, type ActuarialMessage } from './actuarial-parts.components';
import { formFromAssumptions, validateForm, type AssumptionForm } from './assumption-form';
import { AssumptionsFormComponent, type AssumptionChange } from './assumptions-form.component';
import {
  FrequencyPanelComponent,
  LossDistributionPanelComponent,
  PremiumBuildUpComponent,
  PremiumKpisComponent,
  PricingFormulaPanelComponent,
  PricingSensitivityPanelComponent,
  SeverityPanelComponent,
} from './pricing-results.components';

const DEBOUNCE_MS = 350;
const SCENARIO_NAME = /^[\p{L}\p{N} .,'&()%+/-]{1,80}$/u;

@Component({
  selector: 'mtr-scenarios-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...WORKSPACE_PRIMITIVES],
  host: { style: 'display: contents' },
  template: `
    <section mtr-panel panelId="scenarios" heading="Scénarios enregistrés" [description]="scenariosDescription()">
      <form class="ac-saveForm" (submit)="save($event)">
        <div class="field">
          <label class="field-label" for="act-scenario-name">Nom du scénario</label>
          <input id="act-scenario-name" class="input" maxlength="80" autocomplete="off" [value]="name()" (input)="name.set($any($event.target).value)" />
        </div>
        <button type="submit" class="btn btn-secondary" [disabled]="pending() || !name().trim()">{{ pending() ? 'Enregistrement…' : 'Enregistrer les hypothèses actuelles' }}</button>
      </form>
      @if (message(); as m) {
        <p [class]="m.tone === 'error' ? 'field-error' : 'field-hint'" [attr.role]="m.tone === 'error' ? 'alert' : 'status'">{{ m.text }}</p>
      }
      @if (scenarios() === null) {
        <div mtr-panel-skeleton [rows]="2"></div>
      } @else if (scenarios()!.length === 0) {
        <div mtr-empty-state icon="info" heading="Aucun scénario enregistré" description="Enregistrez les hypothèses actuelles pour les comparer plus tard."></div>
      } @else {
        <div class="table-wrap ac-rows">
          <table class="data-table">
            <caption class="sr-only">Vos scénarios de tarification enregistrés</caption>
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col" class="num">Prime par police</th>
                <th scope="col" class="num">Ratio combiné</th>
                <th scope="col" class="num">P(perte technique)</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (s of scenarios(); track s.id) {
                <tr>
                  <th scope="row">
                    {{ s.name }}
                    @if (s.stale) {
                      <span class="ac-hint">Enregistré avec une version antérieure du modèle</span>
                    }
                  </th>
                  <td class="num">{{ tnd(s.headline.grossPremiumPerPolicy) }}</td>
                  <td class="num">{{ ratio(s.headline.combinedRatio, 1) }}</td>
                  <td class="num">{{ probability(s.headline.probabilityOfUnderwritingLoss) }}</td>
                  <td>
                    <div class="ac-rowActions">
                      <button type="button" class="btn btn-ghost btn-sm" (click)="load(s)">Charger<span class="sr-only"> {{ s.name }}</span></button>
                      <button type="button" class="btn btn-ghost btn-sm" (click)="remove(s)">Supprimer<span class="sr-only"> {{ s.name }}</span></button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class ScenariosPanelComponent {
  private readonly api = inject(ActuarialApi);
  private destroyed = false;

  readonly form = input.required<AssumptionForm | null>();
  /** Assumptions of a stored scenario, to be recalculated with the current model. */
  readonly loaded = output<AssumptionForm>();

  protected readonly scenarios = signal<ScenarioSummary[] | null>(null);
  protected readonly limit = signal(50);
  protected readonly name = signal('');
  protected readonly message = signal<ActuarialMessage | null>(null);
  protected readonly pending = signal(false);
  protected readonly tnd = tnd;
  protected readonly ratio = ratio;
  protected readonly probability = probability;

  protected scenariosDescription(): string {
    return `Hypothèses et résultats calculés côté serveur, privés. Jusqu’à ${this.limit()}.`;
  }

  constructor() {
    void this.refresh();
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  private async refresh(): Promise<void> {
    try {
      const res = await this.api.scenarios();
      if (this.destroyed) return;
      this.scenarios.set(res.scenarios);
      this.limit.set(res.limit);
    } catch (err) {
      if (this.destroyed) return;
      this.scenarios.set([]);
      this.message.set({ tone: 'error', text: describeActuarialError(err, 'Your saved scenarios could not be loaded.') });
    }
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const trimmed = this.name().trim();
    if (!SCENARIO_NAME.test(trimmed)) {
      this.message.set({ tone: 'error', text: "Use 1–80 letters, digits, spaces or . , ' & ( ) % + / -" });
      return;
    }
    const form = this.form();
    const assumptions = form ? validateForm(form).assumptions : null;
    if (!assumptions) {
      this.message.set({ tone: 'error', text: 'Fix the assumptions before saving.' });
      return;
    }
    this.pending.set(true);
    try {
      await this.api.saveScenario(trimmed, assumptions);
      if (this.destroyed) return;
      this.name.set('');
      this.message.set({ tone: 'ok', text: `« ${trimmed} » enregistré.` });
      await this.refresh();
    } catch (err) {
      if (this.destroyed) return;
      this.message.set({
        tone: 'error',
        text: hasErrorCode(err, 'SCENARIO_NAME_TAKEN') ? 'You already have a scenario with this name.' : describeActuarialError(err, 'The scenario could not be saved.'),
      });
    } finally {
      this.pending.set(false);
    }
  }

  protected async load(s: ScenarioSummary): Promise<void> {
    try {
      const detail = await this.api.scenario(s.id);
      if (this.destroyed) return;
      this.loaded.emit(formFromAssumptions(detail.inputs));
      this.message.set({ tone: 'ok', text: `« ${s.name} » chargé. Les résultats sont recalculés avec le modèle actuel.` });
    } catch (err) {
      if (!this.destroyed) this.message.set({ tone: 'error', text: describeActuarialError(err, 'The scenario could not be loaded.') });
    }
  }

  protected async remove(s: ScenarioSummary): Promise<void> {
    if (!window.confirm(`Supprimer le scénario “${s.name}”?`)) return;
    try {
      await this.api.deleteScenario(s.id);
      if (this.destroyed) return;
      this.message.set({ tone: 'ok', text: `« ${s.name} » supprimé.` });
      await this.refresh();
    } catch (err) {
      if (!this.destroyed) this.message.set({ tone: 'error', text: describeActuarialError(err, 'The scenario could not be deleted.') });
    }
  }
}

/** /actuarial/pricing: apps/web/src/components/actuarial/PricingStudio.tsx */
@Component({
  selector: 'mtr-pricing-studio-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    PageHeadingComponent,
    ...WORKSPACE_PRIMITIVES,
    ActuarialTabsComponent,
    EstimateNoteComponent,
    AssumptionsFormComponent,
    PremiumKpisComponent,
    PremiumBuildUpComponent,
    LossDistributionPanelComponent,
    FrequencyPanelComponent,
    SeverityPanelComponent,
    PricingSensitivityPanelComponent,
    PricingFormulaPanelComponent,
    ScenariosPanelComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './pricing-studio.page.html',
})
export class PricingStudioPage {
  private readonly api = inject(ActuarialApi);
  private destroyed = false;
  private controller: AbortController | null = null;

  protected readonly copy = FR.actuarial;
  protected readonly presets = signal<ActuarialPreset[] | null>(null);
  protected readonly presetId = signal('');
  protected readonly form = signal<AssumptionForm | null>(null);
  protected readonly result = signal<PricingResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly validation = computed(() => {
    const form = this.form();
    return form ? validateForm(form) : null;
  });
  protected readonly hasErrors = computed(() => Object.keys(this.validation()?.errors ?? {}).length > 0);

  constructor() {
    void this.loadPresets();

    effect((onCleanup) => {
      const assumptions = this.validation()?.assumptions;
      if (!assumptions) return;
      const timer = window.setTimeout(() => this.price(assumptions), DEBOUNCE_MS);
      onCleanup(() => window.clearTimeout(timer));
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.controller?.abort();
    });
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

  private price(assumptions: PricingAssumptions): void {
    this.controller?.abort();
    const current = new AbortController();
    this.controller = current;
    this.busy.set(true);
    this.api
      .price(assumptions, { signal: current.signal })
      .then((res) => {
        if (current.signal.aborted) return;
        this.result.set(res);
        this.error.set(null);
      })
      .catch((err: unknown) => {
        if (current.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        this.error.set(describeActuarialError(err, "La prime n'a pas pu être calculée. Réessayez."));
      })
      .finally(() => {
        if (!current.signal.aborted) this.busy.set(false);
      });
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

  protected loadScenario(form: AssumptionForm): void {
    this.form.set(form);
    this.presetId.set('');
  }
}
