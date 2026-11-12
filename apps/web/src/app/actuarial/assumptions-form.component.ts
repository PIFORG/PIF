import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ActuarialPreset } from '../core/api/actuarial-api';
import { NumberFieldComponent, SegmentedComponent } from './actuarial-parts.components';
import type { AssumptionForm, FormErrors } from './assumption-form';

export interface AssumptionChange {
  key: keyof AssumptionForm;
  value: string;
}

/** apps/web/src/components/actuarial/AssumptionsForm.tsx: portfolio assumptions shared by the pricing studio and the Monte Carlo lab. */
@Component({
  selector: 'form[mtr-assumptions-form]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NumberFieldComponent, SegmentedComponent],
  host: { class: 'ac-form', novalidate: '', 'aria-describedby': 'act-status', '(submit)': '$event.preventDefault()' },
  template: `
    <div class="field">
      <label class="field-label" for="act-preset">Portefeuille d'exemple (fictif)</label>
      <select id="act-preset" class="select" (change)="preset.emit($any($event.target).value)">
        <option value="" [selected]="presetId() === ''">Hypothèses personnalisées</option>
        @for (p of presets(); track p.id) {
          <option [value]="p.id" [selected]="p.id === presetId()">{{ p.name }}</option>
        }
      </select>
      <p class="field-hint">{{ selectedPreset()?.description ?? 'Modifié par vous. Choisissez un exemple pour recommencer.' }}</p>
    </div>

    <fieldset class="ac-fieldset">
      <legend>Portefeuille et fréquence des sinistres</legend>
      <div mtr-segmented label="Modèle de fréquence" [value]="form().frequencyFamily" [options]="frequencyOptions" (changed)="set('frequencyFamily', $event)"></div>
      <div class="ac-fieldRow">
        <div mtr-number-field fieldId="act-policies" label="Polices" [value]="form().policies" [error]="errors().policies" (changed)="set('policies', $event)"></div>
        <div mtr-number-field fieldId="act-years" label="Période de couverture" suffix="ans" [value]="form().years" [error]="errors().years" (changed)="set('years', $event)"></div>
      </div>
      @if (form().frequencyFamily === 'BINOMIAL') {
        <div
          mtr-number-field
          fieldId="act-probabilityPct"
          label="Probabilité annuelle de sinistre"
          hint="Au plus un sinistre par police."
          suffix="%"
          [value]="form().probabilityPct"
          [error]="errors().probabilityPct"
          (changed)="set('probabilityPct', $event)"
        ></div>
      } @else {
        <div
          mtr-number-field
          fieldId="act-intensity"
          label="Sinistres par police-année"
          hint="Plusieurs sinistres par police sont possibles."
          [value]="form().intensity"
          [error]="errors().intensity"
          (changed)="set('intensity', $event)"
        ></div>
      }
    </fieldset>

    <fieldset class="ac-fieldset">
      <legend>Coût du sinistre</legend>
      <div mtr-segmented label="Modèle de sévérité" [value]="form().severityFamily" [options]="severityOptions" (changed)="set('severityFamily', $event)"></div>
      <div class="ac-fieldRow">
        <div mtr-number-field fieldId="act-meanCost" label="Coût moyen du sinistre" suffix="DT" [value]="form().meanCost" [error]="errors().meanCost" (changed)="set('meanCost', $event)"></div>
        @if (form().severityFamily !== 'DETERMINISTIC') {
          <div mtr-number-field fieldId="act-cv" label="Coefficient de variation" hint="écart-type ÷ moyenne" [value]="form().cv" [error]="errors().cv" (changed)="set('cv', $event)"></div>
        }
      </div>
      <div class="ac-fieldRow">
        <div
          mtr-number-field
          fieldId="act-inflationPct"
          label="Inflation des sinistres"
          hint="Par an"
          suffix="%"
          [value]="form().inflationPct"
          [error]="errors().inflationPct"
          (changed)="set('inflationPct', $event)"
        ></div>
        <div
          mtr-number-field
          fieldId="act-inflationYears"
          label="Période de tendance"
          suffix="ans"
          [value]="form().inflationYears"
          [error]="errors().inflationYears"
          (changed)="set('inflationYears', $event)"
        ></div>
      </div>
    </fieldset>

    <fieldset class="ac-fieldset">
      <legend>Frais et marge</legend>
      <div class="ac-fieldRow">
        <div
          mtr-number-field
          fieldId="act-fixedExpenses"
          label="Frais fixes"
          hint="Portefeuille entier"
          suffix="DT"
          [value]="form().fixedExpenses"
          [error]="errors().fixedExpenses"
          (changed)="set('fixedExpenses', $event)"
        ></div>
        <div
          mtr-number-field
          fieldId="act-perPolicyExpenses"
          label="Par police"
          suffix="DT"
          [value]="form().perPolicyExpenses"
          [error]="errors().perPolicyExpenses"
          (changed)="set('perPolicyExpenses', $event)"
        ></div>
      </div>
      <div class="ac-fieldRow">
        <div
          mtr-number-field
          fieldId="act-variablePct"
          label="Frais variables"
          hint="Part de la prime brute"
          suffix="%"
          [value]="form().variablePct"
          [error]="errors().variablePct"
          (changed)="set('variablePct', $event)"
        ></div>
        <div
          mtr-number-field
          fieldId="act-marginPct"
          label="Marge bénéficiaire"
          hint="Part de la prime brute"
          suffix="%"
          [value]="form().marginPct"
          [error]="errors().marginPct"
          (changed)="set('marginPct', $event)"
        ></div>
      </div>
    </fieldset>

    <fieldset class="ac-fieldset">
      <legend>Chargement de risque</legend>
      <div class="field">
        <label class="field-label" for="act-loading-method">Principe</label>
        <select id="act-loading-method" class="select" (change)="set('loadingMethod', $any($event.target).value)">
          <option value="EXPECTED_VALUE" [selected]="form().loadingMethod === 'EXPECTED_VALUE'">Espérance : θ × E[S]</option>
          <option value="STANDARD_DEVIATION" [selected]="form().loadingMethod === 'STANDARD_DEVIATION'">Écart-type : k × σ(S)</option>
          <option value="NONE" [selected]="form().loadingMethod === 'NONE'">Aucun chargement</option>
        </select>
      </div>
      @if (form().loadingMethod === 'EXPECTED_VALUE') {
        <div
          mtr-number-field
          fieldId="act-loadingParameter"
          label="Chargement θ"
          hint="Pourcentage des sinistres attendus"
          suffix="%"
          [value]="form().loadingParameter"
          [error]="errors().loadingParameter"
          (changed)="set('loadingParameter', $event)"
        ></div>
      }
      @if (form().loadingMethod === 'STANDARD_DEVIATION') {
        <div
          mtr-number-field
          fieldId="act-loadingParameter"
          label="Chargement k"
          hint="Multiple de l'écart-type des sinistres totaux"
          [value]="form().loadingParameter"
          [error]="errors().loadingParameter"
          (changed)="set('loadingParameter', $event)"
        ></div>
      }
    </fieldset>

    <p id="act-status" class="ac-status" role="status" aria-live="polite"><ng-content /></p>
  `,
})
export class AssumptionsFormComponent {
  readonly form = input.required<AssumptionForm>();
  readonly errors = input.required<FormErrors>();
  readonly presets = input.required<ActuarialPreset[]>();
  readonly presetId = input.required<string>();
  readonly preset = output<string>();
  readonly changed = output<AssumptionChange>();

  protected readonly frequencyOptions = [
    { value: 'BINOMIAL', label: 'Binomiale' },
    { value: 'POISSON', label: 'Poisson' },
  ] as const;
  protected readonly severityOptions = [
    { value: 'DETERMINISTIC', label: 'Fixe' },
    { value: 'GAMMA', label: 'Gamma' },
    { value: 'LOGNORMAL', label: 'Log-normale' },
  ] as const;
  protected readonly selectedPreset = computed(() => this.presets().find((p) => p.id === this.presetId()));

  protected set(key: keyof AssumptionForm, value: string): void {
    this.changed.emit({ key, value });
  }
}
