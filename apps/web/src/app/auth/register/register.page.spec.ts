import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ApiError } from '../../core/api/types';
import { AuthService, type AuthStatus } from '../../core/auth/auth.service';
import { RegisterPage } from './register.page';

describe('Register page', () => {
  let status: ReturnType<typeof signal<AuthStatus>>;
  let register: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  async function render() {
    TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: { status, register } }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(RegisterPage);
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

  function fill(root: HTMLElement, overrides: Partial<Record<string, string>> = {}) {
    const values: Record<string, string> = {
      firstName: ' Ada ',
      lastName: 'Lovelace',
      email: ' ada@example.com ',
      password: 'Engine#1843',
      confirmPassword: 'Engine#1843',
      ...overrides,
    };
    for (const [id, value] of Object.entries(values)) type(el(root, `#${id}`), value);
  }

  async function submit(fixture: Awaited<ReturnType<typeof render>>) {
    el<HTMLButtonElement>(fixture.nativeElement, 'button[type="submit"]').click();
    await fixture.whenStable();
  }

  beforeEach(() => {
    status = signal<AuthStatus>('unauthenticated');
    register = vi.fn();
  });

  it('shows every validation message on submit and focuses the first invalid field', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    await submit(fixture);

    expect(el(root, '#firstName-error').textContent).toBe('Le prénom est obligatoire');
    expect(el(root, '#lastName-error').textContent).toBe('Le nom est obligatoire');
    expect(el(root, '#email-error').textContent).toBe('Saisissez une adresse courriel valide');
    expect(el(root, '#password-error').textContent).toBe('Le mot de passe doit contenir au moins 8 caractères');
    expect(el(root, '#confirmPassword-error')).toBeNull();
    expect(document.activeElement).toBe(el(root, '#firstName'));
    expect(register).not.toHaveBeenCalled();
  });

  it('applies the password rules and the confirmation check', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    fill(root, { password: 'abcdefgh1', confirmPassword: 'other' });
    await submit(fixture);

    expect(el(root, '#password-error').textContent).toBe('Le mot de passe doit contenir un symbole');
    expect(el(root, '#confirmPassword-error').textContent).toBe('Les mots de passe ne correspondent pas');

    type(el(root, '#password'), 'abcdefgh1!');
    await fixture.whenStable();
    expect(el(root, '#password-error')).toBeNull();
    expect(el(root, '#confirmPassword-error').textContent).toBe('Les mots de passe ne correspondent pas');
    expect(register).not.toHaveBeenCalled();
  });

  it('submits trimmed values and shows the neutral confirmation', async () => {
    register.mockResolvedValue(undefined);
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    fill(root);
    await submit(fixture);

    expect(register).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'Engine#1843',
      passwordConfirmation: 'Engine#1843',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(el(root, '.form-success-banner').textContent).toContain(
      'Si cette adresse peut être enregistrée, vous recevrez bientôt un message de vérification.',
    );
    expect(el(root, '.form-error-banner')).toBeNull();
  });

  it('shows the API error when registration fails', async () => {
    register.mockRejectedValue(new ApiError(400, 'Registration is closed.', 'REGISTRATION_CLOSED'));
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    fill(root);
    await submit(fixture);

    expect(el(root, '.form-error-banner').textContent).toContain('Registration is closed.');
    expect(el(root, '.form-success-banner')).toBeNull();
  });

  it('rates the password strength while typing', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    type(el(root, '#password'), 'Correct horse 9');
    await fixture.whenStable();
    expect(root.textContent).toContain('Strength: Excellent');
  });

  it('sends a signed-in user to the dashboard', async () => {
    status.set('authenticated');
    await render();
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
  });
});
