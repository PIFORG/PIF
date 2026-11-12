import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { AdminApi, type AdminUsersQuery } from '../../core/api/admin-api';
import { describeApiError } from '../../core/api/errors';
import type { PaginatedUsers, UserRole, UserStatus } from '../../core/api/types';
import { FormErrorComponent } from '../../shared/form-messages.component';
import { AdminUserTableComponent } from './admin-user-table.component';

const SEARCH_DEBOUNCE_MS = 350;

@Component({
  selector: 'mtr-admin-users-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormErrorComponent, AdminUserTableComponent],
  host: { style: 'display: contents' },
  templateUrl: './admin-users.page.html',
})
export class AdminUsersPage {
  private readonly api = inject(AdminApi);

  protected readonly q = signal('');
  private readonly appliedQ = signal('');
  protected readonly status = signal<UserStatus | ''>('');
  protected readonly role = signal<UserRole | ''>('');
  protected readonly emailVerified = signal<'true' | 'false' | ''>('');
  protected readonly page = signal(1);
  protected readonly data = signal<PaginatedUsers | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loaded = computed(() => (this.loading() ? null : this.data()));
  protected readonly totalPages = computed(() => {
    const data = this.data();
    return data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  });
  protected readonly max = Math.max;

  constructor() {
    effect((onCleanup) => {
      const q = this.q();
      const handle = setTimeout(() => {
        const next = q.trim();
        if (this.appliedQ() !== next) this.page.set(1);
        this.appliedQ.set(next);
      }, SEARCH_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(handle));
    });

    effect(() => {
      const query: AdminUsersQuery = {
        q: this.appliedQ() || undefined,
        status: this.status(),
        role: this.role(),
        emailVerified: this.emailVerified(),
        page: this.page(),
        pageSize: 20,
      };
      untracked(() => void this.load(query));
    });
  }

  private async load(query: AdminUsersQuery): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.api.fetchAdminUsers(query));
    } catch (err) {
      this.error.set(describeApiError(err, 'Impossible de charger les utilisateurs.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected onSearch(event: Event): void {
    event.preventDefault();
    this.appliedQ.set(this.q().trim());
    this.page.set(1);
  }

  protected setStatus(value: UserStatus | ''): void {
    this.status.set(value);
    this.page.set(1);
  }

  protected setRole(value: UserRole | ''): void {
    this.role.set(value);
    this.page.set(1);
  }

  protected setEmailVerified(value: 'true' | 'false' | ''): void {
    this.emailVerified.set(value);
    this.page.set(1);
  }
}
