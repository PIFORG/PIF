import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { StepUpValues } from '../../core/forms/step-up';
import { FormFieldComponent } from './form-field.component';
import { PasswordFieldComponent } from './password-field.component';

const TOTP_PATTERN = '\\d{6}';

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

/** Counterpart of apps/web StepUpFields: password, plus an authenticator or recovery code when MFA is on. */
@Component({
  selector: 'mtr-step-up-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormFieldComponent, PasswordFieldComponent],
  host: { style: 'display: contents' },
  template: `
    <mtr-password-field
      [fieldId]="idPrefix() + '-password'"
      [label]="passwordLabel()"
      autocomplete="current-password"
      [value]="values().password"
      (valueChange)="patch({ password: $event })"
      [required]="true"
    />
    @if (mfaEnabled() && !values().useRecoveryCode) {
      <mtr-form-field
        [fieldId]="idPrefix() + '-totp'"
        label="Code d'authentification"
        inputmode="numeric"
        autocomplete="one-time-code"
        [pattern]="totpPattern"
        [maxlength]="6"
        [value]="values().totpCode"
        [normalize]="digitsOnly"
        (valueChange)="patch({ totpCode: $event })"
        [required]="true"
      />
    }
    @if (mfaEnabled() && values().useRecoveryCode) {
      <mtr-form-field
        [fieldId]="idPrefix() + '-recovery'"
        label="Code de récupération"
        autocomplete="off"
        spellcheck="false"
        [value]="values().recoveryCode"
        (valueChange)="patch({ recoveryCode: $event })"
        [required]="true"
      />
    }
    @if (mfaEnabled() && allowRecoveryCode()) {
      <button type="button" class="btn btn-ghost" (click)="toggleRecovery()">
        {{
          values().useRecoveryCode
            ? "Utiliser plutôt le code d'authentification"
            : "Appareil perdu ? Utiliser un code de récupération"
        }}
      </button>
    }
  `,
})
export class StepUpFieldsComponent {
  readonly idPrefix = input.required<string>();
  readonly mfaEnabled = input.required<boolean>();
  readonly values = input.required<StepUpValues>();
  readonly allowRecoveryCode = input(false);
  readonly passwordLabel = input('Votre mot de passe');
  /** Only the edited keys, so several edits in one task (e.g. autofill) do not overwrite each other. */
  readonly changed = output<Partial<StepUpValues>>();

  protected readonly totpPattern = TOTP_PATTERN;
  protected readonly digitsOnly = digitsOnly;

  protected patch(change: Partial<StepUpValues>): void {
    this.changed.emit(change);
  }

  protected toggleRecovery(): void {
    this.patch({ useRecoveryCode: !this.values().useRecoveryCode, totpCode: '', recoveryCode: '' });
  }
}
