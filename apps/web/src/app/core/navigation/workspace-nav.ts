import type { UserRole } from '../api/types';
import { FR } from '../i18n/fr';

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
  | 'stories'
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
    label: FR.nav.groupWorkspace,
    items: [
      { href: '/dashboard', label: FR.nav.overview, icon: 'overview', status: 'LIVE_INTEGRATED' },
      { href: '/markets', label: FR.nav.markets, icon: 'markets', status: 'LIVE_INTEGRATED' },
      { href: '/trading', label: FR.nav.tradingDesk, icon: 'trading', status: 'LIVE_INTEGRATED' },
      { href: '/portfolios', label: FR.nav.portfolios, icon: 'portfolio', status: 'LIVE_INTEGRATED' },
      { href: '/risk', label: FR.nav.riskAnalytics, icon: 'risk', status: 'LIVE_INTEGRATED' },
    ],
  },
  {
    id: 'research',
    label: FR.nav.groupResearch,
    items: [
      {
        href: '/backtesting',
        label: FR.nav.backtesting,
        icon: 'strategy',
        status: 'LIVE_INTEGRATED',
        match: ['/strategies'],
      },
      {
        href: '/strategies',
        label: FR.nav.strategies,
        icon: 'strategy',
        status: 'DESIGNED_PENDING_BACKEND',
      },
      { href: '/ai', label: FR.nav.aiInsights, icon: 'ai', status: 'DESIGNED_PENDING_BACKEND' },
      { href: '/stress-testing', label: FR.nav.bankStress, icon: 'bank', status: 'DESIGNED_PENDING_BACKEND' },
      { href: '/explainability', label: FR.nav.explainableAi, icon: 'xai', status: 'DESIGNED_PENDING_BACKEND' },
    ],
  },
  {
    id: 'learn',
    label: FR.nav.groupLearn,
    items: [
      { href: '/learn', label: FR.nav.marketQuest, icon: 'academy', status: 'LIVE_INTEGRATED' },
      { href: '/stories', label: FR.nav.finStories, icon: 'stories', status: 'LIVE_INTEGRATED' },
      { href: '/challenges', label: FR.nav.challenges, icon: 'challenge', status: 'DESIGNED_PENDING_BACKEND' },
    ],
  },
  {
    id: 'insurance',
    label: FR.nav.groupInsurance,
    items: [{ href: '/actuarial', label: FR.nav.actuarialLab, icon: 'actuarial', status: 'LIVE_INTEGRATED' }],
  },
  {
    id: 'account',
    label: FR.nav.groupAccount,
    items: [
      { href: '/settings/profile', label: FR.nav.profile, icon: 'profile', status: 'LIVE_INTEGRATED' },
      { href: '/settings/security', label: FR.nav.security, icon: 'security', status: 'LIVE_INTEGRATED' },
      { href: '/settings/sessions', label: FR.nav.sessions, icon: 'sessions', status: 'LIVE_INTEGRATED' },
    ],
  },
  {
    id: 'admin',
    label: FR.nav.groupAdmin,
    roles: ['ADMIN'],
    items: [
      { href: '/admin', label: FR.nav.platform, icon: 'platform', status: 'LIVE_INTEGRATED' },
      { href: '/admin/users', label: FR.nav.users, icon: 'users', status: 'LIVE_INTEGRATED' },
      { href: '/admin/audit', label: FR.nav.audit, icon: 'audit', status: 'LIVE_INTEGRATED' },
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
  LIVE_INTEGRATED: FR.status.live,
  DEMO_EXPLICITLY_LABELLED: FR.status.demo,
  DESIGNED_PENDING_BACKEND: FR.status.preview,
};

/** Workspace routes implemented in Angular (live API or designed ModulePreview). */
export const MIGRATED_ROUTES: string[] = [
  '/dashboard',
  '/markets',
  '/trading',
  '/portfolios',
  '/learn',
  '/stories',
  '/risk',
  '/backtesting',
  '/strategies',
  '/ai',
  '/stress-testing',
  '/explainability',
  '/challenges',
  '/actuarial',
  '/settings/profile',
  '/settings/security',
  '/settings/sessions',
  '/admin',
  '/admin/users',
  '/admin/audit',
];
