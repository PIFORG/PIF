import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { StoriesApi } from '../core/api/stories-api';
import type { User } from '../core/api/types';
import { AuthService, type AuthStatus } from '../core/auth/auth.service';
import { routes } from '../app.routes';
import { MODULES, PREVIEW_MODULE_ROUTES } from './module-catalog';

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

describe('routes ported from the landing page, FinStories and the module previews', () => {
  let status: ReturnType<typeof signal<AuthStatus>>;
  let user: ReturnType<typeof signal<User | null>>;

  async function open(path: string) {
    const harness = await RouterTestingHarness.create(path);
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
    }
    return harness.routeNativeElement as HTMLElement;
  }

  beforeEach(() => {
    status = signal<AuthStatus>('authenticated');
    user = signal<User | null>(investor);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"ok","database":"up"}', { status: 200 })));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: AuthService, useValue: { status, user, logout: vi.fn(), refreshUser: vi.fn() } },
        {
          provide: StoriesApi,
          useValue: { feed: vi.fn().mockResolvedValue({ weakestCompetency: null, stories: [] }), story: vi.fn(), progress: vi.fn() },
        },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('serves the landing page at / to signed-out visitors', async () => {
    status.set('unauthenticated');
    user.set(null);
    const root = await open('/');
    expect(root.querySelector('#hero-title')?.textContent).toBe('Les marchés financiers, sans le risque du monde réel.');
    expect(root.textContent).not.toContain('Not available yet');
  });

  it.each(PREVIEW_MODULE_ROUTES)('renders the /%s module preview inside the workspace shell', async (slug) => {
    const root = await open(`/${slug}`);
    expect(TestBed.inject(Router).url).toBe(`/${slug}`);
    expect(root.querySelector('h1')?.textContent).toBe(MODULES[slug].title);
    expect(root.querySelector('.mp-notice')?.textContent).toContain('Designed, not yet connected.');
    expect(root.textContent).not.toContain('has not been migrated');
  });

  it('renders FinStories inside the workspace shell', async () => {
    const root = await open('/stories?story=x');
    expect(root.querySelector('h1')?.textContent).toBe('Histoires financières');
    expect(root.querySelector('.ws-emptyTitle')?.textContent).toBe('Aucune histoire pour le moment');
    expect(Array.from(root.querySelectorAll('.breadcrumb li')).map((li) => li.textContent)).toEqual(['Apprentissage', 'Histoires financières']);
    expect(root.querySelector('a.link[aria-current="page"] .linkLabel')?.textContent).toBe('Histoires financières');
  });
});
