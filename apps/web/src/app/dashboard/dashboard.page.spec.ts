import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthApi } from '../core/api/auth-api';
import { LearningApi, type LearningProfile } from '../core/api/learning-api';
import { SessionsApi } from '../core/api/sessions-api';
import { ApiError, type AuthSession, type DashboardContext, type User } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { SAMPLE_CURRENCY, SAMPLE_DATA_NOTICE, sampleSummary } from '../core/demo/sample-workspace';
import { formatMoney } from '../core/format/finance';
import { DashboardPage, greetingForHour } from './dashboard.page';

const investor: User = {
  id: 'u1',
  email: 'ada@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'INVESTOR',
  experienceLevel: 'BEGINNER',
  emailVerified: true,
  status: 'ACTIVE',
  mfaEnabled: false,
  createdAt: '2026-11-01T09:00:00.000Z',
  lastLoginAt: null,
  preferences: null,
};

const session: AuthSession = {
  id: 's1',
  createdAt: '2026-11-01T09:00:00.000Z',
  lastSeenAt: '2026-11-10T09:00:00.000Z',
  expiresAt: '2026-12-01T09:00:00.000Z',
  userAgent: null,
  deviceLabel: 'Work laptop',
  current: true,
};

function learningProfile(overrides: Partial<LearningProfile> = {}): LearningProfile {
  return {
    experienceLevel: 'BEGINNER',
    unlockedLevel: 'STRATEGIST',
    competencies: [],
    stats: { missionsPassed: 3, missionsAttempted: 4, assessedSessions: 5, implementedMissions: 5, playableMissions: 10 },
    activeSessions: [
      { id: 'r-1', kind: 'REPLAY', missionSlug: 'my-first-trade', missionTitle: 'My First Trade', currentStep: 2, updatedAt: '2026-11-09T09:00:00.000Z' },
      { id: 's-7', kind: 'MISSION', missionSlug: 'breaking-news', missionTitle: 'Breaking News', currentStep: 4, updatedAt: '2026-11-10T09:00:00.000Z' },
    ],
    recentAssessments: [],
    recommendations: [
      { slug: 'protect-your-capital', title: 'Protect Your Capital', level: 'ROOKIE', reason: 'Builds Risk Management, your weakest competency.' },
      { slug: 'diversify', title: 'Diversify', level: 'STRATEGIST', reason: 'Spreads risk.' },
    ],
    calibration: { ratedOrders: 0, observations: 0, minimumOrders: 10, interpretable: false, brierScore: null, meanConfidence: null, hitRate: null, signals: 0, note: '' },
    ...overrides,
  };
}

function context(overrides: Partial<DashboardContext> = {}): DashboardContext {
  return {
    user: investor,
    role: 'INVESTOR',
    experienceLevel: 'BEGINNER',
    experienceLevelNotice: 'Missions start at the beginner level.',
    capabilities: {},
    requiredActions: [],
    modules: [
      { id: 'portfolio', label: 'Portfolios', permitted: true, available: true },
      { id: 'ai', label: 'AI insights', permitted: true, available: false },
      { id: 'admin', label: 'Administration', permitted: false, available: true },
    ],
    ...overrides,
  };
}

describe('Dashboard page', () => {
  let user: ReturnType<typeof signal<User | null>>;
  let fetchDashboardContext: ReturnType<typeof vi.fn>;
  let listSessions: ReturnType<typeof vi.fn>;
  let profile: ReturnType<typeof vi.fn>;

  async function settle<T>(fixture: ComponentFixture<T>) {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  }

  async function render() {
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user } },
        { provide: AuthApi, useValue: { fetchDashboardContext } },
        { provide: SessionsApi, useValue: { listSessions } },
        { provide: LearningApi, useValue: { profile } },
      ],
    });
    const fixture = TestBed.createComponent(DashboardPage);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  function kpiValue(root: HTMLElement, label: string): HTMLElement | null | undefined {
    return Array.from(root.querySelectorAll<HTMLElement>('.ws-kpi'))
      .find((k) => k.querySelector('.ws-kpiLabel')?.textContent === label)
      ?.querySelector('.ws-kpiValue');
  }

  beforeEach(() => {
    user = signal<User | null>(investor);
    fetchDashboardContext = vi.fn().mockResolvedValue(context());
    listSessions = vi.fn().mockResolvedValue([session]);
    profile = vi.fn().mockResolvedValue(learningProfile());
  });

  it('greets by the local hour', () => {
    expect(greetingForHour(new Date(2026, 10, 11, 8))).toBe('Bonjour');
    expect(greetingForHour(new Date(2026, 10, 11, 13))).toBe('Bon après-midi');
    expect(greetingForHour(new Date(2026, 10, 11, 21))).toBe('Bonsoir');
  });

  it('shows live account data and no simulated figures by default', async () => {
    const { root } = await render();
    expect(root.querySelector('h1')?.textContent).toBe('Bon retour, Ada');
    expect(root.querySelector('.db-identity')?.textContent).toContain('contenu pédagogique');
    expect(kpiValue(root, 'Valeur du portefeuille simulé')?.textContent).toContain('pas encore disponible');
    expect(kpiValue(root, 'Sessions actives')?.textContent?.trim()).toBe('1');
    expect(root.querySelector('[data-demo="true"]')).toBeNull();
    expect(root.textContent).not.toContain(SAMPLE_DATA_NOTICE);
    expect(root.querySelector('#devices')?.textContent).toContain('Work laptop');
  });

  it('labels the sample workspace on every surface that shows it', async () => {
    const { fixture, root } = await render();
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes("Explorer l'espace d'exemple"))!.click();
    await fixture.whenStable();
    expect(root.querySelector('.db-sampleBanner')?.textContent).toContain(SAMPLE_DATA_NOTICE);
    const demoPanels = Array.from(root.querySelectorAll<HTMLElement>('section[data-demo="true"]'));
    expect(demoPanels.map((p) => p.id)).toEqual(['performance', 'watchlist', 'allocation', 'positions']);
    for (const panel of demoPanels) expect(panel.querySelector('.ws-demo')).not.toBeNull();
    expect(kpiValue(root, 'Valeur du portefeuille simulé')?.textContent?.trim()).toBe(formatMoney(sampleSummary().equity, SAMPLE_CURRENCY));
  });

  it('shows learning progress, the mission in progress and the next briefings from the learning profile', async () => {
    const { root } = await render();
    expect(profile).toHaveBeenCalledTimes(1);
    const learning = root.querySelector('#learning')!;
    expect(learning.querySelector('.ws-status')?.getAttribute('data-status')).toBe('LIVE_INTEGRATED');
    expect(learning.querySelector('.db-progress')?.textContent).toContain('3 sur 10 missions réussies');
    expect(learning.querySelector<HTMLElement>('.db-progressTrack span')?.style.width).toBe('30%');
    const items = Array.from(learning.querySelectorAll('.db-sessionList li'));
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Breaking News');
    expect(items[0].textContent).toContain('En cours · jour 4');
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/learn/sessions/s-7');
    expect(items[1].textContent).toContain('Trader débutant · Builds Risk Management, your weakest competency.');
    expect(items[1].querySelector('a')?.textContent).toBe('Briefing');
    expect(items[1].querySelector('a')?.getAttribute('href')).toBe('/learn/missions/protect-your-capital');
    expect(items[2].textContent).toContain('Niveau recommandé :');
    expect(items[2].textContent).toContain('Voir une histoire financière');
    expect(items[2].querySelector('a')?.getAttribute('href')).toBe('/stories');
    expect(learning.textContent).not.toContain('not migrated');
  });

  it('offers two briefings when no mission is in progress', async () => {
    profile.mockResolvedValue(learningProfile({ activeSessions: [] }));
    const { root } = await render();
    const briefs = Array.from(root.querySelectorAll('#learning .db-sessionList a.btn')).map((a) => a.getAttribute('href'));
    expect(briefs).toEqual(['/learn/missions/protect-your-capital', '/learn/missions/diversify']);
  });

  it('shows a skeleton while the learning profile loads and an error when it fails', async () => {
    profile.mockReturnValue(new Promise(() => undefined));
    const pending = await render();
    expect(pending.root.querySelector('#learning .ws-skeletonStack')).not.toBeNull();
    TestBed.resetTestingModule();

    profile.mockRejectedValue(new ApiError(503, 'Learning is down.'));
    const { root } = await render();
    const error = root.querySelector('#learning .ws-empty[data-tone="error"]');
    expect(error?.textContent).toContain('Progression indisponible');
    expect(error?.textContent).toContain('Learning is down.');
    expect(root.querySelector('#learning .db-progress')).toBeNull();
  });

  it('lists modules from the platform and hides administration from investors', async () => {
    const { root } = await render();
    const modules = Array.from(root.querySelectorAll('.db-modules li')).map((li) => li.querySelector('strong')?.textContent);
    expect(modules).toEqual(['Portefeuille virtuel', 'Analyses IA']);
    expect(root.querySelector('.db-modules a')?.getAttribute('href')).toBe('/portfolios');
  });

  it('asks an administrator without MFA to enrol and shows failures honestly', async () => {
    user.set({ ...investor, role: 'ADMIN' });
    fetchDashboardContext.mockResolvedValue(context({ requiredActions: ['ENROLL_MFA_FOR_ADMIN'] }));
    listSessions.mockRejectedValue(new ApiError(500, 'Down.'));
    const { root } = await render();
    expect(root.textContent).toContain('Les outils administrateur sont verrouillés');
    expect(root.querySelector('#devices .ws-empty[data-tone="error"]')?.textContent).toContain('Sessions indisponibles');
    expect(kpiValue(root, 'Sessions actives')?.textContent).toContain('pas encore disponible');
  });
});
