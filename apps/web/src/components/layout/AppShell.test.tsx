import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/dashboard',
  role: 'INVESTOR' as 'INVESTOR' | 'ADMIN',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      role: mocks.role,
      preferences: { timezone: 'UTC' },
    },
    logout: vi.fn(),
  }),
}));

vi.mock('@/lib/api/health', () => ({
  fetchServiceHealth: () => Promise.resolve('online'),
}));

import { AppShell } from './AppShell';

beforeEach(() => {
  mocks.pathname = '/dashboard';
  mocks.role = 'INVESTOR';
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(cleanup);

describe('AppShell', () => {
  it('labels the environment as simulated and marks the current page', async () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByText('Simulated')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByText('Services online')).toBeTruthy();
  });

  it('flags modules without a backend as previews', () => {
    render(<AppShell>content</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const trading = within(nav).getByRole('link', { name: /Trading Desk/ });
    expect(trading.textContent).toMatch(/Preview/);
    expect(trading.textContent).toMatch(/backend not available yet/);
  });

  it('shows the administration group only to administrators', () => {
    render(<AppShell>content</AppShell>);
    expect(screen.queryByText('Administration')).toBeNull();
    cleanup();
    mocks.role = 'ADMIN';
    render(<AppShell>content</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Users' })).toBeTruthy();
  });

  it('opens the mobile drawer and closes it with Escape, restoring focus', async () => {
    const u = userEvent.setup();
    render(<AppShell>content</AppShell>);
    const open = screen.getByRole('button', { name: 'Open navigation' });
    await u.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toBeTruthy();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('persists the collapsed sidebar preference', async () => {
    const u = userEvent.setup();
    render(<AppShell>content</AppShell>);
    await u.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(window.localStorage.getItem('mtrs-sidebar-collapsed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-pressed')).toBe('true');
  });
});
