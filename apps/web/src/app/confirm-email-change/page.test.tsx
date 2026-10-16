import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/types';

const mocks = vi.hoisted(() => ({
  confirmEmailChange: vi.fn(),
  endLocalSession: vi.fn(),
  status: 'authenticated',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/lib/api/users', () => ({
  confirmEmailChange: mocks.confirmEmailChange,
}));

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ status: mocks.status, endLocalSession: mocks.endLocalSession }),
}));

import ConfirmEmailChangePage from './page';

beforeEach(() => {
  mocks.confirmEmailChange.mockReset();
  mocks.endLocalSession.mockReset();
  window.history.replaceState({}, '', '/confirm-email-change?token=abc123');
});
afterEach(cleanup);

describe('Confirm email change page', () => {
  it('removes the token from the address bar without consuming it', async () => {
    render(<ConfirmEmailChangePage />);
    expect(await screen.findByText(/signed out on every device/)).toBeTruthy();
    expect(window.location.search).toBe('');
    expect(mocks.confirmEmailChange).not.toHaveBeenCalled();
  });

  it('consumes the token only on click and ends the local session', async () => {
    mocks.confirmEmailChange.mockResolvedValue({ message: 'ok' });
    const u = userEvent.setup();
    render(<ConfirmEmailChangePage />);
    await u.click(await screen.findByRole('button', { name: 'Confirm new email' }));

    expect(mocks.confirmEmailChange).toHaveBeenCalledWith('abc123');
    expect(await screen.findByText(/Your email address was changed/)).toBeTruthy();
    expect(mocks.endLocalSession).toHaveBeenCalledTimes(1);
  });

  it('explains an invalid or used link', async () => {
    mocks.confirmEmailChange.mockRejectedValue(
      new ApiError(400, 'Invalid token', 'TOKEN_INVALID'),
    );
    const u = userEvent.setup();
    render(<ConfirmEmailChangePage />);
    await u.click(await screen.findByRole('button', { name: 'Confirm new email' }));

    expect(await screen.findByText(/invalid, expired or already used/)).toBeTruthy();
    expect(mocks.endLocalSession).not.toHaveBeenCalled();
  });

  it('disables confirmation when no token is present', async () => {
    window.history.replaceState({}, '', '/confirm-email-change');
    render(<ConfirmEmailChangePage />);
    const button = await screen.findByRole('button', { name: 'Confirm new email' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
