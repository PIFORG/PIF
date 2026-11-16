import { ADMIN_NAV } from './admin-nav';
import {
  INVESTOR_NAV,
  investorNavHrefs,
  isInvestorItemActive,
  isInvestorSectionActive,
} from './investor-nav';
import { MIGRATED_ROUTES } from './workspace-nav';

describe('investor navigation', () => {
  it('exposes the six top-level investor sections without admin destinations', () => {
    expect(INVESTOR_NAV.map((s) => s.id)).toEqual([
      'overview',
      'markets',
      'trade',
      'portfolios',
      'analyze',
      'learn',
    ]);
    const hrefs = investorNavHrefs();
    expect(hrefs.some((h) => h.startsWith('/admin'))).toBe(false);
    for (const href of hrefs) {
      expect(MIGRATED_ROUTES).toContain(href);
    }
  });

  it('marks section and item activity from the current path', () => {
    const analyze = INVESTOR_NAV.find((s) => s.id === 'analyze')!;
    expect(isInvestorSectionActive(analyze, '/ai')).toBe(true);
    expect(isInvestorSectionActive(analyze, '/dashboard')).toBe(false);
    const backtesting = analyze.children!.find((c) => c.href === '/backtesting')!;
    expect(isInvestorItemActive(backtesting, '/strategies')).toBe(true);
    expect(isInvestorItemActive(backtesting, '/markets')).toBe(false);
  });
});

describe('admin navigation', () => {
  it('lists only admin console destinations', () => {
    expect(ADMIN_NAV.every((item) => item.href.startsWith('/admin'))).toBe(true);
    expect(ADMIN_NAV.map((i) => i.href)).toContain('/admin/users');
    expect(ADMIN_NAV.map((i) => i.href)).toContain('/admin/audit');
  });
});
