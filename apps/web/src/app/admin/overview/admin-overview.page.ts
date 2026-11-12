import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApi } from '../../core/api/admin-api';
import { describeApiError } from '../../core/api/errors';
import type { AdminOverview } from '../../core/api/types';
import { FormErrorComponent } from '../../shared/form-messages.component';

@Component({
  selector: 'mtr-admin-overview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormErrorComponent],
  host: { style: 'display: contents' },
  templateUrl: './admin-overview.page.html',
})
export class AdminOverviewPage {
  private readonly api = inject(AdminApi);

  protected readonly data = signal<AdminOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loaded = computed(() => (this.loading() ? null : this.data()));
  protected readonly tiles = computed(() => {
    const users = this.data()?.users;
    return [
      { label: 'Utilisateurs au total', value: users?.total },
      { label: 'Actifs', value: users?.active },
      { label: 'Vérification en attente', value: users?.pending },
      { label: 'Suspendus', value: users?.suspended },
      { label: 'Désactivés', value: users?.deactivated },
      { label: 'Courriels vérifiés', value: users?.verified },
      { label: 'Vérification en deux étapes activée', value: users?.mfaEnabled },
    ];
  });

  constructor() {
    let cancelled = false;
    inject(DestroyRef).onDestroy(() => (cancelled = true));
    void (async () => {
      this.loading.set(true);
      this.error.set(null);
      try {
        const overview = await this.api.fetchAdminOverview();
        if (!cancelled) this.data.set(overview);
      } catch (err) {
        if (!cancelled) this.error.set(describeApiError(err, 'Impossible de charger la vue d\'ensemble administration.'));
      } finally {
        if (!cancelled) this.loading.set(false);
      }
    })();
  }

  protected formatDateTime(value: string): string {
    return new Date(value).toLocaleString('fr-FR');
  }
}
