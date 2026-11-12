import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { describeApiError } from '../../core/api/errors';
import { SessionsApi } from '../../core/api/sessions-api';
import type { AuthSession } from '../../core/api/types';
import { AuthService } from '../../core/auth/auth.service';
import { StepUp } from '../../core/forms/step-up';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { StepUpFieldsComponent } from '../../shared/fields/step-up-fields.component';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';
import { SessionCardComponent } from './session-card.component';

@Component({
  selector: 'mtr-sessions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormErrorComponent, FormSuccessComponent, SessionCardComponent, ConfirmDialogComponent, StepUpFieldsComponent],
  host: { style: 'display: contents' },
  templateUrl: './sessions.page.html',
})
export class SessionsPage {
  private readonly auth = inject(AuthService);
  private readonly api = inject(SessionsApi);
  private readonly router = inject(Router);

  protected readonly sessions = signal<AuthSession[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly busyId = signal<string | null>(null);
  protected readonly dialog = signal<'others' | 'all' | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly busyDialog = signal(false);
  protected readonly mfaEnabled = computed(() => !!this.auth.user()?.mfaEnabled);
  protected readonly stepUp = new StepUp(this.mfaEnabled);
  protected readonly others = computed(() => this.sessions().filter((s) => !s.current).length);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.sessions.set(await this.api.listSessions());
    } catch (err) {
      this.error.set(describeApiError(err, 'Impossible de charger les sessions.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async onRevoke(id: string): Promise<void> {
    this.busyId.set(id);
    this.error.set(null);
    this.success.set(null);
    try {
      await this.api.revokeSession(id);
      this.success.set('Session déconnectée.');
      await this.load();
    } catch (err) {
      this.error.set(describeApiError(err, 'Impossible de déconnecter cette session.'));
    } finally {
      this.busyId.set(null);
    }
  }

  protected open(next: 'others' | 'all'): void {
    this.stepUp.reset();
    this.dialogError.set(null);
    this.dialog.set(next);
  }

  protected async revokeOthers(): Promise<void> {
    const problem = this.stepUp.validate();
    if (problem) {
      this.dialogError.set(problem);
      return;
    }
    this.busyDialog.set(true);
    this.dialogError.set(null);
    try {
      const { password, totpCode } = this.stepUp.payload();
      await this.api.revokeOtherSessions({ password, totpCode });
      this.success.set('Toutes les autres sessions ont été déconnectées.');
      this.dialog.set(null);
      this.stepUp.reset();
      await this.load();
    } catch (err) {
      this.stepUp.patch({ password: '', totpCode: '' });
      this.dialogError.set(describeApiError(err, 'Impossible de déconnecter les autres sessions.'));
    } finally {
      this.busyDialog.set(false);
    }
  }

  protected async logoutEverywhere(): Promise<void> {
    this.busyDialog.set(true);
    this.dialogError.set(null);
    try {
      await this.api.logoutAll();
      this.dialog.set(null);
      this.auth.endLocalSession();
      void this.router.navigateByUrl('/login', { replaceUrl: true });
    } catch (err) {
      this.dialogError.set(describeApiError(err, 'Impossible de déconnecter partout.'));
    } finally {
      this.busyDialog.set(false);
    }
  }
}
