import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { describeApiError, hasErrorCode } from '../../core/api/errors';
import { ApiError, isLoginSuccess, isMfaRequired } from '../../core/api/types';
import { AuthService } from '../../core/auth/auth.service';
import { sanitizeReturnTo } from '../../core/auth/return-to';
import { validateLogin, validateMfaCode, type FieldErrors, type LoginValues } from '../../core/validation/validators';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

@Component({
  selector: 'mtr-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent, FormErrorComponent, FormSuccessComponent],
  host: { style: 'display: contents' },
  templateUrl: './login.page.html',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly returnTo = sanitizeReturnTo(inject(ActivatedRoute).snapshot.queryParamMap.get('returnTo'));

  protected readonly status = this.auth.status;
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);
  protected readonly unverifiedEmail = signal<string | null>(null);
  protected readonly mfaToken = signal<string | null>(null);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly passwordVisible = signal(false);
  private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('passwordInput');
  protected readonly loginErrors = signal<FieldErrors<keyof LoginValues>>({});
  protected readonly loginSubmitting = signal(false);
  private loginSubmitted = false;

  protected readonly code = signal('');
  protected readonly codeError = signal<string | undefined>(undefined);
  protected readonly mfaSubmitting = signal(false);
  private mfaSubmitted = false;

  constructor() {
    effect(() => {
      if (this.status() === 'authenticated' && !this.mfaToken()) {
        void this.router.navigateByUrl(this.returnTo, { replaceUrl: true });
      }
    });
  }

  protected resendHref(email: string): string {
    return `/resend-verification?email=${encodeURIComponent(email)}`;
  }

  protected onEmailInput(value: string): void {
    this.email.set(value);
    if (this.loginSubmitted) this.revalidate('email');
  }

  protected onPasswordInput(value: string): void {
    this.password.set(value);
    if (this.loginSubmitted) this.revalidate('password');
  }

  private revalidate(field: keyof LoginValues): void {
    const { errors } = validateLogin({ email: this.email(), password: this.password() });
    this.loginErrors.update((current) => ({ ...current, [field]: errors[field] }));
  }

  protected async onLogin(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loginSubmitting()) return;
    this.loginSubmitted = true;
    const { values, errors } = validateLogin({ email: this.email(), password: this.password() });
    this.loginErrors.set(errors);
    if (errors.email || errors.password) return;

    this.error.set(null);
    this.info.set(null);
    this.unverifiedEmail.set(null);
    this.loginSubmitting.set(true);
    try {
      const result = await this.auth.login(values);
      if (isLoginSuccess(result)) {
        await this.router.navigateByUrl(this.returnTo, { replaceUrl: true });
        return;
      }
      if (isMfaRequired(result)) {
        this.mfaToken.set(result.mfaChallengeToken);
        this.info.set('Saisissez votre code d\'authentification ou un code de récupération pour terminer la connexion.');
      }
    } catch (err) {
      this.password.set('');
      // The [value] binding cannot see a change when the last rendered value was already ''.
      const input = this.passwordInput()?.nativeElement;
      if (input) input.value = '';
      this.loginErrors.update((current) => ({ ...current, password: undefined }));
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        this.unverifiedEmail.set(values.email);
        this.info.set('Votre courriel n\'est pas encore vérifié. Renvoyez un lien de vérification pour continuer.');
        return;
      }
      this.error.set(describeApiError(err, 'Échec de la connexion.'));
    } finally {
      this.loginSubmitting.set(false);
    }
  }

  protected onCodeInput(value: string): void {
    this.code.set(value);
    if (this.mfaSubmitted) this.codeError.set(validateMfaCode(value).error);
  }

  private resetMfaForm(): void {
    this.code.set('');
    this.codeError.set(undefined);
    this.mfaSubmitted = false;
  }

  protected backToPassword(): void {
    this.mfaToken.set(null);
    this.info.set(null);
    this.resetMfaForm();
  }

  protected async onMfa(event: Event): Promise<void> {
    event.preventDefault();
    if (this.mfaSubmitting()) return;
    this.mfaSubmitted = true;
    const { code, error } = validateMfaCode(this.code());
    this.codeError.set(error);
    if (error) return;
    const token = this.mfaToken();
    if (!token) return;

    this.error.set(null);
    this.mfaSubmitting.set(true);
    try {
      await this.auth.completeMfa(token, code);
      await this.router.navigateByUrl(this.returnTo, { replaceUrl: true });
    } catch (err) {
      // Each challenge allows one attempt; any failure means starting sign-in again.
      this.mfaToken.set(null);
      this.info.set(null);
      this.resetMfaForm();
      this.error.set(
        hasErrorCode(err, 'MFA_INVALID', 'TOKEN_INVALID')
          ? 'Ce code n\'a pas été accepté, ou la tentative de connexion a expiré. Reconnectez-vous pour obtenir une nouvelle étape de vérification.'
          : describeApiError(err, 'Échec de la vérification. Reconnectez-vous.'),
      );
    } finally {
      this.mfaSubmitting.set(false);
    }
  }
}
