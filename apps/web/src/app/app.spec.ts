import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AdminApi } from './core/api/admin-api';
import { AuthApi } from './core/api/auth-api';
import { MfaApi } from './core/api/mfa-api';
import { SessionsApi } from './core/api/sessions-api';
import type { DashboardContext, User } from './core/api/types';
import { AuthService, type AuthStatus } from './core/auth/auth.service';
import { MIGRATED_ROUTES, WORKSPACE_NAV } from './core/navigation/workspace-nav';
import { routes } from './app.routes';

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

describe('application routes', () => {
  let status: ReturnType<typeof signal<AuthStatus>>;
  let user: ReturnType<typeof signal<User | null>>;

  let adminApi: Record<'fetchAdminOverview' | 'fetchAdminUsers' | 'fetchAuditEvents' | 'fetchAdminUser', ReturnType<typeof vi.fn>>;

  let listSessions: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    status = signal<AuthStatus>('unauthenticated');
    user = signal<User | null>(null);
    listSessions = vi.fn().mockResolvedValue([]);
    adminApi = {
      fetchAdminOverview: vi.fn().mockResolvedValue({
        users: { total: 0, active: 0, pending: 0, suspended: 0, deactivated: 0, verified: 0, mfaEnabled: 0 },
        recentEvents: [],
        eventTotals: { windowDays: 7, items: [] },
      }),
      fetchAdminUsers: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      fetchAuditEvents: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
      fetchAdminUser: vi.fn().mockResolvedValue({
        user: investor,
        security: { locked: false, activeSessions: 1 },
        auditSummary: [],
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"ok","database":"up"}', { status: 200 })));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: AuthService, useValue: { status, user, login: vi.fn(), refreshUser: vi.fn() } },
        { provide: AdminApi, useValue: adminApi },
        { provide: SessionsApi, useValue: { listSessions } },
        { provide: MfaApi, useValue: { mfaStatus: vi.fn() } },
      ],
    });
    vi.spyOn(TestBed.inject(AuthApi), 'fetchDashboardContext').mockResolvedValue({
      requiredActions: [],
    } as unknown as DashboardContext);
  });

  afterEach(() => vi.unstubAllGlobals());

  async function settle(harness: RouterTestingHarness) {
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
  }

  it('sends a signed-out visitor of a protected page to sign-in with a safe returnTo', async () => {
    const harness = await RouterTestingHarness.create('/settings/profile');
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/login?returnTo=%2Fsettings%2Fprofile');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Se connecter');
  });

  it('shows "Checking session…" while the session is being restored', async () => {
    status.set('loading');
    const harness = await RouterTestingHarness.create('/settings/profile');
    expect(harness.routeNativeElement?.textContent).toContain('Vérification de la session…');
  });

  it('renders the profile page inside the workspace shell for a signed-in user', async () => {
    status.set('authenticated');
    user.set(investor);
    const harness = await RouterTestingHarness.create('/settings');
    await settle(harness);
    const root = harness.routeNativeElement as HTMLElement;
    expect(TestBed.inject(Router).url).toBe('/settings/profile');
    expect(Array.from(root.querySelectorAll('.breadcrumb li')).map((li) => li.textContent)).toEqual(['Compte', 'Profil']);
    expect(root.querySelector('#profile-heading')?.textContent).toBe('Profil et préférences');
    expect((root.querySelector('#firstName') as HTMLInputElement).value).toBe('Ada');
    expect(root.querySelector('[aria-current="page"].nav-link')?.textContent?.trim()).toBe('Profil');
  });

  it('states plainly, in French, that an unregistered workspace screen is not part of the active application', async () => {
    const pending = WORKSPACE_NAV.flatMap((g) => g.items).find((i) => !MIGRATED_ROUTES.includes(i.href) && !i.href.startsWith('/settings/'));
    if (!pending) return;
    status.set('authenticated');
    user.set(investor);
    const harness = await RouterTestingHarness.create(`${pending.href}/detail`);
    await settle(harness);
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toBe(pending.label);
    expect(root.textContent).toContain("Ce chemin ne fait pas partie de l'application active.");
  });

  it('hides the administration group from investors', async () => {
    status.set('authenticated');
    user.set(investor);
    const harness = await RouterTestingHarness.create('/settings/profile');
    await settle(harness);
    expect((harness.routeNativeElement as HTMLElement).textContent).not.toContain('Administration');
  });

  it('uses the public layout for unmigrated public pages', async () => {
    const harness = await RouterTestingHarness.create('/legal/terms');
    await settle(harness);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Pas encore disponible');
  });

  describe('migrated identity screens', () => {
    const publicPages: [string, string][] = [
      ['/register', 'Créez votre compte'],
      ['/verify-email', 'Vérifiez votre courriel'],
      ['/resend-verification', 'Renvoyer la vérification'],
      ['/forgot-password', 'Mot de passe oublié'],
      ['/reset-password', 'Réinitialiser le mot de passe'],
      ['/confirm-email-change', 'Confirmez votre nouveau courriel'],
      ['/unauthorized', 'Accès refusé'],
    ];

    it.each(publicPages)('renders the real %s page', async (path, heading) => {
      const harness = await RouterTestingHarness.create(path);
      await settle(harness);
      const root = harness.routeNativeElement as HTMLElement;
      expect(root.querySelector('h1')?.textContent).toBe(heading);
      expect(root.textContent).not.toContain('has not been migrated');
      expect(TestBed.inject(Router).url).toBe(path);
    });

    it.each([
      ['/settings/security', 'Changer le mot de passe', 'Sécurité'],
      ['/settings/sessions', 'Connexions actives', 'Sessions'],
    ])('renders the real %s settings tab', async (path, heading, tab) => {
      status.set('authenticated');
      user.set(investor);
      const harness = await RouterTestingHarness.create(path);
      await settle(harness);
      const root = harness.routeNativeElement as HTMLElement;
      expect(Array.from(root.querySelectorAll('h2')).map((h) => h.textContent)).toContain(heading);
      expect(root.textContent).not.toContain('has not been migrated');
      expect(root.querySelector('[aria-current="page"].nav-link')?.textContent?.trim()).toBe(tab);
    });

    it('does not create a protected page, or load its data, before access is confirmed', async () => {
      const harness = await RouterTestingHarness.create('/settings/sessions');
      await settle(harness);
      expect(TestBed.inject(Router).url).toBe('/login?returnTo=%2Fsettings%2Fsessions');
      expect(listSessions).not.toHaveBeenCalled();
    });
  });

  describe('administration guard', () => {
    const admin: User = { ...investor, id: 'admin-1', role: 'ADMIN', mfaEnabled: true };

    it('shows "Checking session…" while the session is being restored', async () => {
      status.set('loading');
      const harness = await RouterTestingHarness.create('/admin');
      expect(harness.routeNativeElement?.textContent).toContain('Vérification de la session…');
      expect(harness.routeNativeElement?.textContent).not.toContain('Administration de la plateforme');
    });

    it('sends a signed-out visitor to sign-in with the admin path as returnTo', async () => {
      const harness = await RouterTestingHarness.create('/admin/users?q=ada');
      await settle(harness);
      expect(TestBed.inject(Router).url).toBe('/login?returnTo=%2Fadmin%2Fusers%3Fq%3Dada');
      expect(adminApi.fetchAdminUsers).not.toHaveBeenCalled();
    });

    it('sends an investor to the access-denied page', async () => {
      status.set('authenticated');
      user.set(investor);
      const harness = await RouterTestingHarness.create('/admin/audit');
      await settle(harness);
      expect(TestBed.inject(Router).url).toBe('/unauthorized');
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Accès refusé');
      expect(adminApi.fetchAuditEvents).not.toHaveBeenCalled();
    });

    it('sends an administrator with an unverified email to resend verification', async () => {
      status.set('authenticated');
      user.set({ ...admin, emailVerified: false, status: 'PENDING_VERIFICATION' });
      const harness = await RouterTestingHarness.create('/admin');
      await settle(harness);
      expect(TestBed.inject(Router).url).toBe('/resend-verification');
      expect(adminApi.fetchAdminOverview).not.toHaveBeenCalled();
    });

    it('sends a suspended administrator to the access-denied page', async () => {
      status.set('authenticated');
      user.set({ ...admin, status: 'SUSPENDED' });
      const harness = await RouterTestingHarness.create('/admin');
      await settle(harness);
      expect(TestBed.inject(Router).url).toBe('/unauthorized');
    });

    it.each([
      ['/admin', 'Plateforme', "Vue d'ensemble de la plateforme"],
      ['/admin/users', 'Utilisateurs', 'Comptes utilisateurs'],
      ['/admin/users/u1', 'Utilisateurs', 'Ada Lovelace'],
      ['/admin/audit', "Journal d'audit", "Journal d'audit"],
    ])('renders %s for an administrator', async (path, tab, heading) => {
      status.set('authenticated');
      user.set(admin);
      const harness = await RouterTestingHarness.create(path);
      await settle(harness);
      const root = harness.routeNativeElement as HTMLElement;
      expect(TestBed.inject(Router).url).toBe(path);
      expect(root.querySelector('h1')?.textContent).toBe('Administration de la plateforme');
      expect(root.querySelector('nav.subnav [aria-current="page"]')?.textContent?.trim()).toBe(tab);
      expect(root.querySelector('h2')?.textContent?.trim()).toBe(heading);
      expect(root.textContent).toContain('Administration');
    });
  });
});
