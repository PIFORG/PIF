import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODULES } from '@/lib/modules/moduleCatalog';

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

import { ModulePreviewPage } from './ModulePreviewPage';

afterEach(cleanup);

describe('ModulePreviewPage', () => {
  it('states plainly that the module is not connected and lists its proposed contract', () => {
    render(<ModulePreviewPage module={MODULES.risk} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Risk Analytics' })).toBeTruthy();
    expect(screen.getByText(/Preview · backend pending/)).toBeTruthy();
    expect(screen.getByText(/Designed, not yet connected/)).toBeTruthy();
    expect(screen.getByText('/portfolios/:id/risk')).toBeTruthy();
    expect(screen.getAllByText('Proposed').length).toBe(MODULES.risk.contracts.length);
  });

  it('renders the trading ticket fully disabled with an explanation', () => {
    render(<ModulePreviewPage module={MODULES.trading} />);
    const submit = screen.getByRole('button', { name: 'Review order' }) as HTMLButtonElement;
    expect(submit.closest('fieldset')?.disabled).toBe(true);
    expect(screen.getByText(/execution engine is not connected/)).toBeTruthy();
    expect(screen.getByText(/No order is ever sent to a real market/)).toBeTruthy();
  });
});
