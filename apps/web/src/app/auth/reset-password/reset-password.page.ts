import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthApi } from '../../core/api/auth-api';
import { describeApiError } from '../../core/api/errors';
import { takeUrlToken } from '../../core/auth/url-token';
import { FormModel } from '../../core/forms/form-model';
import { PASSWORD_HINT, validateResetPassword } from '../../core/validation/validators';
import { PasswordFieldComponent } from '../../shared/fields/password-field.component';
import { PasswordStrengthHintComponent } from '../../shared/fields/password-strength-hint.component';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

@Component({
  selector: 'mtr-reset-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    AuthLayoutComponent,
    FormErrorComponent,
    FormSuccessComponent,
    PasswordFieldComponent,
    PasswordStrengthHintComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './reset-password.page.html',
})
export class ResetPasswordPage {
  private readonly api = inject(AuthApi);

  protected readonly passwordHint = PASSWORD_HINT;
  protected readonly token = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly confirmedHandoff = signal(false);
  protected readonly form = new FormModel({ password: '', confirmPassword: '' }, validateResetPassword, {
    password: 'password',
    confirmPassword: 'confirmPassword',
  });

  constructor() {
    takeUrlToken((token) => this.token.set(token));
  }

  protected onSubmit(event: Event): Promise<void> {
    return this.form.submit(event, async (values) => {
      const token = this.token();
      if (!token) {
        this.error.set('Jeton de réinitialisation manquant. Rouvrez le lien reçu par courriel.');
        return;
      }
      this.error.set(null);
      this.success.set(null);
      try {
        const res = await this.api.resetPassword({
          token,
          password: values.password,
          passwordConfirmation: values.confirmPassword ?? values.password,
        });
        this.success.set(res.message || 'Mot de passe mis à jour. Vous pouvez vous connecter avec le nouveau mot de passe.');
        this.token.set(null);
      } catch (err) {
        this.error.set(describeApiError(err, 'Échec de la réinitialisation. Le lien est peut-être expiré.'));
      }
    });
  }
}
