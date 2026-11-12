import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthApi } from '../../core/api/auth-api';
import { describeApiError, hasErrorCode } from '../../core/api/errors';
import { AuthService } from '../../core/auth/auth.service';
import { takeUrlToken } from '../../core/auth/url-token';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

@Component({
  selector: 'mtr-confirm-email-change-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent, FormErrorComponent, FormSuccessComponent],
  host: { style: 'display: contents' },
  templateUrl: './confirm-email-change.page.html',
})
export class ConfirmEmailChangePage {
  private readonly api = inject(AuthApi);
  private readonly auth = inject(AuthService);

  protected readonly token = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    takeUrlToken((token) => this.token.set(token));
  }

  protected async confirm(): Promise<void> {
    const token = this.token();
    if (!token) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.confirmEmailChange(token);
      this.token.set(null);
      // The server signed out every session; drop this tab's copy as well.
      if (this.auth.status() === 'authenticated') this.auth.endLocalSession();
      this.success.set('Votre adresse courriel a été modifiée. Reconnectez-vous avec la nouvelle adresse.');
    } catch (err) {
      this.error.set(
        hasErrorCode(err, 'TOKEN_INVALID', 'EMAIL_CHANGE_FAILED')
          ? 'Ce lien est invalide, expiré ou déjà utilisé, ou l\'adresse n\'est plus disponible. Demandez un nouveau changement de courriel depuis vos paramètres de sécurité.'
          : describeApiError(err, 'Le changement de courriel n\'a pas pu être confirmé.'),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
