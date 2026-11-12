import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../core/api/errors';
import { AuthService } from '../../core/auth/auth.service';
import { FormModel } from '../../core/forms/form-model';
import { PASSWORD_HINT, validateRegister } from '../../core/validation/validators';
import { FormFieldComponent } from '../../shared/fields/form-field.component';
import { PasswordFieldComponent } from '../../shared/fields/password-field.component';
import { PasswordStrengthHintComponent } from '../../shared/fields/password-strength-hint.component';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

@Component({
  selector: 'mtr-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    AuthLayoutComponent,
    FormErrorComponent,
    FormSuccessComponent,
    FormFieldComponent,
    PasswordFieldComponent,
    PasswordStrengthHintComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './register.page.html',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly passwordHint = PASSWORD_HINT;
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly form = new FormModel(
    { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' },
    validateRegister,
    { firstName: 'firstName', lastName: 'lastName', email: 'email', password: 'password', confirmPassword: 'confirmPassword' },
  );

  constructor() {
    effect(() => {
      if (this.auth.status() === 'authenticated') {
        void this.router.navigateByUrl('/dashboard', { replaceUrl: true });
      }
    });
  }

  protected onSubmit(event: Event): Promise<void> {
    return this.form.submit(event, async (values) => {
      this.error.set(null);
      this.success.set(null);
      try {
        await this.auth.register({
          email: values.email,
          password: values.password,
          passwordConfirmation: values.confirmPassword,
          firstName: values.firstName,
          lastName: values.lastName,
        });
        this.success.set(
          'Si cette adresse peut être enregistrée, vous recevrez bientôt un message de vérification.',
        );
      } catch (err) {
        this.error.set(describeApiError(err, 'Échec de l\'inscription. Veuillez réessayer.'));
      }
    });
  }
}
