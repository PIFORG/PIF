import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULES } from '@/lib/modules/moduleCatalog';
import { findNavItem, isItemActive, navForRole, WORKSPACE_NAV } from './workspaceNav';

const APP_DIR = join(__dirname, '..', '..', 'app');
const allItems = WORKSPACE_NAV.flatMap((g) => g.items);

describe('workspace navigation', () => {
  it('hides the administration group from investors and shows it to administrators', () => {
    expect(navForRole('INVESTOR').some((g) => g.id === 'admin')).toBe(false);
    expect(navForRole(undefined).some((g) => g.id === 'admin')).toBe(false);
    expect(navForRole('ADMIN').some((g) => g.id === 'admin')).toBe(true);
  });

  it('has unique destinations and a page for every one of them', () => {
    const hrefs = allItems.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(existsSync(join(APP_DIR, ...href.split('/').filter(Boolean), 'page.tsx')), href).toBe(true);
    }
  });

  it('marks only identity routes as live; every pending route has a module definition', () => {
    for (const item of allItems) {
      if (item.status === 'LIVE_INTEGRATED') {
        expect(item.href === '/dashboard' || item.href.startsWith('/settings') || item.href.startsWith('/admin')).toBe(true);
      } else {
        expect(MODULES[item.href.slice(1)], item.href).toBeDefined();
      }
    }
  });

  it('matches active items precisely', () => {
    const platform = allItems.find((i) => i.href === '/admin')!;
    const users = allItems.find((i) => i.href === '/admin/users')!;
    expect(isItemActive(platform, '/admin')).toBe(true);
    expect(isItemActive(platform, '/admin/users')).toBe(false);
    expect(isItemActive(users, '/admin/users/abc')).toBe(true);
    expect(findNavItem('/backtesting')?.item.href).toBe('/strategies');
    expect(findNavItem('/marketsx')).toBeNull();
  });
});

describe('module catalog', () => {
  it('describes every module with capabilities, a layout, a contract and concepts', () => {
    for (const [slug, mod] of Object.entries(MODULES)) {
      expect(mod.slug).toBe(slug);
      expect(mod.capabilities.length).toBeGreaterThan(0);
      expect(mod.blueprint.length).toBeGreaterThan(0);
      expect(mod.contracts.length).toBeGreaterThan(0);
      expect(mod.concepts.length).toBeGreaterThan(0);
      expect(existsSync(join(APP_DIR, slug, 'page.tsx')), slug).toBe(true);
    }
  });
});
