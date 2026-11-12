import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, signal, untracked, viewChild, viewChildren } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { describeApiError } from '../core/api/errors';
import { COMPETENCY_LABEL, LEVEL_LABEL } from '../core/api/learning-api';
import { StoriesApi, type Competency, type StorySummary } from '../core/api/stories-api';
import { FR } from '../core/i18n/fr';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { StoryPlayerComponent, type StoryProgressEvent } from './story-player.component';
import { formatClock, resumePosition } from './story-timeline';
import { CHARACTER_NAME } from './story-visual.component';

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
}

/** /stories: apps/web/src/components/learning/stories/StoryFeed.tsx. `?story=<slug>` opens the feed on that story. */
@Component({
  selector: 'mtr-story-feed-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeadingComponent, HeadingActionsSlot, ...WORKSPACE_PRIMITIVES, StoryPlayerComponent],
  host: { style: 'display: contents' },
  templateUrl: './story-feed.page.html',
})
export class StoryFeedPage {
  private readonly api = inject(StoriesApi);
  private readonly requested = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('story'))), {
    initialValue: null,
  });
  private destroyed = false;
  protected readonly copy = FR.learn;
  /** The `?story=` slug the feed already scrolled to; progress updates must not pull the viewer back to it. */
  private jumpedTo: string | null = null;

  protected readonly stories = signal<StorySummary[] | null>(null);
  protected readonly weakest = signal<Competency | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly activeIndex = signal(0);
  protected readonly muted = signal(true);
  protected readonly captions = signal(true);
  protected readonly speechAvailable = signal(false);
  protected readonly reducedMotion = signal(false);

  private readonly feed = viewChild<ElementRef<HTMLElement>>('feed');
  private readonly items = viewChildren<ElementRef<HTMLElement>>('item');

  protected readonly characterName = CHARACTER_NAME;
  protected readonly levelLabel = LEVEL_LABEL;
  protected readonly competencyLabel = COMPETENCY_LABEL;
  protected readonly clock = formatClock;
  protected readonly resumeAt = (story: StorySummary) => resumePosition(story.progress, story.durationMs);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const query = reducedMotionQuery();
    if (query) {
      this.reducedMotion.set(query.matches);
      const onChange = (e: MediaQueryListEvent) => this.reducedMotion.set(e.matches);
      query.addEventListener('change', onChange);
      destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }

    void this.load();
    this.speechAvailable.set('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined');
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    });

    // Jump to a story requested by link once the feed is rendered.
    effect(() => {
      const requested = this.requested();
      const items = this.items();
      const stories = untracked(this.stories);
      if (!stories || !requested || items.length !== stories.length || this.jumpedTo === requested) return;
      const index = stories.findIndex((s) => s.slug === requested);
      if (index > 0) {
        this.jumpedTo = requested;
        this.activeIndex.set(index);
        items[index].nativeElement.scrollIntoView({ block: 'start' });
      }
    });

    // The story that fills most of the viewport is the active one.
    effect((onCleanup) => {
      const root = this.feed()?.nativeElement;
      const items = this.items();
      if (!root || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
              const index = Number((entry.target as HTMLElement).dataset['index']);
              if (!Number.isNaN(index)) this.activeIndex.set(index);
            }
          }
        },
        { root, threshold: [0.6] },
      );
      items.forEach((el) => observer.observe(el.nativeElement));
      onCleanup(() => observer.disconnect());
    });
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      const feed = await this.api.feed();
      if (this.destroyed) return;
      this.stories.set(feed.stories);
      this.weakest.set(feed.weakestCompetency);
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Impossible de charger les histoires financières.'));
    }
  }

  protected goTo(index: number): void {
    const stories = this.stories();
    if (!stories) return;
    const target = Math.max(0, Math.min(stories.length - 1, index));
    this.items()[target]?.nativeElement.scrollIntoView({ behavior: this.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  protected toggleMute(): void {
    this.muted.update((m) => !m);
  }

  protected toggleCaptions(): void {
    this.captions.update((c) => !c);
  }

  protected onProgress({ slug, progress }: StoryProgressEvent): void {
    this.stories.update((list) => list?.map((s) => (s.slug === slug ? { ...s, progress } : s)) ?? list);
  }
}
