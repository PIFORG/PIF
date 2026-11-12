import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LearningApi, StoriesFeedApi, type LearningProfile, type MissionSummary, type StorySummary } from '../core/api/learning-api';
import { ApiError } from '../core/api/types';
import { LearningHubPage } from './learning-hub.page';

const mission = (
  slug: string,
  order: number,
  level: MissionSummary['level'],
  availability: MissionSummary['availability'],
  extra: Partial<MissionSummary> = {},
): MissionSummary => ({
  slug,
  version: 1,
  order,
  title: slug,
  level,
  availability,
  summary: `${slug} summary`,
  estimatedMinutes: 10,
  competencies: [],
  playable: availability !== 'PLANNED',
  levelLocked: false,
  relatedStorySlug: null,
  progress: { attempts: 0, passed: false, bestScore: null, activeSessionId: null },
  ...extra,
});

const profile: LearningProfile = {
  experienceLevel: 'BEGINNER',
  unlockedLevel: 'ROOKIE',
  competencies: [
    { competency: 'RISK_MANAGEMENT', score: 62, unassistedScore: 70, assistedScore: 45, evidence: 1.7, evidenceLevel: 'DEVELOPING', observations: 2, trend: 3 },
    { competency: 'DIVERSIFICATION', score: null, unassistedScore: null, assistedScore: null, evidence: 0, evidenceLevel: 'NONE', observations: 0, trend: null },
  ],
  stats: { missionsPassed: 1, missionsAttempted: 2, assessedSessions: 3, implementedMissions: 5, playableMissions: 6 },
  activeSessions: [
    { id: 's-1', kind: 'MISSION', missionSlug: 'protect-your-capital', missionTitle: 'Protect Your Capital', currentStep: 4, updatedAt: '2026-11-09T09:00:00.000Z' },
  ],
  recentAssessments: [],
  recommendations: [{ slug: 'protect-your-capital', title: 'Protect Your Capital', level: 'ROOKIE', reason: 'Builds Risk Management, your weakest competency.' }],
  calibration: { ratedOrders: 0, observations: 0, minimumOrders: 10, interpretable: false, brierScore: null, meanConfidence: null, hitRate: null, signals: 0, note: '' },
};

const story: StorySummary = {
  slug: 'sarah-and-the-market-crash',
  version: 2,
  title: 'Sarah and the Market Crash',
  character: 'SARAH',
  summary: 'Sell or hold?',
  competency: 'RISK_MANAGEMENT',
  level: 'COMMANDER',
  relatedMissionSlug: 'survive-the-market-crash',
  durationMs: 59_000,
  media: { videoUrl: null, posterUrl: null, format: 'MOTION_GRAPHICS' },
  progress: { positionMs: 0, completed: false, reflection: null, updatedSinceLastWatch: false, watchedEarlierVersion: false },
  recommended: true,
};

const catalog = {
  unlockedLevel: 'ROOKIE' as const,
  missions: [
    mission('my-first-trade', 1, 'ROOKIE', 'IMPLEMENTED', { progress: { attempts: 1, passed: true, bestScore: 81, activeSessionId: null } }),
    mission('breaking-news', 4, 'STRATEGIST', 'CONFIGURED'),
    mission('interest-rate-shock', 8, 'COMMANDER', 'PLANNED'),
    mission('survive-the-market-crash', 10, 'COMMANDER', 'IMPLEMENTED', { levelLocked: true }),
  ],
};

let learningApi: Record<string, ReturnType<typeof vi.fn>>;
let storiesApi: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  learningApi = { profile: vi.fn().mockResolvedValue(profile), missions: vi.fn().mockResolvedValue(catalog) };
  storiesApi = { feed: vi.fn().mockResolvedValue({ weakestCompetency: 'RISK_MANAGEMENT', stories: [story] }) };
});

async function settle<T>(fixture: ComponentFixture<T>) {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
}

async function render() {
  TestBed.configureTestingModule({
    imports: [LearningHubPage],
    providers: [provideRouter([]), { provide: LearningApi, useValue: learningApi }, { provide: StoriesFeedApi, useValue: storiesApi }],
  });
  const fixture = TestBed.createComponent(LearningHubPage);
  await settle(fixture);
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

const region = (root: HTMLElement, name: string) => root.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
const links = (root: Element) => Array.from(root.querySelectorAll('a'));
const kpi = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll<HTMLElement>('.ws-kpi')).find((k) => k.querySelector('.ws-kpiLabel')?.textContent === label);

describe('LearningHubPage', () => {
  it('groups missions by level and never presents planned missions as playable', async () => {
    const { root } = await render();
    const rookie = region(root, 'Trader débutant');
    const first = links(rookie).find((a) => a.textContent?.includes('my-first-trade'));
    expect(first?.getAttribute('href')).toBe('/learn/missions/my-first-trade');
    expect(rookie.textContent).toContain('Passed · best 81');

    const commander = region(root, 'Commandant risque');
    expect(links(commander).find((a) => a.textContent?.includes('interest-rate-shock'))).toBeUndefined();
    const planned = commander.querySelector('.lr-mission[aria-disabled="true"]')!;
    expect(planned.getAttribute('data-availability')).toBe('PLANNED');
    expect(planned.querySelector('.badge')?.textContent).toBe('Planned');
    expect(planned.textContent).toContain('not playable yet');
    expect(commander.textContent).toContain('Recommended later');

    expect(region(root, 'Stratège marché').querySelector('.badge')?.textContent).toBe('Playable · in review');
  });

  it('shows the competency profile with assisted and unassisted evidence separately', async () => {
    const { root } = await render();
    expect(root.textContent).toContain('62 / 100');
    expect(root.textContent).toContain('Unassisted 70 · With mentor 45');
    expect(root.textContent).toContain('No evidence yet');
    expect(root.textContent).toContain('Developing evidence · 2 missions');
    const meter = root.querySelector('[role="meter"][aria-label="Portfolio Diversification mastery"]');
    expect(meter?.getAttribute('aria-valuetext')).toBe('Not assessed yet');
    expect(root.querySelector('[role="meter"][aria-label="Risk Management mastery"]')?.getAttribute('aria-valuenow')).toBe('62');
  });

  it('links active sessions, recommendations and the recommended FinStory', async () => {
    const { root } = await render();
    expect(links(root).find((a) => a.textContent?.trim() === 'Resume')?.getAttribute('href')).toBe('/learn/sessions/s-1');
    expect(root.textContent).toContain('your weakest competency');
    const storyLink = links(root).find((a) => a.textContent?.includes('Sarah and the Market Crash'));
    expect(storyLink?.getAttribute('href')).toBe('/stories?story=sarah-and-the-market-crash');
    expect(storyLink?.textContent).toContain('For your weakest skill');
    expect(storyLink?.textContent).toContain('59 s · Risk Management');
  });

  it('shows the KPIs from the profile and links the playable showcase mission', async () => {
    const { root } = await render();
    expect(kpi(root, 'Recommended level')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe('Trader débutant');
    expect(kpi(root, 'Missions passed')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe('1 / 6');
    expect(kpi(root, 'Assessed attempts')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe('3');
    expect(kpi(root, 'Confidence calibration')?.querySelector('.ws-kpiHint')?.textContent).toBe('Rate your confidence on orders to see it.');
    const actions = root.querySelector('.headingActions')!;
    expect(links(actions).map((a) => a.getAttribute('href'))).toEqual(['/stories', '/learn/missions/survive-the-market-crash']);
  });

  it('shows an honest error state and retries', async () => {
    learningApi['profile'].mockRejectedValueOnce(new ApiError(503, 'Learning is down.'));
    const { fixture, root } = await render();
    const error = root.querySelector('.ws-empty[data-tone="error"]');
    expect(error?.textContent).toContain('Learning data unavailable');
    expect(error?.textContent).toContain('Learning is down.');
    expect(kpi(root, 'Recommended level')?.querySelector('.ws-kpiValue')?.textContent?.trim()).toBe('—');
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Réessayer')!.click();
    await settle(fixture);
    expect(root.querySelector('.ws-empty[data-tone="error"]')).toBeNull();
    expect(learningApi['profile']).toHaveBeenCalledTimes(2);
  });
});
