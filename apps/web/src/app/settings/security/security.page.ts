import { ChangeDetectionStrategy, Component, afterRenderEffect, computed, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthApi } from '../../core/api/auth-api';
import { describeApiError } from '../../core/api/errors';
import { MfaApi } from '../../core/api/mfa-api';
import { SessionsApi } from '../../core/api/sessions-api';
import { AuthService } from '../../core/auth/auth.service';
import { FormModel } from '../../core/forms/form-model';
import { StepUp } from '../../core/forms/step-up';
import { PASSWORD_HINT, validateChangePassword, validateEmailChange } from '../../core/validation/validators';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { FormFieldComponent } from '../../shared/fields/form-field.component';
import { PasswordFieldComponent } from '../../shared/fields/password-field.component';
import { StepUpFieldsComponent } from '../../shared/fields/step-up-fields.component';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';
import { MfaEnrollmentComponent } from './mfa-enrollment.component';

type Dialog = 'disableMfa' | 'deactivate' | 'delete' | null;

const TOTP = /^\d{6}$/;
const TOTP_MESSAGE = 'Saisissez le code à 6 chiffres de votre application d\'authentification';

@Component({
  selector: 'mtr-security-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormErrorComponent,
    FormSuccessComponent,
    FormFieldComponent,
    PasswordFieldComponent,
    StepUpFieldsComponent,
    ConfirmDialogComponent,
    MfaEnrollmentComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './security.page.html',
})
export class SecurityPage {
  private readonly auth = inject(AuthService);
  private readonly authApi = inject(AuthApi);
  private readonly mfaApi = inject(MfaApi);
  private readonly sessionsApi = inject(SessionsApi);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly passwordHint = PASSWORD_HINT;
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly dialog = signal<Dialog>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly busyDialog = signal(false);
  protected readonly deleteConfirmation = signal('');
  protected readonly sessionCount = signal<number | null>(null);
  protected readonly adminMfaRequired = signal(false);
  protected readonly mfaEnabled = computed(() => !!this.user()?.mfaEnabled);
  protected readonly stepUp = new StepUp(this.mfaEnabled);

  protected readonly passwordForm = new FormModel(
    { currentPassword: '', newPassword: '', confirmPassword: '', totpCode: '' },
    validateChangePassword,
    {
      currentPassword: 'currentPassword',
      newPassword: 'newPassword',
      confirmPassword: 'confirmPassword',
      totpCode: 'changePasswordTotp',
    },
  );
  protected readonly emailForm = new FormModel({ newEmail: '', password: '', totpCode: '' }, validateEmailChange, {
    newEmail: 'newEmail',
    password: 'emailPassword',
    totpCode: 'emailTotp',
  });

  protected readonly sessionSummary = computed(() => {
    const count = this.sessionCount();
    return count === null
      ? 'Chargement des sessions actives…'
      : count === 1
        ? '1 session active.'
        : `${count} sessions actives.`;
  });
  protected readonly lastSignIn = computed(() => {
    const at = this.user()?.lastLoginAt;
    return at ? `Dernière connexion le ${new Date(at).toLocaleString('fr-FR')}.` : null;
  });
  protected readonly refreshUser = () => this.auth.refreshUser();

  constructor() {
    // After render, like the page's useEffect, which React runs after the MFA card's own status request.
    afterRenderEffect((onCleanup) => {
      this.mfaEnabled();
      let cancelled = false;
      onCleanup(() => (cancelled = true));
      untracked(() => {
        this.sessionsApi
          .listSessions()
          .then((s) => !cancelled && this.sessionCount.set(s.length))
          .catch(() => undefined);
        this.authApi
          .fetchDashboardContext()
          .then((ctx) => !cancelled && this.adminMfaRequired.set(ctx.requiredActions.includes('ENROLL_MFA_FOR_ADMIN')))
          .catch(() => undefined);
      });
    });
  }

  protected openDialog(next: Dialog): void {
    this.stepUp.reset();
    this.deleteConfirmation.set('');
    this.dialogError.set(null);
    this.dialog.set(next);
  }

  protected closeDialog(): void {
    if (this.busyDialog()) return;
    this.stepUp.reset();
    this.dialog.set(null);
  }

  protected onChangePassword(event: Event): Promise<void> {
    return this.passwordForm.submit(event, async (values) => {
      this.error.set(null);
      this.success.set(null);
      const mfaEnabled = this.mfaEnabled();
      if (mfaEnabled && !TOTP.test(values.totpCode ?? '')) {
        this.passwordForm.setError('totpCode', TOTP_MESSAGE);
        return;
      }
      try {
        const result = await this.authApi.changePassword({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
          newPasswordConfirmation: values.confirmPassword,
          ...(mfaEnabled ? { totpCode: values.totpCode } : {}),
        });
        this.passwordForm.reset();
        this.auth.setSession(result.accessToken, result.user);
        this.success.set(
          'Mot de passe modifié. Tous les autres appareils ont été déconnectés ; cet appareil continue avec une nouvelle session.',
        );
      } catch (err) {
        this.passwordForm.resetField('currentPassword');
        this.passwordForm.resetField('totpCode');
        this.error.set(describeApiError(err, 'Échec du changement de mot de passe.'));
      }
    });
  }

  protected onEmailChange(event: Event): Promise<void> {
    return this.emailForm.submit(event, async (values) => {
      this.error.set(null);
      this.success.set(null);
      const mfaEnabled = this.mfaEnabled();
      if (mfaEnabled && !TOTP.test(values.totpCode ?? '')) {
        this.emailForm.setError('totpCode', TOTP_MESSAGE);
        return;
      }
      try {
        const res = await this.authApi.requestEmailChange({
          newEmail: values.newEmail,
          password: values.password,
          ...(mfaEnabled ? { totpCode: values.totpCode } : {}),
        });
        this.emailForm.reset();
        this.success.set(
          res.message ||
            'Si la nouvelle adresse peut être utilisée, un lien de confirmation lui a été envoyé. Votre adresse actuelle a été notifiée.',
        );
      } catch (err) {
        this.emailForm.resetField('password');
        this.emailForm.resetField('totpCode');
        this.error.set(describeApiError(err, 'Échec de la demande de changement de courriel.'));
      }
    });
  }

  protected async runDialogAction(): Promise<void> {
    const dialog = this.dialog();
    const problem = this.stepUp.validate({ allowRecoveryCode: dialog === 'disableMfa' });
    if (problem) {
      this.dialogError.set(problem);
      return;
    }
    if (dialog === 'delete' && this.deleteConfirmation() !== 'DELETE') {
      this.dialogError.set('Saisissez DELETE pour confirmer.');
      return;
    }
    this.busyDialog.set(true);
    this.dialogError.set(null);
    try {
      if (dialog === 'disableMfa') {
        await this.mfaApi.disableMfa(this.stepUp.payload());
        this.dialog.set(null);
        this.stepUp.reset();
        this.success.set('La vérification en deux étapes est désactivée. Les autres appareils ont été déconnectés.');
        await this.auth.refreshUser();
        return;
      }
      const { password, totpCode } = this.stepUp.payload();
      if (dialog === 'deactivate') {
        await this.authApi.deactivateAccount({ password, totpCode, confirmation: 'DEACTIVATE' });
      } else if (dialog === 'delete') {
        await this.authApi.deleteAccount({ password, totpCode, confirmation: 'DELETE' });
      }
      this.dialog.set(null);
      this.auth.endLocalSession();
      void this.router.navigateByUrl('/login', { replaceUrl: true });
    } catch (err) {
      this.stepUp.patch({ password: '', totpCode: '', recoveryCode: '' });
      this.dialogError.set(describeApiError(err, 'L\'action n\'a pas pu être terminée.'));
    } finally {
      this.busyDialog.set(false);
    }
  }
}
