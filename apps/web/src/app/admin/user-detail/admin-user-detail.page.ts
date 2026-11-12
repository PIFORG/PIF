import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AdminApi } from '../../core/api/admin-api';
import { describeApiError } from '../../core/api/errors';
import type { AdminUserDetail, UserRole, UserStatus } from '../../core/api/types';
import { AuthService } from '../../core/auth/auth.service';
import { StepUp } from '../../core/forms/step-up';
import { AccountStatusBadgeComponent } from '../../shared/account-status-badge.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { StepUpFieldsComponent } from '../../shared/fields/step-up-fields.component';
import { FormErrorComponent, FormSuccessComponent } from '../../shared/form-messages.component';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  DEACTIVATED: 'Désactivé',
};

@Component({
  selector: 'mtr-admin-user-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormErrorComponent,
    FormSuccessComponent,
    AccountStatusBadgeComponent,
    ConfirmDialogComponent,
    StepUpFieldsComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './admin-user-detail.page.html',
})
export class AdminUserDetailPage {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  private readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('id') ?? '',
  });
  protected readonly data = signal<AdminUserDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly status = signal<UserStatus>('ACTIVE');
  protected readonly reason = signal('');
  protected readonly role = signal<UserRole>('INVESTOR');
  protected readonly dialog = signal<'status' | 'role' | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly mfaEnabled = computed(() => !!this.auth.user()?.mfaEnabled);
  protected readonly stepUp = new StepUp(this.mfaEnabled);
  protected readonly isSelf = computed(() => this.auth.user()?.id === this.id());
  protected readonly statusLabels = STATUS_LABELS;

  protected readonly user = computed(() => this.data()?.user);
  protected readonly statusUnchanged = computed(() => !!this.user() && this.status() === this.user()!.status);
  protected readonly roleUnchanged = computed(() => !!this.user() && this.role() === this.user()!.role);
  protected readonly securitySummary = computed(() => {
    const data = this.data();
    const sessions = data?.security.activeSessions ?? 0;
    const sessionsLabel = sessions === 1 ? '1 session active' : `${sessions} sessions actives`;
    return `${data?.security.locked ? 'Connexion temporairement verrouillée' : 'Non verrouillé'} · ${sessionsLabel} · vérification en deux étapes ${this.user()?.mfaEnabled ? 'activée' : 'désactivée'}`;
  });

  constructor() {
    effect((onCleanup) => {
      const id = this.id();
      let cancelled = false;
      onCleanup(() => (cancelled = true));
      untracked(async () => {
        this.loading.set(true);
        this.error.set(null);
        try {
          const detail = await this.api.fetchAdminUser(id);
          if (!cancelled) this.apply(detail);
        } catch (err) {
          if (!cancelled) this.error.set(describeApiError(err, 'Impossible de charger ce compte.'));
        } finally {
          if (!cancelled) this.loading.set(false);
        }
      });
    });
  }

  private apply(detail: AdminUserDetail): void {
    this.data.set(detail);
    this.status.set(detail.user.status);
    this.role.set(detail.user.role);
  }

  protected formatDateTime(value: string): string {
    return new Date(value).toLocaleString('fr-FR');
  }

  protected openStatusDialog(event: Event): void {
    event.preventDefault();
    this.error.set(null);
    this.success.set(null);
    if (this.reason().trim().length < 3) {
      this.error.set('Indiquez un motif d\'au moins 3 caractères. Il est consigné dans le journal d\'audit.');
      return;
    }
    this.dialogError.set(null);
    this.dialog.set('status');
  }

  protected openRoleDialog(event: Event): void {
    event.preventDefault();
    this.error.set(null);
    this.success.set(null);
    this.stepUp.reset();
    this.dialogError.set(null);
    this.dialog.set('role');
  }

  protected cancelRoleDialog(): void {
    if (this.busy()) return;
    this.dialog.set(null);
    this.stepUp.reset();
  }

  protected async confirmStatus(): Promise<void> {
    const status = this.status();
    this.busy.set(true);
    this.dialogError.set(null);
    try {
      const detail = await this.api.updateAdminUserStatus(this.id(), { status, reason: this.reason().trim() });
      this.apply(detail);
      this.reason.set('');
      this.dialog.set(null);
      this.success.set(
        status === 'ACTIVE' && detail.user.status === 'PENDING_VERIFICATION'
          ? 'Compte réactivé. Il reste en attente jusqu\'à ce que l\'utilisateur vérifie son courriel.'
          : `Statut du compte défini sur ${STATUS_LABELS[detail.user.status] ?? detail.user.status}. L'utilisateur a été notifié par courriel.`,
      );
    } catch (err) {
      this.dialogError.set(describeApiError(err, 'Échec de la mise à jour du statut.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirmRole(): Promise<void> {
    const problem = this.stepUp.validate();
    if (problem) {
      this.dialogError.set(problem);
      return;
    }
    this.busy.set(true);
    this.dialogError.set(null);
    try {
      const { password, totpCode } = this.stepUp.payload();
      const detail = await this.api.updateAdminUserRole(this.id(), { role: this.role(), password, totpCode });
      this.apply(detail);
      this.dialog.set(null);
      this.stepUp.reset();
      this.success.set(
        'Rôle mis à jour. Le compte doit se reconnecter pour que le changement s\'applique partout.',
      );
    } catch (err) {
      this.stepUp.patch({ password: '', totpCode: '' });
      this.dialogError.set(describeApiError(err, 'Échec de la mise à jour du rôle.'));
    } finally {
      this.busy.set(false);
    }
  }
}
