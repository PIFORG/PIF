import type { UserStatus } from '@/lib/api/types';

const LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Active',
  PENDING_VERIFICATION: 'Pending verification',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
  PENDING_DELETION: 'Pending deletion',
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

export function AccountStatusBadge({ status }: { status: UserStatus }) {
  return <span className={badgeClass(status)}>{LABELS[status]}</span>;
}
