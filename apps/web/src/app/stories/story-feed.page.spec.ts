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

  it('renders one 9:16 player per story with its badges, skill and resume point', async () => {
    const { root } = await render();
    expect(root.querySelector('h1')?.textContent).toBe('Histoires financières');
    const items = Array.from(root.querySelectorAll<HTMLElement>('section.st-item'));
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['1 sur 2 : Story first', '2 sur 2 : Story second']);
    expect(items[0].querySelector('.st-stage')?.getAttribute('data-character')).toBe('ADAM');
    const badges = (item: HTMLElement) => Array.from(item.querySelectorAll('.badge')).map((b) => b.textContent);
    expect(badges(items[0])).toEqual(['Adam', 'Trader débutant', 'Pour votre compétence la plus faible', 'Mis à jour depuis votre visionnage']);
    expect(badges(items[1])).toEqual(['Youssef', 'Trader débutant', 'Vu', 'Version antérieure vue']);
    expect(items[0].textContent).toContain('Compétence : Diversification du portefeuille · 1:05 · reprise à 0:12');
    expect(items[0].querySelector('a.btn-sm')?.getAttribute('href')).toBe('/learn/missions/spread-the-risk');
    expect(items[0].querySelector('.st-transcript')?.textContent).toContain('Ordre personnalisé : les histoires sur Diversification du portefeuille viennent en premier.');
    expect(items[1].querySelector('.st-transcript')?.textContent).not.toContain('Ordre personnalisé');
    expect(items[0].querySelector('.st-status[role="status"]')?.textContent).toContain("Chargement de l'histoire…");
  });

  it('opens the feed on the story requested by ?story=', async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('aria-label') ?? '');
    };
    try {
      query.next(convertToParamMap({ story: 'second' }));
      await render();
      expect(scrolled).toEqual(['2 sur 2 : Story second']);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
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
    expect(root.querySelectorAll('section.st-item').length).toBe(2);
  });
});
