import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthApi } from '../../core/api/auth-api';
import { describeApiError } from '../../core/api/errors';
import { createCooldown } from '../../core/forms/cooldown';
import { FormModel } from '../../core/forms/form-model';
import { validateEmailOnly } from '../../core/validation/validators';
import { FormFieldComponent } from '../../shared/fields/form-field.component';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

@Component({
  selector: 'mtr-forgot-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent, FormErrorComponent, FormSuccessComponent, FormFieldComponent],
  host: { style: 'display: contents' },
  templateUrl: './forgot-password.page.html',
})
export class ForgotPasswordPage {
  private readonly api = inject(AuthApi);

  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly form = new FormModel({ email: '' }, validateEmailOnly, { email: 'email' });
  protected readonly cooldown = createCooldown(60);

  protected onSubmit(event: Event): Promise<void> {
    return this.form.submit(event, async (values) => {
      this.error.set(null);
      this.success.set(null);
      try {
        const res = await this.api.forgotPassword(values.email);
        this.success.set(
          res.message ||
            'Si un compte existe pour cette adresse, des instructions de réinitialisation ont été envoyées.',
        );
        this.cooldown.start();
      } catch (err) {
        this.error.set(describeApiError(err, 'Impossible de démarrer la réinitialisation du mot de passe.'));
      }
    });
  }
}
