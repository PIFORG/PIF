import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { UserStatus } from '../core/api/types';

const LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Actif',
  PENDING_VERIFICATION: 'Vérification en attente',
  SUSPENDED: 'Suspendu',
  DEACTIVATED: 'Désactivé',
  PENDING_DELETION: 'Suppression en attente',
};

function badgeClass(status: UserStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'badge badge-active';
    case 'PENDING_VERIFICATION':
    case 'PENDING_DELETION':
      return 'badge badge-pending';
    case 'SUSPENDED':
    case 'DEACTIVATED':
      return 'badge badge-danger';
    default:
      return 'badge badge-muted';
  }
}

@Component({
  selector: 'mtr-account-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `<span [class]="cssClass()">{{ label() }}</span>`,
})
export class AccountStatusBadgeComponent {
  readonly status = input.required<UserStatus>();
  protected readonly cssClass = computed(() => badgeClass(this.status()));
  protected readonly label = computed(() => LABELS[this.status()]);
}
