import type { UserRole } from '@/lib/api/types';

/**
 * LIVE_INTEGRATED: backed by a real API.
 * DEMO_EXPLICITLY_LABELLED: shows labelled sample data on request.
 * DESIGNED_PENDING_BACKEND: designed screen; the engine/API does not exist yet.
 */
export type RouteStatus = 'LIVE_INTEGRATED' | 'DEMO_EXPLICITLY_LABELLED' | 'DESIGNED_PENDING_BACKEND';

export type NavIcon =
  | 'overview'
  | 'markets'
  | 'trading'
  | 'portfolio'
  | 'risk'
  | 'strategy'
  | 'ai'
  | 'bank'
  | 'xai'
  | 'academy'
  | 'challenge'
  | 'actuarial'
  | 'profile'
  | 'security'
  | 'sessions'
  | 'users'
  | 'audit'
  | 'platform';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  status: RouteStatus;
  /** Extra path prefixes that mark this item active. */
  match?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
  roles?: UserRole[];
}

export const WORKSPACE_NAV: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Overview', icon: 'overview', status: 'LIVE_INTEGRATED' },
      { href: '/markets', label: 'Markets', icon: 'markets', status: 'DESIGNED_PENDING_BACKEND' },
      { href: '/trading', label: 'Trading Desk', icon: 'trading', status: 'DESIGNED_PENDING_BACKEND' },
      { href: '/portfolios', label: 'Portfolios', icon: 'portfolio', status: 'DESIGNED_PENDING_BACKEND' },
      { href: '/risk', label: 'Risk Analytics', icon: 'risk', status: 'DESIGNED_PENDING_BACKEND' },
    ],
  },
  {
    id: 'research',
    label: 'Research & AI',
    items: [
      {
        href: '/strategies',
        label: 'Strategies & Backtesting',
        icon: 'strategy',
        status: 'DESIGNED_PENDING_BACKEND',
        match: ['/backtesting'],
      },
      { href: '/ai', label: 'AI Insights', icon: 'ai', status: 'DESIGNED_PENDING_BACKEND' },
      { href: '/stress-testing', label: 'Bank Stress Testing', icon: 'bank', status: 'DESIGNED_PENDING_BACKEND' },
      { href: '/explainability', label: 'Explainable AI', icon: 'xai', status: 'DESIGNED_PENDING_BACKEND' },
    ],
  },
  {
    id: 'learn',
    label: 'Learn',
    items: [
      { href: '/learn', label: 'Academy', icon: 'academy', status: 'DESIGNED_PENDING_BACKEND' },
      { href: '/challenges', label: 'Challenges', icon: 'challenge', status: 'DESIGNED_PENDING_BACKEND' },
    ],
  },
  {
    id: 'insurance',
    label: 'Insurance',
    items: [{ href: '/actuarial', label: 'Actuarial Lab', icon: 'actuarial', status: 'DESIGNED_PENDING_BACKEND' }],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { href: '/settings/profile', label: 'Profile', icon: 'profile', status: 'LIVE_INTEGRATED' },
      { href: '/settings/security', label: 'Security', icon: 'security', status: 'LIVE_INTEGRATED' },
      { href: '/settings/sessions', label: 'Sessions', icon: 'sessions', status: 'LIVE_INTEGRATED' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    roles: ['ADMIN'],
    items: [
      { href: '/admin', label: 'Platform', icon: 'platform', status: 'LIVE_INTEGRATED' },
      { href: '/admin/users', label: 'Users', icon: 'users', status: 'LIVE_INTEGRATED' },
      { href: '/admin/audit', label: 'Audit', icon: 'audit', status: 'LIVE_INTEGRATED' },
    ],
  },
];

/** Most-used live destinations for the mobile bottom bar. */
export const MOBILE_PRIMARY: string[] = ['/dashboard', '/markets', '/learn', '/settings/profile'];

export function navForRole(role: UserRole | undefined): NavGroup[] {
  return WORKSPACE_NAV.filter((group) => !group.roles || (role !== undefined && group.roles.includes(role)));
}

export function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/admin') return pathname === '/admin';
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
}

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  for (const group of WORKSPACE_NAV) {
    for (const item of group.items) {
      if (isItemActive(item, pathname)) return { group, item };
    }
  }
  return null;
}

export const STATUS_LABEL: Record<RouteStatus, string> = {
  LIVE_INTEGRATED: 'Live',
  DEMO_EXPLICITLY_LABELLED: 'Demo',
  DESIGNED_PENDING_BACKEND: 'Preview',
};
