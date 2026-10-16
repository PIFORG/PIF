import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/types';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  login: vi.fn(),
  completeMfa: vi.fn(),
  search: '',
  status: 'unauthenticated' as 'loading' | 'authenticated' | 'unauthenticated',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    login: mocks.login,
    completeMfa: mocks.completeMfa,
    status: mocks.status,
  }),
}));

import LoginPage from './page';

const user = { id: 'u1', email: 'ada@example.com' };

async function submitPassword(u: ReturnType<typeof userEvent.setup>) {
  await u.type(screen.getByLabelText('Email'), 'ada@example.com');
  await u.type(screen.getByLabelText('Password'), 'correct horse battery');
  await u.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  mocks.search = '';
  mocks.status = 'unauthenticated';
  mocks.replace.mockReset();
  mocks.login.mockReset();
  mocks.completeMfa.mockReset();
});
afterEach(cleanup);

describe('Login page', () => {
  it('signs in and follows a safe returnTo', async () => {
    mocks.search = 'returnTo=%2Fsettings%2Fsessions';
    mocks.login.mockResolvedValue({ accessToken: 'jwt', user });
    const u = userEvent.setup();
    render(<LoginPage />);
    await submitPassword(u);

    expect(mocks.login).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct horse battery',
    });
    expect(mocks.replace).toHaveBeenCalledWith('/settings/sessions');
  });

  it('ignores an unsafe returnTo', async () => {
    mocks.search = 'returnTo=%2F%09%2Fevil.com';
    mocks.login.mockResolvedValue({ accessToken: 'jwt', user });
    const u = userEvent.setup();
    render(<LoginPage />);
    await submitPassword(u);
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the generic error and clears the password on failure', async () => {
    mocks.login.mockRejectedValue(
      new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS'),
    );
    const u = userEvent.setup();
    render(<LoginPage />);
    await submitPassword(u);

    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('offers a resend link for unverified accounts', async () => {
    mocks.login.mockRejectedValue(
      new ApiError(403, 'Email not verified.', 'EMAIL_NOT_VERIFIED'),
    );
    const u = userEvent.setup();
    render(<LoginPage />);
    await submitPassword(u);

    const link = await screen.findByRole('link', { name: 'Resend verification email' });
    expect(link.getAttribute('href')).toBe('/resend-verification?email=ada%40example.com');
  });

  it('completes an MFA challenge before navigating', async () => {
    mocks.login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
    mocks.completeMfa.mockResolvedValue({ accessToken: 'jwt', user });
    const u = userEvent.setup();
    render(<LoginPage />);
    await submitPassword(u);

    expect(await screen.findByRole('heading', { name: 'Two-step verification' })).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();

    await u.type(screen.getByLabelText('Authenticator or recovery code'), '123456');
    await u.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(mocks.completeMfa).toHaveBeenCalledWith('challenge-1', '123456');
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('returns to the password step after a rejected MFA code', async () => {
    mocks.login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
    mocks.completeMfa.mockRejectedValue(new ApiError(401, 'Invalid code.', 'MFA_INVALID'));
    const u = userEvent.setup();
    render(<LoginPage />);
    await submitPassword(u);

    await u.type(await screen.findByLabelText('Authenticator or recovery code'), '000000');
    await u.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(await screen.findByText(/That code was not accepted/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByLabelText('Authenticator or recovery code')).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('does not show the form to an already signed-in user', () => {
    mocks.status = 'authenticated';
    render(<LoginPage />);
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
  });
});
