import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  logout: vi.fn(),
  role: 'INVESTOR' as 'INVESTOR' | 'ADMIN',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: mocks.role },
    logout: mocks.logout,
  }),
}));

import { ProfileDropdown } from './ProfileDropdown';

beforeEach(() => {
  mocks.role = 'INVESTOR';
  mocks.replace.mockReset();
  mocks.logout.mockReset();
});
afterEach(cleanup);

describe('ProfileDropdown', () => {
  it('supports arrow-key navigation and returns focus on Escape', async () => {
    const u = userEvent.setup();
    render(<ProfileDropdown />);
    const trigger = screen.getByRole('button', { name: /Account menu/ });

    trigger.focus();
    await u.keyboard('{ArrowDown}');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Profile', 'Security', 'Sessions', 'Sign out']);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    await u.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(items[3]);
    await u.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await u.keyboard('{End}');
    expect(document.activeElement).toBe(items[3]);

    await u.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('shows the admin entry only to administrators', async () => {
    mocks.role = 'ADMIN';
    const u = userEvent.setup();
    render(<ProfileDropdown />);
    await u.click(screen.getByRole('button', { name: /Account menu/ }));
    expect(screen.getByRole('menuitem', { name: 'Admin' })).toBeTruthy();
  });

  it('signs out and navigates to login', async () => {
    mocks.logout.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<ProfileDropdown />);
    await u.click(screen.getByRole('button', { name: /Account menu/ }));
    await u.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login'));
  });
});
