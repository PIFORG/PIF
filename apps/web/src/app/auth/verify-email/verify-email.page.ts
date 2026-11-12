import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthApi } from '../../core/api/auth-api';
import { describeApiError } from '../../core/api/errors';
import { takeUrlToken } from '../../core/auth/url-token';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

@Component({
  selector: 'mtr-verify-email-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent, FormErrorComponent, FormSuccessComponent],
  host: { style: 'display: contents' },
  templateUrl: './verify-email.page.html',
})
export class VerifyEmailPage {
  private readonly api = inject(AuthApi);

  protected readonly token = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    takeUrlToken((token) => this.token.set(token));
  }

  protected async confirm(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.error.set('Jeton de vérification manquant. Rouvrez le lien reçu par courriel.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.success.set(null);
    try {
      const res = await this.api.verifyEmail(token);
      this.success.set(res.message || 'Courriel vérifié. Vous pouvez vous connecter.');
      this.token.set(null);
    } catch (err) {
      this.error.set(describeApiError(err, 'Échec de la vérification. Le lien est peut-être expiré.'));
    } finally {
      this.busy.set(false);
    }
  }
}
