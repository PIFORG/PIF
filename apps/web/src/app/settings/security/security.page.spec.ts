import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthApi } from '../../core/api/auth-api';
import { MfaApi } from '../../core/api/mfa-api';
import { SessionsApi } from '../../core/api/sessions-api';
import { ApiError, type User } from '../../core/api/types';
import { AuthService } from '../../core/auth/auth.service';
import { SecurityPage } from './security.page';

const investor: User = {
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'INVESTOR',
  experienceLevel: 'BEGINNER',
  emailVerified: true,
  status: 'ACTIVE',
  mfaEnabled: false,
  createdAt: '2026-01-02T10:00:00.000Z',
  lastLoginAt: null,
  preferences: null,
};

describe('Security page', () => {
  let user: ReturnType<typeof signal<User | null>>;
  let auth: { user: typeof user; refreshUser: ReturnType<typeof vi.fn>; setSession: ReturnType<typeof vi.fn>; endLocalSession: ReturnType<typeof vi.fn> };
  let authApi: Record<string, ReturnType<typeof vi.fn>>;
  let mfaApi: Record<string, ReturnType<typeof vi.fn>>;
  let sessionsApi: { listSessions: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.fn>;

  async function render() {
    TestBed.configureTestingModule({
      imports: [SecurityPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: AuthApi, useValue: authApi },
        { provide: MfaApi, useValue: mfaApi },
        { provide: SessionsApi, useValue: sessionsApi },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(SecurityPage);
    await fixture.whenStable();
    await fixture.whenStable();
    return fixture;
  }

  function el<T extends HTMLElement>(root: HTMLElement, selector: string): T {
    return root.querySelector(selector) as T;
  }

  function button(root: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function act(fixture: Awaited<ReturnType<typeof render>>, target: HTMLElement) {
    target.click();
    await fixture.whenStable();
  }

  function dialog(root: HTMLElement): HTMLElement {
    return el(root, '[role="alertdialog"]');
  }

  beforeEach(() => {
    user = signal<User | null>(investor);
    auth = { user, refreshUser: vi.fn().mockResolvedValue(undefined), setSession: vi.fn(), endLocalSession: vi.fn() };
    authApi = {
      fetchDashboardContext: vi.fn().mockResolvedValue({ requiredActions: [], modules: [] }),
      changePassword: vi.fn(),
      requestEmailChange: vi.fn(),
      deactivateAccount: vi.fn(),
      deleteAccount: vi.fn(),
    };
    mfaApi = {
      mfaStatus: vi.fn().mockResolvedValue({ mfaEnabled: true, mfaVerifiedAt: null, remainingRecoveryCodes: 10 }),
      setupMfa: vi.fn(),
      enableMfa: vi.fn(),
      disableMfa: vi.fn(),
      regenerateRecoveryCodes: vi.fn(),
    };
    sessionsApi = { listSessions: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) };
  });

  it('summarises sessions and warns an administrator who still has to enrol', async () => {
    authApi['fetchDashboardContext'].mockResolvedValue({ requiredActions: ['ENROLL_MFA_FOR_ADMIN'], modules: [] });
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('2 sessions actives.');
    expect(root.textContent).toContain(
      "Les outils d'administration restent verrouillés tant que vous n'avez pas activé la vérification en deux étapes ci-dessous.",
    );
    expect(root.textContent).toContain('Courriel actuel : ada@example.com');
    expect(mfaApi['mfaStatus']).not.toHaveBeenCalled();
  });

  describe('change password', () => {
    it('validates every field and focuses the first invalid one', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#newPassword'), 'short');
      await act(fixture, button(root, 'Mettre à jour le mot de passe'));

      expect(el(root, '#currentPassword-error').textContent).toBe('Le mot de passe actuel est obligatoire');
      expect(el(root, '#newPassword-error').textContent).toBe('Le mot de passe doit contenir au moins 8 caractères');
      expect(el(root, '#confirmPassword-error').textContent).toBe('Les mots de passe ne correspondent pas');
      expect(document.activeElement).toBe(el(root, '#currentPassword'));
      expect(authApi['changePassword']).not.toHaveBeenCalled();
    });

    it('requires the authenticator code when MFA is on, then rotates the session', async () => {
      user.set({ ...investor, mfaEnabled: true });
      const rotated = { ...investor, mfaEnabled: true };
      authApi['changePassword'].mockResolvedValue({ accessToken: 'new-jwt', user: rotated });
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#currentPassword'), 'Old#pass1');
      type(el(root, '#newPassword'), 'New#pass12');
      type(el(root, '#confirmPassword'), 'New#pass12');
      await act(fixture, button(root, 'Mettre à jour le mot de passe'));

      expect(el(root, '#changePasswordTotp-error').textContent).toBe("Saisissez le code à 6 chiffres de votre application d'authentification");
      expect(authApi['changePassword']).not.toHaveBeenCalled();

      type(el(root, '#changePasswordTotp'), '654321');
      await act(fixture, button(root, 'Mettre à jour le mot de passe'));

      expect(authApi['changePassword']).toHaveBeenCalledWith({
        currentPassword: 'Old#pass1',
        newPassword: 'New#pass12',
        newPasswordConfirmation: 'New#pass12',
        totpCode: '654321',
      });
      expect(auth.setSession).toHaveBeenCalledWith('new-jwt', rotated);
      expect(el(root, '.form-success-banner').textContent).toContain(
        'Mot de passe modifié. Tous les autres appareils ont été déconnectés ; cet appareil continue avec une nouvelle session.',
      );
      expect(el<HTMLInputElement>(root, '#currentPassword').value).toBe('');
      expect(el<HTMLInputElement>(root, '#newPassword').value).toBe('');
    });

    it('clears the current password after a rejected change', async () => {
      authApi['changePassword'].mockRejectedValue(new ApiError(401, 'Mot de passe actuel incorrect.', 'INVALID_CREDENTIALS'));
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#currentPassword'), 'Wrong#pass1');
      type(el(root, '#newPassword'), 'New#pass12');
      type(el(root, '#confirmPassword'), 'New#pass12');
      await act(fixture, button(root, 'Mettre à jour le mot de passe'));

      expect(authApi['changePassword']).toHaveBeenCalledWith({
        currentPassword: 'Wrong#pass1',
        newPassword: 'New#pass12',
        newPasswordConfirmation: 'New#pass12',
      });
      expect(el(root, '.form-error-banner').textContent).toContain('Mot de passe actuel incorrect.');
      expect(el<HTMLInputElement>(root, '#currentPassword').value).toBe('');
      expect(el<HTMLInputElement>(root, '#newPassword').value).toBe('New#pass12');
    });
  });

  it('requests an email change with the trimmed address', async () => {
    authApi['requestEmailChange'].mockResolvedValue({ message: '' });
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    await act(fixture, button(root, 'Demander le changement de courriel'));
    expect(el(root, '#newEmail-error').textContent).toBe('Saisissez une adresse courriel valide');
    expect(el(root, '#emailPassword-error').textContent).toBe('Le mot de passe est obligatoire');

    type(el(root, '#newEmail'), ' new@example.com ');
    type(el(root, '#emailPassword'), 'secret');
    await act(fixture, button(root, 'Demander le changement de courriel'));

    expect(authApi['requestEmailChange']).toHaveBeenCalledWith({ newEmail: 'new@example.com', password: 'secret' });
    expect(el(root, '.form-success-banner').textContent).toContain(
      'Si la nouvelle adresse peut être utilisée, un lien de confirmation lui a été envoyé. Votre adresse actuelle a été notifiée.',
    );
    expect(el<HTMLInputElement>(root, '#newEmail').value).toBe('');
  });

  describe('two-step verification', () => {
    it('sets up, enables and shows the recovery codes once', async () => {
      mfaApi['setupMfa'].mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', otpauth: 'otpauth://totp/MTRS:ada', expiresInMinutes: 10 });
      mfaApi['enableMfa'].mockResolvedValue({ recoveryCodes: ['AAAA-1111', 'BBBB-2222'] });
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('Statut :');
      expect(root.textContent).toContain('Désactivée');

      await act(fixture, button(root, "Configurer l'authentificateur"));
      expect(el(root, '#mfaSetupPassword-error').textContent).toBe('Le mot de passe est obligatoire');
      expect(mfaApi['setupMfa']).not.toHaveBeenCalled();

      type(el(root, '#mfaSetupPassword'), 'secret');
      await act(fixture, button(root, "Configurer l'authentificateur"));

      expect(mfaApi['setupMfa']).toHaveBeenCalledWith({ password: 'secret' });
      expect(el(root, '[aria-label="Secret d\'authentification"]').textContent).toBe('JBSWY3DPEHPK3PXP');
      expect(el(root, 'a[href^="otpauth:"]').textContent).toBe("Ouvrir dans l'application d'authentification");
      expect(root.textContent).toContain('Cette configuration expire dans 10 minutes.');
      expect(el(root, '#mfaSetupPassword')).toBeNull();

      type(el(root, '#mfaEnableCode'), '12345');
      await act(fixture, button(root, 'Activer la vérification en deux étapes'));
      expect(el(root, '#mfaEnableCode-error').textContent).toBe("Saisissez le code à 6 chiffres de l'authentificateur");
      expect(mfaApi['enableMfa']).not.toHaveBeenCalled();

      type(el(root, '#mfaEnableCode'), ' 123456 ');
      await act(fixture, button(root, 'Activer la vérification en deux étapes'));

      expect(mfaApi['enableMfa']).toHaveBeenCalledWith('123456');
      expect(auth.refreshUser).toHaveBeenCalledTimes(1);
      const region = el(root, '[role="region"][aria-label="Nouveaux codes de récupération"]');
      expect(Array.from(region.querySelectorAll('code')).map((c) => c.textContent)).toEqual(['AAAA-1111', 'BBBB-2222']);
      expect(el(root, '.form-success-banner').textContent).toContain('La vérification en deux étapes est maintenant activée.');
      expect(el(root, '[aria-label="Secret d\'authentification"]')).toBeNull();

      user.set({ ...investor, mfaEnabled: true });
      await fixture.whenStable();
      await fixture.whenStable();
      expect(root.textContent).toContain('Statut : Activée · 10 codes de récupération inutilisés');

      await act(fixture, button(region, "J'ai enregistré ces codes"));
      expect(el(root, '[role="region"][aria-label="Nouveaux codes de récupération"]')).toBeNull();
    });

    it('abandons an expired setup', async () => {
      mfaApi['setupMfa'].mockResolvedValue({ secret: 'S', otpauth: 'otpauth://totp/x' });
      mfaApi['enableMfa'].mockRejectedValue(new ApiError(400, 'Expired', 'MFA_SETUP_EXPIRED'));
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#mfaSetupPassword'), 'secret');
      await act(fixture, button(root, "Configurer l'authentificateur"));
      type(el(root, '#mfaEnableCode'), '123456');
      await act(fixture, button(root, 'Activer la vérification en deux étapes'));

      expect(el(root, '.form-error-banner').textContent).toContain(
        "La configuration de l'authentificateur a expiré. Relancez la configuration pour obtenir un nouveau secret.",
      );
      expect(el(root, '#mfaEnableCode')).toBeNull();
      expect(el(root, '#mfaSetupPassword')).not.toBeNull();
    });

    it('warns when recovery codes run low', async () => {
      user.set({ ...investor, mfaEnabled: true });
      mfaApi['mfaStatus'].mockResolvedValue({ mfaEnabled: true, mfaVerifiedAt: null, remainingRecoveryCodes: 1 });
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('Statut : Activée · 1 code de récupération inutilisé');
      expect(root.textContent).toContain('Il vous reste peu de codes de récupération.');
    });

    it('turns MFA off with a recovery code', async () => {
      user.set({ ...investor, mfaEnabled: true });
      mfaApi['disableMfa'].mockResolvedValue({ message: 'ok' });
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      await act(fixture, button(root, 'Désactiver la vérification en deux étapes'));
      expect(dialog(root).querySelector('h2')?.textContent).toBe('Désactiver la vérification en deux étapes ?');

      await act(fixture, button(dialog(root), 'Désactiver'));
      expect(dialog(root).querySelector('.form-error-banner')?.textContent).toBe('Saisissez votre mot de passe pour confirmer.');

      type(el(root, '#disableMfa-password'), 'secret');
      await fixture.whenStable();
      await act(fixture, button(dialog(root), 'Désactiver'));
      expect(dialog(root).querySelector('.form-error-banner')?.textContent).toBe(
        "Saisissez le code à 6 chiffres de votre application d'authentification.",
      );

      await act(fixture, button(dialog(root), 'Appareil perdu ? Utiliser un code de récupération'));
      await act(fixture, button(dialog(root), 'Désactiver'));
      expect(dialog(root).querySelector('.form-error-banner')?.textContent).toBe("Saisissez l'un de vos codes de récupération.");

      type(el(root, '#disableMfa-recovery'), ' abcd-1234 ');
      await fixture.whenStable();
      await act(fixture, button(dialog(root), 'Désactiver'));

      expect(mfaApi['disableMfa']).toHaveBeenCalledWith({ password: 'secret', recoveryCode: 'ABCD-1234' });
      expect(dialog(root)).toBeNull();
      expect(el(root, '.form-success-banner').textContent).toContain(
        'La vérification en deux étapes est désactivée. Les autres appareils ont été déconnectés.',
      );
      expect(auth.refreshUser).toHaveBeenCalledTimes(1);
    });

    it('regenerates recovery codes after step-up', async () => {
      user.set({ ...investor, mfaEnabled: true });
      mfaApi['regenerateRecoveryCodes'].mockResolvedValue({ recoveryCodes: ['NEW1-0000'] });
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      await act(fixture, button(root, 'Générer de nouveaux codes de récupération'));
      type(el(root, '#regen-password'), 'secret');
      type(el(root, '#regen-totp'), '111222');
      await fixture.whenStable();
      await act(fixture, button(dialog(root), 'Générer les codes'));

      expect(mfaApi['regenerateRecoveryCodes']).toHaveBeenCalledWith({ password: 'secret', totpCode: '111222' });
      expect(el(root, '[aria-label="Nouveaux codes de récupération"]').textContent).toContain('NEW1-0000');
      expect(el(root, '.form-success-banner').textContent).toContain('Nouveaux codes de récupération générés.');
      expect(mfaApi['mfaStatus']).toHaveBeenCalledTimes(2);
    });
  });

  describe('account lifecycle', () => {
    it('only deletes after DELETE is typed, then signs out locally', async () => {
      authApi['deleteAccount'].mockResolvedValue({ message: 'ok' });
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      await act(fixture, button(root, 'Supprimer le compte'));
      type(el(root, '#delete-password'), 'secret');
      type(el(root, '#deleteConfirmation'), 'delete');
      await fixture.whenStable();
      await act(fixture, button(dialog(root), 'Supprimer le compte'));

      expect(dialog(root).querySelector('.form-error-banner')?.textContent).toBe('Saisissez DELETE pour confirmer.');
      expect(authApi['deleteAccount']).not.toHaveBeenCalled();

      type(el(root, '#deleteConfirmation'), 'DELETE');
      await fixture.whenStable();
      await act(fixture, button(dialog(root), 'Supprimer le compte'));

      expect(authApi['deleteAccount']).toHaveBeenCalledWith({ password: 'secret', totpCode: undefined, confirmation: 'DELETE' });
      expect(auth.endLocalSession).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true });
    });

    it('keeps the deactivate dialog open with the error and clears the password', async () => {
      authApi['deactivateAccount'].mockRejectedValue(new ApiError(401, 'Mot de passe incorrect.', 'INVALID_CREDENTIALS'));
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      await act(fixture, button(root, 'Désactiver le compte'));
      type(el(root, '#deactivate-password'), 'wrong');
      await fixture.whenStable();
      await act(fixture, button(dialog(root), 'Désactiver'));

      expect(authApi['deactivateAccount']).toHaveBeenCalledWith({ password: 'wrong', totpCode: undefined, confirmation: 'DEACTIVATE' });
      expect(dialog(root).querySelector('.form-error-banner')?.textContent).toBe('Mot de passe incorrect.');
      expect(el<HTMLInputElement>(root, '#deactivate-password').value).toBe('');
      expect(auth.endLocalSession).not.toHaveBeenCalled();
    });
  });
});
