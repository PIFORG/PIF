import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthApi } from '../core/api/auth-api';
import { ApiError } from '../core/api/types';
import { AuthService, type AuthStatus } from '../core/auth/auth.service';
import { ConfirmEmailChangePage } from './confirm-email-change/confirm-email-change.page';
import { ResetPasswordPage } from './reset-password/reset-password.page';
import { VerifyEmailPage } from './verify-email/verify-email.page';

describe('e-mail link pages', () => {
  let api: { verifyEmail: ReturnType<typeof vi.fn>; resetPassword: ReturnType<typeof vi.fn>; confirmEmailChange: ReturnType<typeof vi.fn> };
  let status: ReturnType<typeof signal<AuthStatus>>;
  let endLocalSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = { verifyEmail: vi.fn(), resetPassword: vi.fn(), confirmEmailChange: vi.fn() };
    status = signal<AuthStatus>('authenticated');
    endLocalSession = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'verify-email', component: VerifyEmailPage },
          { path: 'reset-password', component: ResetPasswordPage },
          { path: 'confirm-email-change', component: ConfirmEmailChangePage },
        ]),
        { provide: AuthApi, useValue: api },
        { provide: AuthService, useValue: { status, endLocalSession } },
      ],
    });
  });

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    return harness;
  }

  function root(harness: RouterTestingHarness): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function button(harness: RouterTestingHarness, label: string): HTMLButtonElement {
    const found = Array.from(root(harness).querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
    return found as HTMLButtonElement;
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function click(harness: RouterTestingHarness, target: HTMLElement) {
    target.click();
    await harness.fixture.whenStable();
  }

  describe('verify email', () => {
    it('removes the token from the URL without consuming it', async () => {
      const harness = await open('/verify-email?token=abc123&utm=mail');
      expect(TestBed.inject(Router).url).toBe('/verify-email?utm=mail');
      expect(root(harness).textContent).toContain('Un jeton de vérification est prêt. Cliquez sur confirmer pour terminer la vérification.');
      expect(api.verifyEmail).not.toHaveBeenCalled();
    });

    it('verifies only on click and offers the sign-in link', async () => {
      api.verifyEmail.mockResolvedValue({ message: 'Courriel vérifié.' });
      const harness = await open('/verify-email?token=abc123');
      await click(harness, button(harness, 'Confirmer la vérification du courriel'));

      expect(api.verifyEmail).toHaveBeenCalledWith('abc123');
      expect(root(harness).querySelector('.form-success-banner')?.textContent).toContain('Courriel vérifié.');
      expect(button(harness, 'Confirmer la vérification du courriel')).toBeUndefined();
      const links = Array.from(root(harness).querySelectorAll('a')).map((a) => a.textContent?.trim());
      expect(links).toContain('Continuer vers la connexion');
    });

    it('explains a failure with the fallback message', async () => {
      api.verifyEmail.mockRejectedValue(new Error('boom'));
      const harness = await open('/verify-email?token=abc123');
      await click(harness, button(harness, 'Confirmer la vérification du courriel'));
      expect(root(harness).querySelector('.form-error-banner')?.textContent).toContain(
        "Échec de la vérification. Le lien est peut-être expiré.",
      );
    });

    it('disables confirmation when no token is present', async () => {
      const harness = await open('/verify-email');
      expect(root(harness).textContent).toContain("Aucun jeton de vérification n'a été trouvé dans l'URL de cette page.");
      expect(button(harness, 'Confirmer la vérification du courriel').disabled).toBe(true);
    });
  });

  describe('reset password', () => {
    it('asks for the handoff before showing the form, then resets with the token', async () => {
      api.resetPassword.mockResolvedValue({ message: '' });
      const harness = await open('/reset-password?token=reset-1');
      expect(TestBed.inject(Router).url).toBe('/reset-password');
      expect(root(harness).querySelector('form')).toBeNull();

      await click(harness, button(harness, 'Confirmer le transfert de réinitialisation'));
      await click(harness, button(harness, 'Mettre à jour le mot de passe'));
      expect(root(harness).querySelector('#password-error')?.textContent).toBe('Le mot de passe doit contenir au moins 8 caractères');
      expect(api.resetPassword).not.toHaveBeenCalled();

      type(root(harness).querySelector('#password') as HTMLInputElement, 'Engine#1843');
      type(root(harness).querySelector('#confirmPassword') as HTMLInputElement, 'Engine#1843');
      await click(harness, button(harness, 'Mettre à jour le mot de passe'));

      expect(api.resetPassword).toHaveBeenCalledWith({
        token: 'reset-1',
        password: 'Engine#1843',
        passwordConfirmation: 'Engine#1843',
      });
      expect(root(harness).querySelector('.form-success-banner')?.textContent).toContain(
        'Mot de passe mis à jour. Vous pouvez vous connecter avec le nouveau mot de passe.',
      );
      expect(root(harness).querySelector('form')).toBeNull();
    });

    it('explains a missing token', async () => {
      const harness = await open('/reset-password');
      expect(root(harness).textContent).toContain(
        "Aucun jeton de réinitialisation n'a été trouvé. Demandez un nouveau lien depuis la page « Mot de passe oublié ».",
      );
    });
  });

  describe('confirm email change', () => {
    it('removes the token from the address bar without consuming it', async () => {
      const harness = await open('/confirm-email-change?token=abc123');
      expect(TestBed.inject(Router).url).toBe('/confirm-email-change');
      expect(root(harness).textContent).toContain('Vous serez déconnecté sur tous les appareils après confirmation.');
      expect(api.confirmEmailChange).not.toHaveBeenCalled();
    });

    it('consumes the token only on click and ends the local session', async () => {
      api.confirmEmailChange.mockResolvedValue({ message: 'ok' });
      const harness = await open('/confirm-email-change?token=abc123');
      await click(harness, button(harness, 'Confirmer le nouveau courriel'));

      expect(api.confirmEmailChange).toHaveBeenCalledWith('abc123');
      expect(root(harness).textContent).toContain('Votre adresse courriel a été modifiée');
      expect(endLocalSession).toHaveBeenCalledTimes(1);
    });

    it('explains an invalid or used link', async () => {
      api.confirmEmailChange.mockRejectedValue(new ApiError(400, 'Invalid token', 'TOKEN_INVALID'));
      const harness = await open('/confirm-email-change?token=abc123');
      await click(harness, button(harness, 'Confirmer le nouveau courriel'));

      expect(root(harness).textContent).toContain('invalide, expiré ou déjà utilisé');
      expect(endLocalSession).not.toHaveBeenCalled();
    });

    it('disables confirmation when no token is present', async () => {
      const harness = await open('/confirm-email-change');
      expect(button(harness, 'Confirmer le nouveau courriel').disabled).toBe(true);
    });
  });
});
