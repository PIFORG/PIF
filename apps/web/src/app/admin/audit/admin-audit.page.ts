import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { AdminApi, type AdminAuditQuery } from '../../core/api/admin-api';
import { describeApiError } from '../../core/api/errors';
import type { PaginatedAuditEvents } from '../../core/api/types';
import { FormErrorComponent } from '../../shared/form-messages.component';

interface Filters {
  eventType: string;
  outcome: '' | 'SUCCESS' | 'FAILURE' | 'DENIED';
  subjectUserId: string;
  fromDate: string;
  toDate: string;
}

const EMPTY: Filters = { eventType: '', outcome: '', subjectUserId: '', fromDate: '', toDate: '' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIsoBoundary(date: string, endOfDay: boolean): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

function formatContext(context: Record<string, unknown> | null): string {
  if (!context) return '—';
  return Object.entries(context)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(', ');
}

@Component({
  selector: 'mtr-admin-audit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormErrorComponent],
  host: { style: 'display: contents' },
  templateUrl: './admin-audit.page.html',
})
export class AdminAuditPage {
  private readonly api = inject(AdminApi);

  protected readonly draft = signal<Filters>(EMPTY);
  private readonly applied = signal<Filters>(EMPTY);
  protected readonly page = signal(1);
  protected readonly data = signal<PaginatedAuditEvents | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loaded = computed(() => (this.loading() ? null : this.data()));
  protected readonly totalPages = computed(() => {
    const data = this.data();
    return data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  });
  protected readonly max = Math.max;
  protected readonly formatContext = formatContext;

  constructor() {
    effect(() => {
      const applied = this.applied();
      const query: AdminAuditQuery = {
        eventType: applied.eventType || undefined,
        outcome: applied.outcome,
        subjectUserId: applied.subjectUserId || undefined,
        from: toIsoBoundary(applied.fromDate, false),
        to: toIsoBoundary(applied.toDate, true),
        page: this.page(),
        pageSize: 25,
      };
      untracked(() => void this.load(query));
    });
  }

  private async load(query: AdminAuditQuery): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.api.fetchAuditEvents(query));
    } catch (err) {
      this.error.set(describeApiError(err, 'Impossible de charger les événements d\'audit.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected setDraft<K extends keyof Filters>(field: K, value: Filters[K]): void {
    this.draft.update((current) => ({ ...current, [field]: value }));
  }

  protected apply(event: Event): void {
    event.preventDefault();
    const draft = this.draft();
    const eventType = draft.eventType.trim().toUpperCase();
    const subjectUserId = draft.subjectUserId.trim();
    if (eventType && !/^[A-Z][A-Z0-9_]{0,79}$/.test(eventType)) {
      this.error.set('Les types d\'événement utilisent des majuscules et des underscores, ex. LOGIN_FAILURE.');
      return;
    }
    if (subjectUserId && !UUID.test(subjectUserId)) {
      this.error.set('L\'ID du compte doit être un UUID complet.');
      return;
    }
    if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
      this.error.set('La date de début doit être antérieure à la date de fin.');
      return;
    }
    this.page.set(1);
    this.applied.set({ ...draft, eventType, subjectUserId });
  }

  protected clear(): void {
    this.draft.set(EMPTY);
    this.applied.set(EMPTY);
    this.page.set(1);
  }

  protected formatDateTime(value: string): string {
    return new Date(value).toLocaleString('fr-FR');
  }
}
