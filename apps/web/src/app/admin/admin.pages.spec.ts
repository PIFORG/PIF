import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AdminApi } from '../core/api/admin-api';
import { ApiError, type AdminUserDetail, type AdminUserListItem, type User } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { AdminAuditPage } from './audit/admin-audit.page';
import { AdminOverviewPage } from './overview/admin-overview.page';
import { AdminUserDetailPage } from './user-detail/admin-user-detail.page';
import { AdminUsersPage } from './users/admin-users.page';

const admin: User = {
  id: 'admin-1',
  email: 'root@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  role: 'ADMIN',
  experienceLevel: 'ADVANCED',
  emailVerified: true,
  status: 'ACTIVE',
  mfaEnabled: true,
  createdAt: '2026-01-02T10:00:00.000Z',
  lastLoginAt: null,
  preferences: null,
};

const target: User = { ...admin, id: 'u-7', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', role: 'INVESTOR', mfaEnabled: false };

const listItem: AdminUserListItem = {
  id: 'u-7',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'INVESTOR',
  status: 'ACTIVE',
  emailVerified: true,
  mfaEnabled: false,
  experienceLevel: 'BEGINNER',
  createdAt: '2026-01-02T10:00:00.000Z',
  lastLoginAt: null,
};

function detail(user: User = target): AdminUserDetail {
  return { user, security: { locked: false, activeSessions: 2 }, auditSummary: [] };
}

describe('administration pages', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let user: ReturnType<typeof signal<User | null>>;

  beforeEach(() => {
    api = {
      fetchAdminOverview: vi.fn(),
      fetchAdminUsers: vi.fn().mockResolvedValue({ items: [listItem], total: 41, page: 1, pageSize: 20 }),
      fetchAuditEvents: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
      fetchAdminUser: vi.fn().mockResolvedValue(detail()),
      updateAdminUserStatus: vi.fn(),
      updateAdminUserRole: vi.fn(),
    };
    user = signal<User | null>(admin);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'admin', component: AdminOverviewPage },
          { path: 'admin/users', component: AdminUsersPage },
          { path: 'admin/users/:id', component: AdminUserDetailPage },
          { path: 'admin/audit', component: AdminAuditPage },
        ]),
        { provide: AdminApi, useValue: api },
        { provide: AuthService, useValue: { user } },
      ],
    });
  });

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    await settle(harness);
    return harness;
  }

  async function settle(harness: RouterTestingHarness) {
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
  }

  function root(harness: RouterTestingHarness): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function button(scope: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function choose(select: HTMLSelectElement, value: string) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }

  it('shows the platform overview tiles and recent events', async () => {
    api['fetchAdminOverview'].mockResolvedValue({
      users: { total: 12, active: 9, pending: 1, suspended: 1, deactivated: 1, verified: 10, mfaEnabled: 3 },
      recentEvents: [{ id: 'e1', eventType: 'LOGIN_SUCCESS', outcome: 'SUCCESS', createdAt: '2026-11-10T09:00:00.000Z' }],
      eventTotals: { windowDays: 7, items: [{ eventType: 'LOGIN_FAILURE', outcome: 'FAILURE', count: 4 }] },
    });
    const harness = await open('/admin');
    const tiles = Array.from(root(harness).querySelectorAll('.stat-tile')).map(
      (t) => `${t.querySelector('.label')?.textContent}=${t.querySelector('.value')?.textContent}`,
    );
    expect(tiles).toEqual([
      'Utilisateurs au total=12',
      'Actifs=9',
      'Vérification en attente=1',
      'Suspendus=1',
      'Désactivés=1',
      'Courriels vérifiés=10',
      'Vérification en deux étapes activée=3',
    ]);
    expect(root(harness).textContent).toContain('Événements des 7 derniers jours');
    expect(root(harness).textContent).toContain('LOGIN_FAILURE · FAILURE · 4');
    expect(root(harness).textContent).toContain('LOGIN_SUCCESS · SUCCESS ·');
  });

  it('explains when the overview is locked behind MFA enrolment', async () => {
    api['fetchAdminOverview'].mockRejectedValue(new ApiError(403, 'MFA required', 'ADMIN_MFA_REQUIRED'));
    const harness = await open('/admin');
    expect(root(harness).querySelector('.form-error-banner')?.textContent).toContain(
      "Les outils d'administration nécessitent la vérification en deux étapes.",
    );
  });

  describe('users', () => {
    it('loads the first page, filters and paginates', async () => {
      const harness = await open('/admin/users');
      expect(api['fetchAdminUsers']).toHaveBeenLastCalledWith({
        q: undefined,
        status: '',
        role: '',
        emailVerified: '',
        page: 1,
        pageSize: 20,
      });
      expect(root(harness).querySelector('tbody tr td')?.textContent).toBe('Ada Lovelace');
      expect(root(harness).querySelector('a[href="/admin/users/u-7"]')?.textContent).toBe('Voir');
      expect(root(harness).textContent).toContain('Page 1 sur 3 (41 au total)');

      button(root(harness), 'Suivant').click();
      await settle(harness);
      expect(api['fetchAdminUsers']).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

      choose(root(harness).querySelectorAll('select')[0] as HTMLSelectElement, 'SUSPENDED');
      await settle(harness);
      expect(api['fetchAdminUsers']).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'SUSPENDED', page: 1 }));
    });

    it('debounces the search box and applies it immediately on submit', async () => {
      const harness = await open('/admin/users');
      const calls = api['fetchAdminUsers'].mock.calls.length;
      const search = root(harness).querySelector('input[type="search"]') as HTMLInputElement;

      type(search, ' ada ');
      await settle(harness);
      expect(api['fetchAdminUsers'].mock.calls.length).toBe(calls);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await settle(harness);
      expect(api['fetchAdminUsers']).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ada', page: 1 }));

      type(search, 'grace');
      await settle(harness);
      (root(harness).querySelector('form[role="search"]') as HTMLFormElement).dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await settle(harness);
      expect(api['fetchAdminUsers']).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'grace', page: 1 }));
    });

    it('shows both empty-state messages when nothing matches', async () => {
      api['fetchAdminUsers'].mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      const harness = await open('/admin/users');
      expect(root(harness).textContent).toContain('Aucun utilisateur ne correspond aux filtres actuels.');
      expect(root(harness).textContent).toContain('Aucun compte ne correspond à ces filtres.');
      expect(root(harness).querySelector('nav[aria-label="Pagination"]')).toBeNull();
    });
  });

  describe('user detail', () => {
    it('requires a reason, then changes the status after confirmation', async () => {
      api['updateAdminUserStatus'].mockResolvedValue(detail({ ...target, status: 'SUSPENDED' }));
      const harness = await open('/admin/users/u-7');
      const page = root(harness);
      expect(api['fetchAdminUser']).toHaveBeenCalledWith('u-7');
      expect(page.querySelector('h2')?.textContent?.trim()).toBe('Ada Lovelace');
      expect(page.textContent).toContain('Non verrouillé · 2 sessions actives · vérification en deux étapes désactivée');

      const [statusForm] = Array.from(page.querySelectorAll('form'));
      choose(statusForm.querySelector('select') as HTMLSelectElement, 'SUSPENDED');
      type(statusForm.querySelector('input') as HTMLInputElement, 'no');
      await settle(harness);
      statusForm.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(harness);
      expect(page.querySelector('.form-error-banner')?.textContent).toContain(
        "Indiquez un motif d'au moins 3 caractères. Il est consigné dans le journal d'audit.",
      );
      expect(page.querySelector('[role="alertdialog"]')).toBeNull();

      type(statusForm.querySelector('input') as HTMLInputElement, '  Fraud review  ');
      await settle(harness);
      statusForm.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(harness);
      const dialog = page.querySelector('[role="alertdialog"]') as HTMLElement;
      expect(dialog.querySelector('h2')?.textContent).toBe('Définir le statut sur Suspendu ?');

      button(dialog, 'Changer le statut').click();
      await settle(harness);
      expect(api['updateAdminUserStatus']).toHaveBeenCalledWith('u-7', { status: 'SUSPENDED', reason: 'Fraud review' });
      expect(page.querySelector('.form-success-banner')?.textContent).toContain(
        "Statut du compte défini sur Suspendu. L'utilisateur a été notifié par courriel.",
      );
      expect((statusForm.querySelector('input') as HTMLInputElement).value).toBe('');
    });

    it('changes the role after password and authenticator step-up', async () => {
      api['updateAdminUserRole'].mockResolvedValue(detail({ ...target, role: 'ADMIN' }));
      const harness = await open('/admin/users/u-7');
      const page = root(harness);
      const roleForm = Array.from(page.querySelectorAll('form'))[1];
      choose(roleForm.querySelector('select') as HTMLSelectElement, 'ADMIN');
      await settle(harness);
      roleForm.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(harness);

      const dialog = page.querySelector('[role="alertdialog"]') as HTMLElement;
      expect(dialog.querySelector('h2')?.textContent).toBe('Faire de ce compte un administrateur ?');
      type(dialog.querySelector('#role-change-password') as HTMLInputElement, 'secret');
      type(dialog.querySelector('#role-change-totp') as HTMLInputElement, '246810');
      await settle(harness);
      button(dialog, 'Changer le rôle').click();
      await settle(harness);

      expect(api['updateAdminUserRole']).toHaveBeenCalledWith('u-7', { role: 'ADMIN', password: 'secret', totpCode: '246810' });
      expect(page.querySelector('.form-success-banner')?.textContent).toContain(
        "Rôle mis à jour. Le compte doit se reconnecter pour que le changement s'applique partout.",
      );
    });

    it('locks the forms on the administrator’s own account', async () => {
      api['fetchAdminUser'].mockResolvedValue(detail(admin));
      const harness = await open('/admin/users/admin-1');
      const page = root(harness);
      expect(page.textContent).toContain(
        "Il s'agit de votre propre compte. Les administrateurs ne peuvent pas modifier leur propre statut ou rôle",
      );
      expect(Array.from(page.querySelectorAll('fieldset')).every((f) => f.disabled)).toBe(true);
    });
  });

  describe('audit log', () => {
    it('validates filters before querying', async () => {
      const harness = await open('/admin/audit');
      const page = root(harness);
      const form = page.querySelector('form') as HTMLFormElement;
      const [eventType, subject] = Array.from(form.querySelectorAll('input:not([type])')) as HTMLInputElement[];

      type(eventType, 'login-failure');
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(harness);
      expect(page.querySelector('.form-error-banner')?.textContent).toContain(
        "Les types d'événement utilisent des majuscules et des underscores, ex. LOGIN_FAILURE.",
      );

      type(eventType, 'login_failure');
      type(subject, 'not-a-uuid');
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(harness);
      expect(page.querySelector('.form-error-banner')?.textContent).toContain("L'ID du compte doit être un UUID complet.");

      type(subject, '');
      type(form.querySelector('input[type="date"]') as HTMLInputElement, '2026-11-10');
      type(form.querySelectorAll('input[type="date"]')[1] as HTMLInputElement, '2026-11-01');
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(harness);
      expect(page.querySelector('.form-error-banner')?.textContent).toContain(
        'La date de début doit être antérieure à la date de fin.',
      );
      expect(api['fetchAuditEvents']).toHaveBeenCalledTimes(1);
    });

    it('applies normalised filters with day boundaries and clears them', async () => {
      api['fetchAuditEvents'].mockResolvedValue({
        items: [
          {
            id: 'e1',
            eventType: 'LOGIN_FAILURE',
            outcome: 'FAILURE',
            actorUserId: null,
            subjectUserId: 'u-7',
            correlationId: 'c-1',
            createdAt: '2026-11-10T09:00:00.000Z',
            context: { reason: 'bad_password', attempt: 2 },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      });
      const harness = await open('/admin/audit');
      const page = root(harness);
      expect(api['fetchAuditEvents']).toHaveBeenLastCalledWith({
        eventType: undefined,
        outcome: '',
        subjectUserId: undefined,
        from: undefined,
        to: undefined,
        page: 1,
        pageSize: 25,
      });
      expect(page.textContent).toContain('reason: bad_password, attempt: 2');
      expect(page.textContent).toContain('Page 1 sur 1 (1 événements)');

      const form = page.querySelector('form') as HTMLFormElement;
      type(form.querySelector('input:not([type])') as HTMLInputElement, ' login_failure ');
      choose(form.querySelector('select') as HTMLSelectElement, 'FAILURE');
      type(form.querySelectorAll('input[type="date"]')[0] as HTMLInputElement, '2026-11-01');
      type(form.querySelectorAll('input[type="date"]')[1] as HTMLInputElement, '2026-11-10');
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(harness);

      expect(api['fetchAuditEvents']).toHaveBeenLastCalledWith({
        eventType: 'LOGIN_FAILURE',
        outcome: 'FAILURE',
        subjectUserId: undefined,
        from: new Date('2026-11-01T00:00:00.000').toISOString(),
        to: new Date('2026-11-10T23:59:59.999').toISOString(),
        page: 1,
        pageSize: 25,
      });

      const liveForm = page.querySelector('form') as HTMLFormElement;
      const clear = liveForm.querySelector<HTMLButtonElement>('button[type="button"].btn-ghost');
      expect(clear?.textContent?.trim()).toBe('Effacer');
      clear!.click();
      await settle(harness);
      expect(api['fetchAuditEvents']).toHaveBeenLastCalledWith(expect.objectContaining({ eventType: undefined, outcome: '' }));
      expect((page.querySelector('form input:not([type])') as HTMLInputElement).value).toBe('');
    });
  });
});
