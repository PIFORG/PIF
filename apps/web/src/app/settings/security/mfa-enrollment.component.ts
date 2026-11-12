import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { describeApiError, hasErrorCode } from '../../core/api/errors';
import { MfaApi } from '../../core/api/mfa-api';
import type { MfaStatusResponse } from '../../core/api/types';
import { FormModel } from '../../core/forms/form-model';
import { StepUp } from '../../core/forms/step-up';
import { validateMfaEnableCode, validateMfaSetup } from '../../core/validation/validators';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { FormFieldComponent } from '../../shared/fields/form-field.component';
import { PasswordFieldComponent } from '../../shared/fields/password-field.component';
import { StepUpFieldsComponent } from '../../shared/fields/step-up-fields.component';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';

/**
 * Counterpart of apps/web MfaEnrollment. Its CSS module has no `codes`/`otpauth` rules, so the recovery-code
 * region and the authenticator link carry no class there either.
 */
@Component({
  selector: 'mtr-mfa-enrollment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormErrorComponent,
    FormSuccessComponent,
    FormFieldComponent,
    PasswordFieldComponent,
    StepUpFieldsComponent,
    ConfirmDialogComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './mfa-enrollment.component.html',
})
export class MfaEnrollmentComponent {
  private readonly api = inject(MfaApi);

  readonly enabled = input.required<boolean>();
  readonly changed = input.required<() => unknown>();

  protected readonly enrolling = signal(false);
  protected readonly secret = signal<string | null>(null);
  protected readonly otpauthUrl = signal<string | null>(null);
  protected readonly expiresInMinutes = signal<number | null>(null);
  protected readonly recoveryCodes = signal<string[] | null>(null);
  protected readonly status = signal<MfaStatusResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly regenOpen = signal(false);
  protected readonly regenError = signal<string | null>(null);
  protected readonly regenStepUp = new StepUp(() => true);
  protected readonly remaining = computed(() => (this.enabled() ? (this.status()?.remainingRecoveryCodes ?? null) : null));
  protected readonly remainingText = computed(() => {
    const count = this.remaining();
    return count === null
      ? null
      : count === 1
        ? ' · 1 code de récupération inutilisé'
        : ` · ${count} codes de récupération inutilisés`;
  });

  protected readonly setupForm = new FormModel({ password: '' }, validateMfaSetup, { password: 'mfaSetupPassword' });
  protected readonly confirmForm = new FormModel({ code: '' }, validateMfaEnableCode, { code: 'mfaEnableCode' });

  constructor() {
    effect(() => {
      if (this.enabled()) void untracked(() => this.loadStatus());
      else this.status.set(null);
    });
  }

  private async loadStatus(): Promise<void> {
    try {
      this.status.set(await this.api.mfaStatus());
    } catch {
      this.status.set(null);
    }
  }

  protected cancelEnrollment(): void {
    this.enrolling.set(false);
    this.secret.set(null);
    this.otpauthUrl.set(null);
    this.expiresInMinutes.set(null);
    this.confirmForm.reset();
  }

  protected startEnroll(event: Event): Promise<void> {
    return this.setupForm.submit(event, async (values) => {
      this.error.set(null);
      this.success.set(null);
      this.busy.set(true);
      try {
        const res = await this.api.setupMfa({ password: values.password });
        this.secret.set(res.secret);
        this.otpauthUrl.set(res.otpauth);
        this.expiresInMinutes.set(res.expiresInMinutes ?? null);
        this.enrolling.set(true);
        this.setupForm.reset();
        this.confirmForm.reset();
      } catch (err) {
        this.setupForm.resetField('password');
        this.error.set(describeApiError(err, 'Impossible de démarrer la configuration de la vérification en deux étapes.'));
      } finally {
        this.busy.set(false);
      }
    });
  }

  protected onConfirm(event: Event): Promise<void> {
    return this.confirmForm.submit(event, async (values) => {
      this.error.set(null);
      this.busy.set(true);
      try {
        const res = await this.api.enableMfa(values.code);
        this.recoveryCodes.set(res.recoveryCodes);
        this.success.set('La vérification en deux étapes est maintenant activée.');
        this.cancelEnrollment();
        await this.changed()();
      } catch (err) {
        if (hasErrorCode(err, 'MFA_SETUP_EXPIRED', 'MFA_SETUP_REQUIRED')) this.cancelEnrollment();
        this.error.set(
          describeApiError(err, 'Ce code n\'a pas été accepté. Vérifiez l\'heure de votre appareil et réessayez.'),
        );
      } finally {
        this.busy.set(false);
      }
    });
  }

  protected openRegenerate(): void {
    this.regenError.set(null);
    this.regenOpen.set(true);
  }

  protected cancelRegenerate(): void {
    this.regenOpen.set(false);
    this.regenStepUp.reset();
  }

  protected async regenerate(): Promise<void> {
    const problem = this.regenStepUp.validate();
    if (problem) {
      this.regenError.set(problem);
      return;
    }
    this.busy.set(true);
    this.regenError.set(null);
    try {
      const { password, totpCode } = this.regenStepUp.payload();
      const res = await this.api.regenerateRecoveryCodes({ password, totpCode });
      this.recoveryCodes.set(res.recoveryCodes);
      this.regenOpen.set(false);
      this.regenStepUp.reset();
      this.success.set('Nouveaux codes de récupération générés.');
      await this.loadStatus();
    } catch (err) {
      this.regenStepUp.patch({ password: '', totpCode: '' });
      this.regenError.set(describeApiError(err, 'Impossible de générer de nouveaux codes de récupération.'));
    } finally {
      this.busy.set(false);
    }
  }
}
