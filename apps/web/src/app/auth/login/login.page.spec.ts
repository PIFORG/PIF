import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ApiError } from '../../core/api/types';
import { AuthService, type AuthStatus } from '../../core/auth/auth.service';
import { LoginPage } from './login.page';

// ─── Données de test ─────────────────────────────────────────────────────────

const user = { id: 'u1', email: 'ada@example.com' };

// ─── Suite principale ─────────────────────────────────────────────────────────

describe('Login page – connexion email / mot de passe', () => {
  let status: ReturnType<typeof signal<AuthStatus>>;
  let login: ReturnType<typeof vi.fn>;
  let completeMfa: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function render(search = '') {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { status, login, completeMfa } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(Object.fromEntries(new URLSearchParams(search))),
            },
          },
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

  function all<T extends HTMLElement>(root: HTMLElement, selector: string): T[] {
    return Array.from(root.querySelectorAll(selector)) as T[];
  }

  /** Simule la saisie dans un <input> comme le ferait un vrai navigateur. */
  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /** Remplit le formulaire et clique sur « Se connecter ». */
  async function submitPassword(
    fixture: Awaited<ReturnType<typeof render>>,
    email = 'ada@example.com',
    password = 'correct horse battery',
  ) {
    const root = fixture.nativeElement as HTMLElement;
    type(el(root, '#email'), email);
    type(el(root, '#password'), password);
    el<HTMLButtonElement>(root, 'button[type="submit"]').click();
    await fixture.whenStable();
  }

  beforeEach(() => {
    status = signal<AuthStatus>('unauthenticated');
    login = vi.fn();
    completeMfa = vi.fn();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. RENDU INITIAL
  // ══════════════════════════════════════════════════════════════════════════

  describe('rendu initial', () => {
    it('affiche le titre « Connexion »', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      expect(el(root, 'h1').textContent).toBe('Connexion');
    });

    it('affiche les champs email et mot de passe', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      expect(el(root, '#email')).toBeTruthy();
      expect(el(root, '#password')).toBeTruthy();
    });

    it('affiche le bouton « Se connecter »', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      const btn = el<HTMLButtonElement>(root, 'button[type="submit"]');
      expect(btn.textContent?.trim()).toBe('Se connecter');
      expect(btn.disabled).toBe(false);
    });

    it('affiche le lien « Mot de passe oublié ? »', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      const link = all<HTMLAnchorElement>(root, 'a').find((a) =>
        a.textContent?.includes('Oublié'),
      );
      expect(link).toBeTruthy();
    });

    it('affiche le lien « Créer un compte »', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      const link = all<HTMLAnchorElement>(root, 'a').find((a) =>
        a.textContent?.includes('Créer un compte'),
      );
      expect(link).toBeTruthy();
    });

    it('ne montre aucun message d'erreur au départ', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      expect(el(root, '#email-error')).toBeNull();
      expect(el(root, '#password-error')).toBeNull();
      expect(el(root, '.form-error-banner')).toBeNull();
    });

    it('masque le mot de passe par défaut (type="password")', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      expect(el<HTMLInputElement>(root, '#password').type).toBe('password');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. VALIDATION CÔTÉ CLIENT
  // ══════════════════════════════════════════════════════════════════════════

  describe('validation côté client', () => {
    it('affiche les deux erreurs obligatoires si le formulaire est soumis vide', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();

      expect(el(root, '#email-error').textContent).toBe('Saisissez une adresse courriel valide');
      expect(el(root, '#password-error').textContent).toBe('Le mot de passe est obligatoire');
      expect(login).not.toHaveBeenCalled();
    });

    it('n'appelle pas l'API si l'email est invalide', async () => {
      const fixture = await render();
      await submitPassword(fixture, 'pas-un-email', 'motdepasse');
      expect(login).not.toHaveBeenCalled();
    });

    it('n'appelle pas l'API si le mot de passe est vide', async () => {
      const fixture = await render();
      await submitPassword(fixture, 'ada@example.com', '');
      expect(login).not.toHaveBeenCalled();
    });

    it('supprime l'espace autour de l'email avant la validation', async () => {
      login.mockResolvedValue({ accessToken: 'jwt', user });
      const fixture = await render();
      await submitPassword(fixture, '  ada@example.com  ', 'secret');
      expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'secret' });
    });

    it('marque le champ email avec aria-invalid en cas d'erreur', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();
      expect(el<HTMLInputElement>(root, '#email').getAttribute('aria-invalid')).toBe('true');
    });

    it('met à jour l'erreur email en temps réel après la première tentative', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      // 1re soumission → déclenche la validation
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();
      expect(el(root, '#email-error')).toBeTruthy();

      // Saisie d'un email valide → l'erreur doit disparaître
      type(el(root, '#email'), 'ada@example.com');
      fixture.detectChanges();
      expect(el(root, '#email-error')).toBeNull();
    });

    it('met à jour l'erreur mot de passe en temps réel après la première tentative', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();
      expect(el(root, '#password-error')).toBeTruthy();

      type(el(root, '#email'), 'ada@example.com');
      type(el(root, '#password'), 'secret');
      fixture.detectChanges();
      expect(el(root, '#password-error')).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. CONNEXION RÉUSSIE
  // ══════════════════════════════════════════════════════════════════════════

  describe('connexion réussie', () => {
    it('appelle auth.login avec les bonnes valeurs', async () => {
      login.mockResolvedValue({ accessToken: 'jwt', user });
      const fixture = await render();
      await submitPassword(fixture);
      expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'correct horse battery' });
    });

    it('redirige vers /dashboard après une connexion réussie sans returnTo', async () => {
      login.mockResolvedValue({ accessToken: 'jwt', user });
      const fixture = await render();
      await submitPassword(fixture);
      expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
    });

    it('suit un returnTo sûr après la connexion', async () => {
      login.mockResolvedValue({ accessToken: 'jwt', user });
      const fixture = await render('returnTo=%2Fsettings%2Fsessions');
      await submitPassword(fixture);
      expect(navigate).toHaveBeenCalledWith('/settings/sessions', { replaceUrl: true });
    });

    it('ignore un returnTo dangereux (open redirect)', async () => {
      login.mockResolvedValue({ accessToken: 'jwt', user });
      const fixture = await render('returnTo=%2F%09%2Fevil.com');
      await submitPassword(fixture);
      expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. ÉCHECS DE CONNEXION (erreurs API)
  // ══════════════════════════════════════════════════════════════════════════

  describe('échecs de connexion', () => {
    it('affiche le message d'erreur de l'API et vide le champ mot de passe', async () => {
      login.mockRejectedValue(new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS'));
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      expect(el(root, '.form-error-banner').textContent).toContain('Invalid email or password.');
      expect(el<HTMLInputElement>(root, '#password').value).toBe('');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('n'affiche plus l'erreur précédente après une nouvelle tentative', async () => {
      login
        .mockRejectedValueOnce(new ApiError(401, 'Identifiants incorrects.', 'INVALID_CREDENTIALS'))
        .mockResolvedValueOnce({ accessToken: 'jwt', user });
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      expect(el(root, '.form-error-banner')).toBeTruthy();

      // Deuxième tentative réussie
      await submitPassword(fixture);
      expect(navigate).toHaveBeenCalled();
    });

    it('propose un lien de renvoi pour un compte non vérifié', async () => {
      login.mockRejectedValue(new ApiError(403, 'Email not verified.', 'EMAIL_NOT_VERIFIED'));
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      const links = all<HTMLAnchorElement>(root, 'a');
      const resend = links.find((a) => a.textContent?.trim() === 'Renvoyer le courriel de vérification');
      expect(resend?.getAttribute('href')).toBe('/resend-verification?email=ada%40example.com');
    });

    it('encode correctement l'email dans le lien de renvoi', async () => {
      login.mockRejectedValue(new ApiError(403, 'Email not verified.', 'EMAIL_NOT_VERIFIED'));
      const fixture = await render();
      await submitPassword(fixture, 'user+tag@example.org', 'password1');

      const root = fixture.nativeElement as HTMLElement;
      const links = all<HTMLAnchorElement>(root, 'a');
      const resend = links.find((a) => a.textContent?.trim() === 'Renvoyer le courriel de vérification');
      expect(resend?.getAttribute('href')).toBe(
        '/resend-verification?email=user%2Btag%40example.org',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. AFFORDANCE « AFFICHER / MASQUER LE MOT DE PASSE »
  // ══════════════════════════════════════════════════════════════════════════

  describe('affichage du mot de passe', () => {
    it('bascule le type en « text » quand on clique sur Afficher', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      const toggle = el<HTMLButtonElement>(root, '.password-toggle');
      toggle.click();
      fixture.detectChanges();
      expect(el<HTMLInputElement>(root, '#password').type).toBe('text');
    });

    it('rebascule en « password » au second clic', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      const toggle = el<HTMLButtonElement>(root, '.password-toggle');
      toggle.click();
      fixture.detectChanges();
      toggle.click();
      fixture.detectChanges();
      expect(el<HTMLInputElement>(root, '#password').type).toBe('password');
    });

    it('met à jour aria-pressed sur le bouton toggle', async () => {
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      const toggle = el<HTMLButtonElement>(root, '.password-toggle');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. ÉTAT DE SOUMISSION (loading / disabled)
  // ══════════════════════════════════════════════════════════════════════════

  describe('état de soumission', () => {
    it('affiche « Connexion… » et désactive le bouton pendant la requête', async () => {
      let resolve!: (value: unknown) => void;
      login.mockReturnValue(new Promise((r) => (resolve = r)));

      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#email'), 'ada@example.com');
      type(el(root, '#password'), 'secret');
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      fixture.detectChanges();

      const btn = el<HTMLButtonElement>(root, 'button[type="submit"]');
      expect(btn.textContent?.trim()).toBe('Connexion…');
      expect(btn.disabled).toBe(true);

      // Finalise la promesse pour ne pas laisser la suite en attente
      resolve({ accessToken: 'jwt', user });
      await fixture.whenStable();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. UTILISATEUR DÉJÀ CONNECTÉ
  // ══════════════════════════════════════════════════════════════════════════

  describe('utilisateur déjà connecté', () => {
    it('ne montre pas le formulaire et redirige immédiatement', async () => {
      status.set('authenticated');
      const fixture = await render();
      expect(el((fixture.nativeElement as HTMLElement), '#password')).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. DOUBLE FACTEUR (MFA)
  // ══════════════════════════════════════════════════════════════════════════

  describe('authentification à deux facteurs (MFA)', () => {
    it('affiche l'écran de vérification après un challenge MFA', async () => {
      login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      expect(el(root, 'h1').textContent).toBe('Vérification');
      expect(el(root, '#code')).toBeTruthy();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('valide le code MFA et redirige', async () => {
      login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
      completeMfa.mockResolvedValue(user);
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#code'), '123456');
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();

      expect(completeMfa).toHaveBeenCalledWith('challenge-1', '123456');
      expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
    });

    it('affiche le message d'erreur et retourne à l'étape mot de passe si le code MFA est rejeté', async () => {
      login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
      completeMfa.mockRejectedValue(new ApiError(401, 'Invalid code.', 'MFA_INVALID'));
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#code'), '000000');
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();

      expect(el(root, '.form-error-banner').textContent).toContain("n'a pas été accepté");
      expect(el(root, 'h1').textContent).toBe('Connexion');
      expect(el(root, '#code')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('affiche le bouton « Retour à la connexion » sur l'écran MFA', async () => {
      login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      const back = all<HTMLButtonElement>(root, 'button').find((b) =>
        b.textContent?.includes('Retour'),
      );
      expect(back).toBeTruthy();
    });

    it('revient à l'étape mot de passe si on clique sur Retour', async () => {
      login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      const back = all<HTMLButtonElement>(root, 'button').find((b) =>
        b.textContent?.includes('Retour'),
      )!;
      back.click();
      await fixture.whenStable();

      expect(el(root, 'h1').textContent).toBe('Connexion');
      expect(el(root, '#password')).toBeTruthy();
      expect(el(root, '#code')).toBeNull();
    });

    it('affiche une erreur si le code MFA est trop court', async () => {
      login.mockResolvedValue({ mfaRequired: true, mfaChallengeToken: 'challenge-1' });
      const fixture = await render();
      await submitPassword(fixture);

      const root = fixture.nativeElement as HTMLElement;
      type(el(root, '#code'), '12');
      el<HTMLButtonElement>(root, 'button[type="submit"]').click();
      await fixture.whenStable();

      expect(el(root, '#code-error').textContent).toContain('6');
      expect(completeMfa).not.toHaveBeenCalled();
    });
  });
});
