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
      <label class="field-label" for="act-preset">Example portfolio (fictional)</label>
      <select id="act-preset" class="select" (change)="preset.emit($any($event.target).value)">
        <option value="" [selected]="presetId() === ''">Custom assumptions</option>
        @for (p of presets(); track p.id) {
          <option [value]="p.id" [selected]="p.id === presetId()">{{ p.name }}</option>
        }
      </select>
      <p class="field-hint">{{ selectedPreset()?.description ?? 'Edited by you. Pick an example to start again.' }}</p>
    </div>

    <fieldset class="ac-fieldset">
      <legend>Portfolio and claim frequency</legend>
      <div mtr-segmented label="Frequency model" [value]="form().frequencyFamily" [options]="frequencyOptions" (changed)="set('frequencyFamily', $event)"></div>
      <div class="ac-fieldRow">
        <div mtr-number-field fieldId="act-policies" label="Policies" [value]="form().policies" [error]="errors().policies" (changed)="set('policies', $event)"></div>
        <div mtr-number-field fieldId="act-years" label="Cover period" suffix="years" [value]="form().years" [error]="errors().years" (changed)="set('years', $event)"></div>
      </div>
      @if (form().frequencyFamily === 'BINOMIAL') {
        <div
          mtr-number-field
          fieldId="act-probabilityPct"
          label="Annual claim probability"
          hint="At most one claim per policy."
          suffix="%"
          [value]="form().probabilityPct"
          [error]="errors().probabilityPct"
          (changed)="set('probabilityPct', $event)"
        ></div>
      } @else {
        <div
          mtr-number-field
          fieldId="act-intensity"
          label="Claims per policy-year"
          hint="Several claims per policy are possible."
          [value]="form().intensity"
          [error]="errors().intensity"
          (changed)="set('intensity', $event)"
        ></div>
      }
    </fieldset>

    <fieldset class="ac-fieldset">
      <legend>Claim cost</legend>
      <div mtr-segmented label="Severity model" [value]="form().severityFamily" [options]="severityOptions" (changed)="set('severityFamily', $event)"></div>
      <div class="ac-fieldRow">
        <div mtr-number-field fieldId="act-meanCost" label="Average claim cost" suffix="DT" [value]="form().meanCost" [error]="errors().meanCost" (changed)="set('meanCost', $event)"></div>
        @if (form().severityFamily !== 'DETERMINISTIC') {
          <div mtr-number-field fieldId="act-cv" label="Coefficient of variation" hint="sd ÷ mean" [value]="form().cv" [error]="errors().cv" (changed)="set('cv', $event)"></div>
        }
      </div>
      <div class="ac-fieldRow">
        <div
          mtr-number-field
          fieldId="act-inflationPct"
          label="Claim inflation"
          hint="Per year"
          suffix="%"
          [value]="form().inflationPct"
          [error]="errors().inflationPct"
          (changed)="set('inflationPct', $event)"
        ></div>
        <div
          mtr-number-field
          fieldId="act-inflationYears"
          label="Trend period"
          suffix="years"
          [value]="form().inflationYears"
          [error]="errors().inflationYears"
          (changed)="set('inflationYears', $event)"
        ></div>
      </div>
    </fieldset>

    <fieldset class="ac-fieldset">
      <legend>Expenses and margin</legend>
      <div class="ac-fieldRow">
        <div
          mtr-number-field
          fieldId="act-fixedExpenses"
          label="Fixed expenses"
          hint="Whole portfolio"
          suffix="DT"
          [value]="form().fixedExpenses"
          [error]="errors().fixedExpenses"
          (changed)="set('fixedExpenses', $event)"
        ></div>
        <div
          mtr-number-field
          fieldId="act-perPolicyExpenses"
          label="Per policy"
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
          label="Variable expenses"
          hint="Share of gross premium"
          suffix="%"
          [value]="form().variablePct"
          [error]="errors().variablePct"
          (changed)="set('variablePct', $event)"
        ></div>
        <div
          mtr-number-field
          fieldId="act-marginPct"
          label="Profit margin"
          hint="Share of gross premium"
          suffix="%"
          [value]="form().marginPct"
          [error]="errors().marginPct"
          (changed)="set('marginPct', $event)"
        ></div>
      </div>
    </fieldset>

    <fieldset class="ac-fieldset">
      <legend>Risk loading</legend>
      <div class="field">
        <label class="field-label" for="act-loading-method">Principle</label>
        <select id="act-loading-method" class="select" (change)="set('loadingMethod', $any($event.target).value)">
          <option value="EXPECTED_VALUE" [selected]="form().loadingMethod === 'EXPECTED_VALUE'">Expected value: θ × E[S]</option>
          <option value="STANDARD_DEVIATION" [selected]="form().loadingMethod === 'STANDARD_DEVIATION'">Standard deviation: k × sd(S)</option>
          <option value="NONE" [selected]="form().loadingMethod === 'NONE'">No loading</option>
        </select>
      </div>
      @if (form().loadingMethod === 'EXPECTED_VALUE') {
        <div
          mtr-number-field
          fieldId="act-loadingParameter"
          label="Chargement θ"
          hint="Percent of expected claims"
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
          hint="Multiple of the standard deviation of total claims"
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
    { value: 'BINOMIAL', label: 'Binomial' },
    { value: 'POISSON', label: 'Poisson' },
  ] as const;
  protected readonly severityOptions = [
    { value: 'DETERMINISTIC', label: 'Fixed' },
    { value: 'GAMMA', label: 'Gamma' },
    { value: 'LOGNORMAL', label: 'Lognormal' },
  ] as const;
  protected readonly selectedPreset = computed(() => this.presets().find((p) => p.id === this.presetId()));

  protected set(key: keyof AssumptionForm, value: string): void {
    this.changed.emit({ key, value });
  }
}
