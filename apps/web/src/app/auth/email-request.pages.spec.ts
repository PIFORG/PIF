import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthApi } from '../core/api/auth-api';
import { ApiError } from '../core/api/types';
import { ForgotPasswordPage } from './forgot-password/forgot-password.page';
import { ResendVerificationPage } from './resend-verification/resend-verification.page';

describe('e-mail request pages', () => {
  let api: { forgotPassword: ReturnType<typeof vi.fn>; resendVerification: ReturnType<typeof vi.fn> };

  async function render<T>(page: Type<T>, search = '') {
    TestBed.configureTestingModule({
      imports: [page],
      providers: [
        provideRouter([]),
        { provide: AuthApi, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(Object.fromEntries(new URLSearchParams(search))) } },
        },
      ],
    });
    const fixture = TestBed.createComponent(page);
    await fixture.whenStable();
    return fixture;
  }

  function el<T extends HTMLElement>(root: HTMLElement, selector: string): T {
    return root.querySelector(selector) as T;
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  beforeEach(() => {
    api = { forgotPassword: vi.fn(), resendVerification: vi.fn() };
  });

  afterEach(() => vi.useRealTimers());

  describe('forgot password', () => {
    it('validates the email before calling the API', async () => {
      const fixture = await render(ForgotPasswordPage);
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#email'), 'not-an-email');
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();

      expect(el(root, '#email-error').textContent).toBe('Saisissez une adresse courriel valide');
      expect(api.forgotPassword).not.toHaveBeenCalled();
    });

    it('sends the trimmed email, shows the neutral message and starts the cooldown', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      api.forgotPassword.mockResolvedValue({ message: '' });
      const fixture = await render(ForgotPasswordPage);
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#email'), ' ada@example.com ');
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();

      expect(api.forgotPassword).toHaveBeenCalledWith('ada@example.com');
      expect(el(root, '.form-success-banner').textContent).toContain(
        'Si un compte existe pour cette adresse, des instructions de réinitialisation ont été envoyées.',
      );
      const submit = el<HTMLButtonElement>(root, 'button[type="submit"]');
      expect(submit.textContent?.trim()).toBe('Renvoyer dans 60 s');
      expect(submit.disabled).toBe(true);

      vi.advanceTimersByTime(60_000);
      await fixture.whenStable();
      expect(submit.textContent?.trim()).toBe('Envoyer le lien de réinitialisation');
      expect(submit.disabled).toBe(false);
    });

    it('shows the fallback error on failure', async () => {
      api.forgotPassword.mockRejectedValue(new Error('offline'));
      const fixture = await render(ForgotPasswordPage);
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#email'), 'ada@example.com');
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();
      expect(el(root, '.form-error-banner').textContent).toContain(
        'Impossible de démarrer la réinitialisation du mot de passe.',
      );
    });
  });

  describe('resend verification', () => {
    it('prefills the email from the query string and sends it', async () => {
      api.resendVerification.mockResolvedValue({ message: 'Sent.' });
      const fixture = await render(ResendVerificationPage, 'email=ada%40example.com');
      const root = fixture.nativeElement as HTMLElement;
      expect(el<HTMLInputElement>(root, '#email').value).toBe('ada@example.com');

      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();
      expect(api.resendVerification).toHaveBeenCalledWith('ada@example.com');
      expect(el(root, '.form-success-banner').textContent).toContain('Sent.');
      expect(el<HTMLButtonElement>(root, 'button[type="submit"]').textContent?.trim()).toMatch(/^Renvoyer dans \d+ s$/);
    });

    it('shows the API error message', async () => {
      api.resendVerification.mockRejectedValue(new ApiError(429, 'Too many requests.', 'RATE_LIMITED'));
      const fixture = await render(ResendVerificationPage);
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#email'), 'ada@example.com');
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();
      expect(el(root, '.form-error-banner').textContent).toContain(
        'Trop de tentatives. Attendez quelques minutes avant de réessayer.',
      );
    });
  });
});
