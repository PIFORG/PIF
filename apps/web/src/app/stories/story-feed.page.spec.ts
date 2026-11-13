import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { StoriesApi, type StorySummary } from '../core/api/stories-api';
import { ApiError } from '../core/api/types';
import { StoryFeedPage } from './story-feed.page';

function summary(slug: string, overrides: Partial<StorySummary> = {}): StorySummary {
  return {
    slug,
    version: 1,
    title: `Story ${slug}`,
    character: 'ADAM',
    summary: 'Buy or wait?',
    competency: 'DIVERSIFICATION',
    level: 'ROOKIE',
    relatedMissionSlug: null,
    durationMs: 65_000,
    media: { videoUrl: null, posterUrl: null, format: 'MOTION_GRAPHICS' },
    progress: { positionMs: 0, completed: false, reflection: null, updatedSinceLastWatch: false, watchedEarlierVersion: false },
    ...overrides,
  };
}

describe('StoryFeed page', () => {
  let feed: ReturnType<typeof vi.fn>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function settle<T>(fixture: ComponentFixture<T>) {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  }

  async function render() {
    TestBed.configureTestingModule({
      imports: [StoryFeedPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: query } },
        { provide: StoriesApi, useValue: { feed, story: vi.fn(() => new Promise(() => undefined)), progress: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(StoryFeedPage);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  const viewer = (root: HTMLElement) => root.querySelector<HTMLElement>('.st-viewer[role="dialog"]');
  const cards = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('button.st-card'));
  const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  beforeEach(() => {
    query = new BehaviorSubject(convertToParamMap({}));
    feed = vi.fn().mockResolvedValue({
      weakestCompetency: 'DIVERSIFICATION',
      stories: [
        summary('first', {
          recommended: true,
          relatedMissionSlug: 'spread-the-risk',
          progress: { positionMs: 12_000, completed: false, reflection: null, updatedSinceLastWatch: true, watchedEarlierVersion: false },
        }),
        summary('second', { character: 'YOUSSEF', progress: { positionMs: 0, completed: true, reflection: null, updatedSinceLastWatch: false, watchedEarlierVersion: true } }),
      ],
    });
  });

  afterEach(() => {
    document.body.style.removeProperty('overflow');
  });

  it('shows a gallery of story cards and rings with their status, skill and resume point', async () => {
    const { root } = await render();
    expect(root.querySelector('h1')?.textContent).toBe('Histoires financières');
    const list = cards(root);
    expect(list.map((c) => c.getAttribute('aria-label'))).toEqual(['1 sur 2 : Story first — Reprendre à 0:12', '2 sur 2 : Story second — Revoir']);
    expect(list.map((c) => c.getAttribute('data-character'))).toEqual(['ADAM', 'YOUSSEF']);
    expect(list.map((c) => c.querySelector('.st-posterChip')?.textContent)).toEqual(['En cours', 'Vu']);
    const badges = (card: HTMLElement) => Array.from(card.querySelectorAll('.badge')).map((b) => b.textContent);
    expect(badges(list[0])).toEqual(['Adam', 'Trader débutant', 'Pour votre compétence la plus faible', 'Mis à jour depuis votre visionnage']);
    expect(badges(list[1])).toEqual(['Youssef', 'Trader débutant', 'Version antérieure vue']);
    expect(list[0].textContent).toContain('Diversification du portefeuille · 1:05');
    expect(list[0].querySelector<HTMLElement>('.st-posterProgress span')?.style.width).toMatch(/^18\.46/);

    const rings = Array.from(root.querySelectorAll<HTMLElement>('.st-ring'));
    expect(rings.map((r) => r.getAttribute('data-status'))).toEqual(['IN_PROGRESS', 'DONE']);
    expect(rings.map((r) => r.textContent?.trim())).toEqual(['AAdam', 'YYoussef']);

    expect(root.querySelector('.st-transcript')?.textContent).toContain('Ordre personnalisé : les histoires sur Diversification du portefeuille viennent en premier.');
    // Nothing plays until a story is opened.
    expect(viewer(root)).toBeNull();
    expect(root.querySelector('[mtr-story-player]')).toBeNull();
  });

  it('opens a story full screen, moves along the feed and closes with Escape', async () => {
    const { fixture, root } = await render();
    cards(root)[0].click();
    fixture.detectChanges();
    const dialog = viewer(root)!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Histoire 1 sur 2 : Story first');
    expect(dialog.querySelector('.st-stage')?.getAttribute('data-immersive')).toBe('true');
    expect(dialog.querySelector('.st-stage')?.getAttribute('data-character')).toBe('ADAM');
    expect(dialog.querySelector('.st-status[role="status"]')?.textContent).toContain("Chargement de l'histoire…");
    expect(dialog.querySelector('.st-viewerInfo a.btn')?.getAttribute('href')).toBe('/learn/missions/spread-the-risk');
    expect(document.body.style.overflow).toBe('hidden');
    expect(root.querySelector('.st-cinemaShell')?.hasAttribute('inert')).toBe(true);

    key(dialog, 'ArrowDown');
    fixture.detectChanges();
    expect(viewer(root)?.getAttribute('aria-label')).toBe('Histoire 2 sur 2 : Story second');
    expect(viewer(root)?.querySelector('.st-viewerStage')?.getAttribute('data-direction')).toBe('next');
    expect(viewer(root)?.querySelector<HTMLButtonElement>('button[aria-label="Histoire suivante"]')?.disabled).toBe(true);
    key(viewer(root)!, 'ArrowDown');
    fixture.detectChanges();
    expect(viewer(root)?.getAttribute('aria-label')).toBe('Histoire 2 sur 2 : Story second');

    viewer(root)!.querySelector<HTMLButtonElement>('button[aria-label="Histoire précédente"]')!.click();
    fixture.detectChanges();
    expect(viewer(root)?.getAttribute('aria-label')).toBe('Histoire 1 sur 2 : Story first');
    expect(viewer(root)?.querySelector('.st-viewerStage')?.getAttribute('data-direction')).toBe('prev');

    key(viewer(root)!, 'Escape');
    await settle(fixture);
    expect(viewer(root)).toBeNull();
    expect(document.activeElement).toBe(cards(root)[0]);
    expect(document.body.style.overflow).toBe('');
    expect(root.querySelector('.st-cinemaShell')?.hasAttribute('inert')).toBe(false);
  });

  it('starts the next story on its own once one has finished', async () => {
    const { fixture, root } = await render();
    cards(root)[0].click();
    fixture.detectChanges();
    vi.useFakeTimers();
    try {
      (fixture.componentInstance as unknown as { onFinished(): void }).onFinished();
      vi.advanceTimersByTime(1000);
      fixture.detectChanges();
      expect(viewer(root)?.getAttribute('aria-label')).toBe('Histoire 1 sur 2 : Story first');
      vi.advanceTimersByTime(500);
      fixture.detectChanges();
      expect(viewer(root)?.getAttribute('aria-label')).toBe('Histoire 2 sur 2 : Story second');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the story requested by ?story= directly', async () => {
    query.next(convertToParamMap({ story: 'second' }));
    const { root } = await render();
    expect(viewer(root)?.getAttribute('aria-label')).toBe('Histoire 2 sur 2 : Story second');
  });

  it('shows an empty state when there are no stories', async () => {
    feed.mockResolvedValue({ weakestCompetency: null, stories: [] });
    const { root } = await render();
    expect(root.querySelector('.ws-emptyTitle')?.textContent).toBe('Aucune histoire pour le moment');
  });

  it('explains a failed feed and retries', async () => {
    feed.mockRejectedValueOnce(new ApiError(500, 'Stories are down.'));
    const { fixture, root } = await render();
    const error = root.querySelector('.ws-empty[data-tone="error"]');
    expect(error?.textContent).toContain('Histoires financières indisponibles');
    expect(error?.textContent).toContain('Stories are down.');
    (error?.querySelector('button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(feed).toHaveBeenCalledTimes(2);
    expect(cards(root).length).toBe(2);
  });
});
