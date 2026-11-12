import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ApiError } from '../../core/api/types';
import { AuthService, type AuthStatus } from '../../core/auth/auth.service';
import { LoginPage } from './login.page';

const user = { id: 'u1', email: 'ada@example.com' };

describe('Login page', () => {
  let status: ReturnType<typeof signal<AuthStatus>>;
  let login: ReturnType<typeof vi.fn>;
  let completeMfa: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  async function render(search = '') {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { status, login, completeMfa } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(Object.fromEntries(new URLSearchParams(search))) } },
        },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(LoginPage);
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

  async function submitPassword(fixture: Awaited<ReturnType<typeof render>>) {
    const root = fixture.nativeElement as HTMLElement;
    type(el(root, '#email'), 'ada@example.com');
    type(el(root, '#password'), 'correct horse battery');
    el<HTMLButtonElement>(root, 'button[type="submit"]').click();
    await fixture.whenStable();
  }

  beforeEach(() => {
    status = signal<AuthStatus>('unauthenticated');
    login = vi.fn();
    completeMfa = vi.fn();
  });

  it('signs in and follows a safe returnTo', async () => {
    login.mockResolvedValue({ accessToken: 'jwt', user });
    const fixture = await render('returnTo=%2Fsettings%2Fsessions');
    await submitPassword(fixture);

    expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(navigate).toHaveBeenCalledWith('/settings/sessions', { replaceUrl: true });
  });

  it('ignores an unsafe returnTo', async () => {
    login.mockResolvedValue({ accessToken: 'jwt', user });
    const fixture = await render('returnTo=%2F%09%2Fevil.com');
    await submitPassword(fixture);
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
  });

  it('shows client-side validation messages before calling the API', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    el<HTMLButtonElement>(root, 'button[type="submit"]').click();
    await fixture.whenStable();

    expect(el(root, '#email-error').textContent).toBe('Saisissez une adresse courriel valide');
    expect(el(root, '#password-error').textContent).toBe('Le mot de passe est obligatoire');
    expect(login).not.toHaveBeenCalled();
  });

  it('shows the generic error and clears the password on failure', async () => {
    login.mockRejectedValue(new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS'));
    const fixture = await render();
    await submitPassword(fixture);

    const root = fixture.nativeElement as HTMLElement;
    expect(el(root, '.form-error-banner').textContent).toContain('Invalid email or password.');
    expect(el<HTMLInputElement>(root, '#password').value).toBe('');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('offers a resend link for unverified accounts', async () => {
    login.mockRejectedValue(new ApiError(403, 'Email not verified.', 'EMAIL_NOT_VERIFIED'));
    const fixture = await render();
    await submitPassword(fixture);

    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a'));
    const link = links.find((a) => a.textContent?.trim() === 'Renvoyer le courriel de vérification');
    expect(link?.getAttribute('href')).toBe('/resend-verification?email=ada%40example.com');
  });

  it('completes an MFA challenge before navigating', async () => {
    login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
    completeMfa.mockResolvedValue(user);
    const fixture = await render();
    await submitPassword(fixture);

    const root = fixture.nativeElement as HTMLElement;
    expect(el(root, 'h1').textContent).toBe('Vérification en deux étapes');
    expect(navigate).not.toHaveBeenCalled();

    type(el(root, '#code'), '123456');
    el<HTMLButtonElement>(root, 'button[type="submit"]').click();
    await fixture.whenStable();

    expect(completeMfa).toHaveBeenCalledWith('challenge-1', '123456');
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
  });

  it('returns to the password step after a rejected MFA code', async () => {
    login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
    completeMfa.mockRejectedValue(new ApiError(401, 'Invalid code.', 'MFA_INVALID'));
    const fixture = await render();
    await submitPassword(fixture);

    const root = fixture.nativeElement as HTMLElement;
    type(el(root, '#code'), '000000');
    el<HTMLButtonElement>(root, 'button[type="submit"]').click();
    await fixture.whenStable();

    expect(el(root, '.form-error-banner').textContent).toContain('n\'a pas été accepté');
    expect(el(root, 'h1').textContent).toBe('Se connecter');
    expect(el(root, '#code')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not show the form to an already signed-in user', async () => {
    status.set('authenticated');
    const fixture = await render();
    expect(el((fixture.nativeElement as HTMLElement), '#password')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
  });
});
