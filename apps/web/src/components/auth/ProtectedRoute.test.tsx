import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/api/types';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/settings/sessions',
  auth: { status: 'loading', user: null } as { status: string; user: Partial<User> | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname,
}));

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => mocks.auth,
}));

import { ProtectedRoute } from './ProtectedRoute';

const investor: Partial<User> = {
  id: 'u1',
  role: 'INVESTOR',
  status: 'ACTIVE',
  emailVerified: true,
};

function renderGuarded(props: Partial<Parameters<typeof ProtectedRoute>[0]> = {}) {
  return render(
    <ProtectedRoute {...props}>
      <p>Secret area</p>
    </ProtectedRoute>,
  );
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.pathname = '/settings/sessions';
  window.history.replaceState({}, '', '/settings/sessions?tab=all');
});
afterEach(cleanup);

describe('ProtectedRoute', () => {
  it('shows a status message while the session is being restored', () => {
    mocks.auth = { status: 'loading', user: null };
    renderGuarded();
    expect(screen.getByRole('status').textContent).toContain('Checking session');
    expect(screen.queryByText('Secret area')).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('sends anonymous visitors to login with the full return path', () => {
    mocks.auth = { status: 'unauthenticated', user: null };
    renderGuarded();
    expect(screen.queryByText('Secret area')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith(
      `/login?returnTo=${encodeURIComponent('/settings/sessions?tab=all')}`,
    );
  });

  it('renders children for an allowed user', () => {
    mocks.auth = { status: 'authenticated', user: investor };
    renderGuarded();
    expect(screen.getByText('Secret area')).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('blocks a role that is not allowed', () => {
    mocks.auth = { status: 'authenticated', user: investor };
    renderGuarded({ roles: ['ADMIN'] });
    expect(screen.queryByText('Secret area')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith('/unauthorized');
  });

  it('blocks a status that is not allowed', () => {
    mocks.auth = { status: 'authenticated', user: { ...investor, status: 'SUSPENDED' } };
    renderGuarded();
    expect(screen.queryByText('Secret area')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith('/unauthorized');
  });

  it('routes unverified users to resend verification when required', () => {
    mocks.auth = { status: 'authenticated', user: { ...investor, emailVerified: false } };
    renderGuarded({ requireEmailVerified: true });
    expect(screen.queryByText('Secret area')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith('/resend-verification');
  });
});
