import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

function Harness({
  onConfirm = () => {},
  withField = false,
  busy = false,
}: {
  onConfirm?: () => void;
  withField?: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ConfirmDialog
        open={open}
        title="Delete account"
        description="This cannot be undone."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      >
        {withField ? <input aria-label="Current password" /> : null}
      </ConfirmDialog>
    </>
  );
}

describe('ConfirmDialog', () => {
  it('focuses Cancel rather than the destructive action and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);

    expect(screen.getByRole('alertdialog', { name: 'Delete account' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('focuses the first step-up field and traps Tab inside the panel', async () => {
    const user = userEvent.setup();
    render(<Harness withField />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    const field = screen.getByLabelText('Current password');
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(document.activeElement).toBe(field);

    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(field);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('submits step-up fields with Enter', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness withField onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.type(screen.getByLabelText('Current password'), 'secret{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape and Enter while busy', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness withField busy onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.type(screen.getByLabelText('Current password'), 'x{Enter}');
    await user.keyboard('{Escape}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});
