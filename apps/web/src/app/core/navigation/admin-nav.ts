import { FR } from '../i18n/fr';
import type { NavItem } from './workspace-nav';

/** Admin-only sidebar destinations. */
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Tableau de bord', icon: 'platform', status: 'LIVE_INTEGRATED' },
  { href: '/admin/users', label: FR.nav.users, icon: 'users', status: 'LIVE_INTEGRATED' },
  { href: '/admin/platform', label: 'Supervision des services', icon: 'platform', status: 'LIVE_INTEGRATED', match: ['/admin/platform'] },
  { href: '/admin/audit', label: FR.nav.audit, icon: 'audit', status: 'LIVE_INTEGRATED' },
];

export function isAdminItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/admin') return pathname === '/admin';
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
}
