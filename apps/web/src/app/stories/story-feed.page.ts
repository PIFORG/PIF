import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { describeApiError } from '../core/api/errors';
import { COMPETENCY_LABEL, LEVEL_LABEL } from '../core/api/learning-api';
import { StoriesApi, type Competency, type StorySummary } from '../core/api/stories-api';
import { FR } from '../core/i18n/fr';
import { IconComponent } from '../shared/icon/icon.component';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { StoryPlayerComponent, type StoryProgressEvent } from './story-player.component';
import { formatClock, resumePosition } from './story-timeline';
import { CHARACTER_NAME } from './story-visual.component';
import { VOICE_STORAGE_KEY, frenchVoices, isNaturalVoice, voiceLabel } from './story-voice';

/** Pause before the next story starts on its own once one has finished. */
const AUTO_ADVANCE_MS = 1400;
/** Minimum gap between two wheel-driven story changes. */
const WHEEL_COOLDOWN_MS = 700;

type StoryStatus = 'NEW' | 'IN_PROGRESS' | 'DONE';

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
}

function readStoredVoice(): string | null {
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * /stories: a gallery of FinStories (story rings and poster cards). Opening one shows it full screen like a social
 * story: tap left / right to change scene, hold to pause, swipe up / down (or the arrow keys, or the wheel) to move
 * along the vertical feed of episodes, Escape to close. `?story=<slug>` opens that story directly.
 */
@Component({
  selector: 'mtr-story-feed-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeadingComponent, HeadingActionsSlot, ...WORKSPACE_PRIMITIVES, StoryPlayerComponent, IconComponent],
  host: { style: 'display: contents' },
  templateUrl: './story-feed.page.html',
})
export class StoryFeedPage {
  private readonly api = inject(StoriesApi);
  private readonly injector = inject(Injector);
  private readonly requested = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('story'))), {
    initialValue: null,
  });
  private destroyed = false;
  protected readonly copy = FR.learn;
  /** The `?story=` slug already opened; progress updates must not reopen it. */
  private openedFromLink: string | null = null;
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWheel = 0;
  private openerEl: HTMLElement | null = null;

  protected readonly stories = signal<StorySummary[] | null>(null);
  protected readonly weakest = signal<Competency | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly muted = signal(true);
  protected readonly captions = signal(true);
  protected readonly reducedMotion = signal(false);

  /** Index of the story open full screen, or null in the gallery. */
  protected readonly openIndex = signal<number | null>(null);
  /** Direction of the last story change, for the slide-in animation. */
  protected readonly direction = signal<'open' | 'next' | 'prev'>('open');
  protected readonly openStory = computed(() => {
    const index = this.openIndex();
    const list = this.stories();
    return index === null || !list ? null : (list[index] ?? null);
  });

  /** French voices installed in this browser, best first; English voices are never offered. */
  protected readonly voices = signal<SpeechSynthesisVoice[]>([]);
  private readonly chosenVoiceUri = signal<string | null>(readStoredVoice());
  protected readonly voice = computed(() => {
    const list = this.voices();
    return list.find((v) => v.voiceURI === this.chosenVoiceUri()) ?? list[0] ?? null;
  });
  protected readonly speechAvailable = computed(() => this.voice() !== null);
  protected readonly naturalVoiceMissing = computed(() => this.voices().length > 0 && !this.voices().some(isNaturalVoice));
  protected readonly voiceLabel = voiceLabel;

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

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
    if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      const synth = window.speechSynthesis;
      // Voices load asynchronously in most browsers: read them now and again when the list changes.
      const refresh = () => this.voices.set(frenchVoices(synth.getVoices()));
      refresh();
      synth.addEventListener?.('voiceschanged', refresh);
      destroyRef.onDestroy(() => synth.removeEventListener?.('voiceschanged', refresh));
    }
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.clearAdvance();
      document.body.style.removeProperty('overflow');
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    });

    // A story requested by link opens full screen once the feed is loaded.
    effect(() => {
      const requested = this.requested();
      const list = this.stories();
      if (!list || !requested || this.openedFromLink === requested) return;
      const index = list.findIndex((s) => s.slug === requested);
      if (index >= 0) {
        this.openedFromLink = requested;
        untracked(() => this.open(index));
      }
    });

    // The page behind the full-screen story does not scroll; focus moves into the story and back afterwards.
    effect(() => {
      const isOpen = this.openIndex() !== null;
      document.body.style.overflow = isOpen ? 'hidden' : '';
      if (isOpen) queueMicrotask(() => this.closeButton()?.nativeElement.focus());
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

  protected status(story: StorySummary): StoryStatus {
    if (story.progress.completed) return 'DONE';
    return story.progress.positionMs > 0 ? 'IN_PROGRESS' : 'NEW';
  }

  /** Share watched, for the progress bar and the ring. */
  protected watched(story: StorySummary): number {
    if (story.progress.completed) return 100;
    return Math.min(100, Math.max(0, (story.progress.positionMs / Math.max(1, story.durationMs)) * 100));
  }

  protected callToAction(story: StorySummary): string {
    const status = this.status(story);
    if (status === 'DONE') return 'Revoir';
    if (status === 'IN_PROGRESS') return `Reprendre à ${formatClock(this.resumeAt(story))}`;
    return 'Regarder';
  }

  // ---------------------------------------------------------------- full-screen viewer

  protected open(index: number, opener?: EventTarget | null): void {
    const list = this.stories();
    if (!list || index < 0 || index >= list.length) return;
    if (opener instanceof HTMLElement) this.openerEl = opener;
    this.clearAdvance();
    this.direction.set('open');
    this.openIndex.set(index);
  }

  protected close(): void {
    this.clearAdvance();
    this.openIndex.set(null);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const opener = this.openerEl;
    this.openerEl = null;
    // After the render that lifts `inert` from the gallery, or the focus would be refused.
    afterNextRender(() => opener?.focus(), { injector: this.injector });
  }

  /** Moves along the vertical feed of stories; stays put at either end. */
  protected go(delta: number): void {
    const index = this.openIndex();
    const list = this.stories();
    if (index === null || !list) return;
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    this.clearAdvance();
    this.direction.set(delta > 0 ? 'next' : 'prev');
    this.openIndex.set(target);
  }

  protected onSwipe(direction: 'up' | 'down'): void {
    this.go(direction === 'up' ? 1 : -1);
  }

  /** The next story starts on its own, like a story feed; the last one keeps its end card. */
  protected onFinished(): void {
    const index = this.openIndex();
    const list = this.stories();
    if (index === null || !list || index >= list.length - 1) return;
    this.clearAdvance();
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = null;
      if (this.openIndex() === index) this.go(1);
    }, AUTO_ADVANCE_MS);
  }

  protected onViewerKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') this.go(1);
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') this.go(-1);
    else return;
    e.preventDefault();
  }

  protected onWheel(e: WheelEvent): void {
    // The side panel scrolls on its own; only the story area changes episode.
    if (e.target instanceof Element && e.target.closest('.st-viewerInfo')) return;
    if (Math.abs(e.deltaY) < 30) return;
    const now = Date.now();
    if (now - this.lastWheel < WHEEL_COOLDOWN_MS) return;
    this.lastWheel = now;
    this.go(e.deltaY > 0 ? 1 : -1);
  }

  private clearAdvance(): void {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }

  // ---------------------------------------------------------------- settings

  protected chooseVoice(uri: string): void {
    this.chosenVoiceUri.set(uri);
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, uri);
    } catch {
      // Private mode: the choice simply lasts for this visit.
    }
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
