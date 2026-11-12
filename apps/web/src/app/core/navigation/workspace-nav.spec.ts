import { FR } from '../i18n/fr';
import { findNavItem, isItemActive, MIGRATED_ROUTES, navForRole, STATUS_LABEL, WORKSPACE_NAV } from './workspace-nav';

const allItems = WORKSPACE_NAV.flatMap((g) => g.items);

describe('workspace navigation', () => {
  it('hides the administration group from investors and shows it to administrators', () => {
    expect(navForRole('INVESTOR').some((g) => g.id === 'admin')).toBe(false);
    expect(navForRole(undefined).some((g) => g.id === 'admin')).toBe(false);
    expect(navForRole('ADMIN').some((g) => g.id === 'admin')).toBe(true);
  });

  it('has unique destinations and only lists migrated routes that exist in the navigation', () => {
    const hrefs = allItems.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const route of MIGRATED_ROUTES) expect(hrefs).toContain(route);
  });

  it('exposes French navigation labels and status badges', () => {
    expect(WORKSPACE_NAV.find((g) => g.id === 'workspace')?.label).toBe(FR.nav.groupWorkspace);
    expect(allItems.find((i) => i.href === '/dashboard')?.label).toBe(FR.nav.overview);
    expect(allItems.find((i) => i.href === '/risk')?.label).toBe(FR.nav.riskAnalytics);
    expect(STATUS_LABEL.LIVE_INTEGRATED).toBe('Opérationnel');
    expect(STATUS_LABEL.DESIGNED_PENDING_BACKEND).toBe('Aperçu');
  });

  it('matches active items precisely', () => {
    const platform = allItems.find((i) => i.href === '/admin')!;
    const users = allItems.find((i) => i.href === '/admin/users')!;
    expect(isItemActive(platform, '/admin')).toBe(true);
    expect(isItemActive(platform, '/admin/users')).toBe(false);
    expect(isItemActive(users, '/admin/users/abc')).toBe(true);
    expect(findNavItem('/backtesting')?.item.href).toBe('/backtesting');
    expect(findNavItem('/backtesting')?.item.status).toBe('LIVE_INTEGRATED');
    expect(findNavItem('/marketsx')).toBeNull();
  });
});
