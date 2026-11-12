import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SessionsApi } from '../../core/api/sessions-api';
import { ApiError, type AuthSession, type User } from '../../core/api/types';
import { AuthService } from '../../core/auth/auth.service';
import { SessionsPage } from './sessions.page';

const current: AuthSession = {
  id: 's-current',
  deviceLabel: null,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  createdAt: '2026-11-01T09:00:00.000Z',
  lastSeenAt: '2026-11-10T09:00:00.000Z',
  expiresAt: '2026-12-01T09:00:00.000Z',
  current: true,
};

const phone: AuthSession = {
  ...current,
  id: 's-phone',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  current: false,
};

describe('Sessions page', () => {
  let api: {
    listSessions: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
    revokeOtherSessions: ReturnType<typeof vi.fn>;
    logoutAll: ReturnType<typeof vi.fn>;
  };
  let user: ReturnType<typeof signal<Partial<User> | null>>;
  let endLocalSession: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  async function render() {
    TestBed.configureTestingModule({
      imports: [SessionsPage],
      providers: [
        provideRouter([]),
        { provide: SessionsApi, useValue: api },
        { provide: AuthService, useValue: { user, endLocalSession } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(SessionsPage);
    await fixture.whenStable();
    return fixture;
  }

  function button(root: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  beforeEach(() => {
    api = {
      listSessions: vi.fn().mockResolvedValue([current, phone]),
      revokeSession: vi.fn().mockResolvedValue(undefined),
      revokeOtherSessions: vi.fn().mockResolvedValue(undefined),
      logoutAll: vi.fn().mockResolvedValue(undefined),
    };
    user = signal<Partial<User> | null>({ id: 'u1', mfaEnabled: false });
    endLocalSession = vi.fn();
  });

  it('lists sessions and marks the current device', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    const cards = Array.from(root.querySelectorAll('article'));

    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Chrome on Windows', 'Safari on iOS']);
    expect(cards[0].textContent).toContain('Cet appareil');
    expect(button(cards[0], 'Révoquer la session')).toBeUndefined();
    expect(cards[1].textContent).not.toContain('Cet appareil');
    expect(button(cards[1], 'Révoquer la session')).toBeDefined();
    expect(root.textContent).not.toContain('Chargement des sessions…');
  });

  it('revokes one session and reloads the list', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    api.listSessions.mockResolvedValue([current]);

    button(root, 'Révoquer la session').click();
    await fixture.whenStable();

    expect(api.revokeSession).toHaveBeenCalledWith('s-phone');
    expect(api.listSessions).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.form-success-banner')?.textContent).toContain('Session déconnectée.');
    expect(root.querySelectorAll('article')).toHaveLength(1);
    expect(button(root, 'Déconnecter les autres sessions').disabled).toBe(true);
  });

  it('reports a failed single revoke', async () => {
    api.revokeSession.mockRejectedValue(new Error('nope'));
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    button(root, 'Révoquer la session').click();
    await fixture.whenStable();
    expect(root.querySelector('.form-error-banner')?.textContent).toContain('Impossible de déconnecter cette session.');
  });

  it('requires the password and authenticator code before signing out other sessions', async () => {
    user.set({ id: 'u1', mfaEnabled: true });
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;

    button(root, 'Déconnecter les autres sessions').click();
    await fixture.whenStable();
    const dialog = root.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toBe('Déconnecter toutes les autres sessions ?');
    expect(document.activeElement).toBe(dialog.querySelector('#revoke-others-password'));

    button(dialog, 'Déconnecter les autres').click();
    await fixture.whenStable();
    expect(dialog.querySelector('.form-error-banner')?.textContent).toBe('Saisissez votre mot de passe pour confirmer.');

    type(dialog.querySelector('#revoke-others-password') as HTMLInputElement, 'secret');
    await fixture.whenStable();
    button(dialog, 'Déconnecter les autres').click();
    await fixture.whenStable();
    expect(dialog.querySelector('.form-error-banner')?.textContent).toBe(
      "Saisissez le code à 6 chiffres de votre application d'authentification.",
    );

    type(dialog.querySelector('#revoke-others-totp') as HTMLInputElement, '12a3456');
    await fixture.whenStable();
    expect((dialog.querySelector('#revoke-others-totp') as HTMLInputElement).value).toBe('123456');
    api.listSessions.mockResolvedValue([current]);
    button(dialog, 'Déconnecter les autres').click();
    await fixture.whenStable();

    expect(api.revokeOtherSessions).toHaveBeenCalledWith({ password: 'secret', totpCode: '123456' });
    expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    expect(root.querySelector('.form-success-banner')?.textContent).toContain('Toutes les autres sessions ont été déconnectées.');
    expect(root.querySelectorAll('article')).toHaveLength(1);
  });

  it('keeps the dialog open and clears the secrets when signing out others fails', async () => {
    api.revokeOtherSessions.mockRejectedValue(new ApiError(401, 'Mot de passe incorrect.', 'INVALID_CREDENTIALS'));
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    button(root, 'Déconnecter les autres sessions').click();
    await fixture.whenStable();
    const dialog = root.querySelector('[role="alertdialog"]') as HTMLElement;
    type(dialog.querySelector('#revoke-others-password') as HTMLInputElement, 'wrong');
    await fixture.whenStable();
    button(dialog, 'Déconnecter les autres').click();
    await fixture.whenStable();

    expect(api.revokeOtherSessions).toHaveBeenCalledWith({ password: 'wrong' });
    expect(dialog.querySelector('.form-error-banner')?.textContent).toBe('Mot de passe incorrect.');
    expect((dialog.querySelector('#revoke-others-password') as HTMLInputElement).value).toBe('');
  });

  it('signs out everywhere, ends the local session and returns to sign-in', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    button(root, 'Déconnecter partout').click();
    await fixture.whenStable();
    const dialog = root.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toBe('Déconnecter partout ?');
    expect(dialog.querySelector('input')).toBeNull();

    button(dialog, 'Déconnecter partout').click();
    await fixture.whenStable();

    expect(api.logoutAll).toHaveBeenCalledTimes(1);
    expect(endLocalSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true });
  });

  it('cancels a dialog without calling the API', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    button(root, 'Déconnecter partout').click();
    await fixture.whenStable();
    button(root.querySelector('[role="alertdialog"]') as HTMLElement, 'Annuler').click();
    await fixture.whenStable();
    expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    expect(api.logoutAll).not.toHaveBeenCalled();
  });

  it('reports a failed load', async () => {
    api.listSessions.mockRejectedValue(new Error('down'));
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.form-error-banner')?.textContent).toContain('Impossible de charger les sessions.');
    expect(root.textContent).toContain('Aucune session active trouvée.');
  });
});
