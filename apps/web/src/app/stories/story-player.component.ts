import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../core/api/errors';
import { StoriesApi, type Story, type StoryProgress, type StorySummary } from '../core/api/stories-api';
import { IconComponent } from '../shared/icon/icon.component';
import { formatClock, holdForSpeech, reelOf, resumePosition, sceneAt, sceneStart, totalDuration } from './story-timeline';
import { CHARACTER_NAME, StoryVisualComponent } from './story-visual.component';
import { spokenText, voiceLabel } from './story-voice';

const SAVE_EVERY_MS = 5000;
const ANIMATION_MS = 1800;
/** Speech rate: slightly below 1 sounds more natural in French. */
const SPEECH_RATE = 0.95;
/** Longest a scene waits for its narration to finish, in case the browser never reports the end of speech. */
const MAX_SPEECH_HOLD_MS = 15000;
/** Largest clock step per frame, so a stalled frame does not skip half a scene. */
const MAX_FRAME_STEP_MS = 250;

export interface StoryProgressEvent {
  slug: string;
  progress: StoryProgress;
}

/**
 * apps/web/src/components/learning/stories/StoryPlayer.tsx: a 9:16 motion-graphics reel drawn from the story script.
 * The viewer only thinks about A or B; the story plays path A, rewinds and plays path B. Nothing asks for an answer.
 */
@Component({
  selector: 'div[mtr-story-player]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, StoryVisualComponent],
  host: {
    class: 'st-stage st-cinemaStage',
    role: 'region',
    'aria-roledescription': "lecteur d'histoire",
    '[attr.data-character]': 'summary().character',
    '[attr.data-immersive]': 'immersive() ? "true" : null',
    '[attr.data-holding]': 'holding() ? "true" : null',
    '[attr.aria-label]': 'regionLabel()',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    @if (story()) {
      <div class="st-segments" aria-hidden="true">
        @for (segment of segments(); track segment.id) {
          <span class="st-segment"><span [style.width.%]="segment.fill * 100"></span></span>
        }
      </div>
    }

    <div class="st-topbar">
      @if (reel(); as r) {
        <span class="st-reel" [attr.data-path]="r.path">{{ r.label }}</span>
      } @else {
        <span class="st-reel">Histoires financières</span>
      }
      <span class="st-reel">{{ characterName() }}</span>
    </div>

    @for (s of sceneList(); track s.id) {
      <div class="st-scene">
        <mtr-story-visual [visual]="s.visual" [scene]="s" [progress]="sceneProgress()" />
      </div>
    }
    @if (scene()?.kind === 'REWIND' && !reducedMotion()) {
      <div class="st-scanlines" aria-hidden="true"></div>
    }

    @if (immersive() && story() && !ended()) {
      <!-- Story gestures: tap left / right, hold to pause, swipe up / down. The buttons below stay the accessible path. -->
      <div
        class="st-tapZones"
        aria-hidden="true"
        (pointerdown)="onPointerDown($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerCancel()"
        (pointerleave)="onPointerCancel()"
      >
        <span class="st-tapZone" data-side="prev"></span>
        <span class="st-tapZone" data-side="next"></span>
      </div>
      @if (holding()) {
        <div class="st-holdBadge" aria-hidden="true"><svg mtrIcon name="pause" [size]="14" /> En pause</div>
      }
    }

    @if (scene(); as s) {
      @if (captions()) {
        <p class="st-caption" [attr.aria-live]="playing() ? 'off' : 'polite'">@for (line of [s]; track line.id) {<span class="st-captionText">{{ line.caption }}</span>}</p>
      }
    }

    @if (!story() && !loadError()) {
      <div class="st-status" role="status">
        <div class="st-spinner" aria-hidden="true"></div>
        <p>Chargement de l'histoire…</p>
      </div>
    }

    @if (loadError(); as message) {
      <div class="st-status" role="alert">
        <p>{{ message }}</p>
        <button type="button" class="btn btn-secondary btn-sm" (click)="load()">Réessayer</button>
      </div>
    }

    @if (ended()) {
      <div class="st-status">
        <p>
          <strong>Fin de l'histoire.</strong>
        </p>
        <div class="st-endCard">
          @if (summary().relatedMissionSlug; as mission) {
            <a [routerLink]="['/learn/missions', mission]" class="btn btn-primary">S'entraîner dans le parcours</a>
          }
          @if (hasNext()) {
            <button type="button" class="btn btn-secondary" (click)="next.emit()">Histoire suivante</button>
          }
          <button type="button" class="btn btn-ghost" style="color: #fff" (click)="toggle()"><svg mtrIcon name="rewind" [size]="14" /> Revoir</button>
        </div>
      </div>
    }

    <div class="st-controls">
      <button type="button" (click)="jump(-1)" [disabled]="!story()" aria-label="Scène précédente">
        <svg mtrIcon name="chevron-left" [size]="18" />
      </button>
      <button type="button" (click)="toggle()" [disabled]="!story()" [attr.aria-label]="playing() ? 'Pause' : ended() ? 'Rejouer' : 'Lecture'">
        <svg mtrIcon [name]="playing() ? 'pause' : 'play'" [size]="18" />
      </button>
      <button type="button" (click)="jump(1)" [disabled]="!story()" aria-label="Scène suivante">
        <svg mtrIcon name="chevron-right" [size]="18" />
      </button>
      <span class="st-time" aria-hidden="true">{{ clock(position()) }}<span class="st-timeTotal"> / {{ clock(duration()) }}</span>{{ saveFailed() ? ' · non enregistré' : '' }}</span>
      <button type="button" (click)="toggleCaptions.emit()" [attr.aria-pressed]="captions()" aria-label="Sous-titres">
        <svg mtrIcon name="captions" [size]="18" />
      </button>
      <button
        type="button"
        (click)="toggleMute.emit()"
        [disabled]="!speechAvailable()"
        [attr.aria-pressed]="!muted()"
        [attr.aria-label]="narrationAriaLabel()"
        [attr.title]="narrationTitle()"
      >
        <svg mtrIcon [name]="muted() ? 'volume-off' : 'volume'" [size]="18" />
      </button>
    </div>
  `,
})
export class StoryPlayerComponent {
  readonly summary = input.required<StorySummary>();
  readonly active = input.required<boolean>();
  /** Fetch the scenes ahead of time without playing (the next story in the feed). */
  readonly preload = input(false);
  readonly muted = input.required<boolean>();
  readonly captions = input.required<boolean>();
  readonly reducedMotion = input(false);
  readonly speechAvailable = input(false);
  /** The French voice that reads the captions; null when the device has no French voice. */
  readonly voice = input<SpeechSynthesisVoice | null>(null);
  /** Whether the end card offers the next story. */
  readonly hasNext = input(false);
  /** Full-screen story mode: tap, hold and swipe gestures, and the end of a story is announced. */
  readonly immersive = input(false);
  readonly toggleMute = output();
  readonly toggleCaptions = output();
  readonly next = output();
  /** A vertical swipe in immersive mode: up for the next story, down for the previous one. */
  readonly swipe = output<'up' | 'down'>();
  /** Emitted once when playback reaches the end of the story. */
  readonly finished = output();
  readonly progressSaved = output<StoryProgressEvent>();

  private readonly api = inject(StoriesApi);

  protected readonly story = signal<Story | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly position = signal(0);
  protected readonly playing = signal(false);
  protected readonly saveFailed = signal(false);
  /** True while the viewer holds the story down to pause it. */
  protected readonly holding = signal(false);

  private pointer: { x: number; y: number; at: number; wasPlaying: boolean } | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  private positionMs = 0;
  private savedMs = 0;
  private started = false;
  private loading = false;
  private destroyed = false;
  /** True while the current scene's sentence is still being spoken: the scene then waits instead of cutting it. */
  private speaking = false;
  private holdSince: number | null = null;
  private utteranceSeq = 0;

  protected readonly clock = formatClock;

  protected narrationAriaLabel(): string {
    if (!this.speechAvailable()) return "La narration n'est pas disponible : aucune voix française sur cet appareil";
    return this.muted() ? 'Activer la narration en français' : 'Couper la narration';
  }

  protected narrationTitle(): string {
    const voice = this.voice();
    return this.speechAvailable() && voice
      ? `Narration en français · voix ${voiceLabel(voice)}`
      : "Aucune voix française n'est installée sur cet appareil";
  }

  protected readonly duration = computed(() => {
    const story = this.story();
    return story ? totalDuration(story.scenes) : this.summary().durationMs;
  });
  protected readonly ended = computed(() => this.story() !== null && this.position() >= this.duration());
  private readonly current = computed(() => {
    const story = this.story();
    return story ? sceneAt(story.scenes, this.position()) : null;
  });
  protected readonly scene = computed(() => {
    const story = this.story();
    const current = this.current();
    return story && current ? story.scenes[current.index] : null;
  });
  /** One-item list keyed by scene id, so every scene gets a fresh frame. */
  protected readonly sceneList = computed(() => {
    const scene = this.scene();
    return scene ? [scene] : [];
  });
  protected readonly reel = computed(() => {
    const scene = this.scene();
    return scene ? reelOf(scene.kind) : null;
  });
  protected readonly sceneProgress = computed(() => {
    if (this.reducedMotion()) return 1;
    const current = this.current();
    return current ? current.local / ANIMATION_MS : 0;
  });
  protected readonly segments = computed(() => {
    const story = this.story();
    const position = this.position();
    if (!story) return [];
    return story.scenes.map((s, i) => {
      const start = sceneStart(story.scenes, i);
      return { id: s.id, fill: Math.min(1, Math.max(0, (position - start) / s.durationMs)) };
    });
  });
  protected readonly characterName = computed(() => CHARACTER_NAME[this.summary().character]);
  protected readonly regionLabel = computed(
    () => `${this.summary().title}. K pour lecture ou pause, flèches pour changer de scène, M pour la narration en français, C pour les sous-titres.`,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      if (this.holdTimer) clearTimeout(this.holdTimer);
    });

    effect(() => {
      if ((this.active() || this.preload()) && !this.story() && !this.loadError()) untracked(() => void this.load());
    });

    // Autoplay when the story scrolls into view (not with reduced motion); pause and save when it leaves.
    effect(() => {
      const story = this.story();
      const active = this.active();
      const reducedMotion = this.reducedMotion();
      if (!story) return;
      untracked(() => {
        if (active && !this.started) {
          this.started = true;
          if (!reducedMotion) this.playing.set(true);
        }
        if (!active && this.started) {
          this.started = false;
          this.playing.set(false);
          void this.save();
        }
      });
    });

    // Playback clock.
    effect((onCleanup) => {
      if (!this.playing() || !this.story()) return;
      const duration = this.duration();
      let frame = 0;
      let last = performance.now();
      const tick = (now: number) => {
        // Never step backwards, and never leap ahead after a stalled frame (the timestamp clock may differ).
        const step = Math.min(MAX_FRAME_STEP_MS, Math.max(0, now - last));
        let next = Math.min(duration, this.positionMs + step);
        last = now;
        // Let the narrator finish the sentence: hold on the last frame of the scene until the speech ends.
        const story = this.story();
        if (story && this.speaking) {
          const held = holdForSpeech(story.scenes, this.positionMs, next);
          if (held < next) {
            this.holdSince ??= now;
            if (now - this.holdSince < MAX_SPEECH_HOLD_MS) next = held;
            else this.speaking = false;
          }
        }
        this.positionMs = next;
        this.position.set(next);
        if (next >= duration) {
          this.playing.set(false);
          void this.save(true);
          this.finished.emit();
          return;
        }
        if (next - this.savedMs >= SAVE_EVERY_MS) void this.save();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      onCleanup(() => cancelAnimationFrame(frame));
    });

    // French narration via the browser's speech synthesis, one utterance per scene; re-spoken only when the scene,
    // the voice or the playback, mute or active state changes. Only a French voice is ever used.
    effect((onCleanup) => {
      const voice = this.voice();
      if (!this.speechAvailable() || !voice) return;
      const synth = window.speechSynthesis;
      const scene = this.scene();
      const seq = ++this.utteranceSeq;
      this.speaking = false;
      this.holdSince = null;
      if (!scene || !this.playing() || this.muted() || !this.active()) {
        synth.cancel();
        return;
      }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(spokenText(scene.caption));
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = SPEECH_RATE;
      utterance.pitch = 1;
      // Only the latest utterance may release the scene: cancelling an old one also fires its end event.
      const done = () => {
        if (seq === this.utteranceSeq) {
          this.speaking = false;
          this.holdSince = null;
        }
      };
      utterance.onend = done;
      utterance.onerror = done;
      this.speaking = true;
      synth.speak(utterance);
      onCleanup(() => {
        this.speaking = false;
        synth.cancel();
      });
    });
  }

  protected async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.loadError.set(null);
    try {
      const full = await this.api.story(this.summary().slug);
      if (this.destroyed) return;
      const start = resumePosition(full.progress, totalDuration(full.scenes));
      this.positionMs = start;
      this.savedMs = start;
      this.position.set(start);
      this.story.set(full);
    } catch (err) {
      if (!this.destroyed) this.loadError.set(describeApiError(err, 'Cette histoire n\'a pas pu être chargée.'));
    } finally {
      this.loading = false;
    }
  }

  private async save(completed = false): Promise<void> {
    const slug = this.summary().slug;
    const at = Math.round(this.positionMs);
    if (!completed && Math.abs(at - this.savedMs) < 500) return;
    this.savedMs = at;
    try {
      const res = await this.api.progress(slug, at, completed || undefined);
      if (this.destroyed) return;
      this.saveFailed.set(false);
      this.progressSaved.emit({
        slug,
        progress: {
          positionMs: res.positionMs,
          completed: res.completed,
          reflection: res.reflection,
          updatedSinceLastWatch: res.updatedSinceLastWatch,
          watchedEarlierVersion: res.watchedEarlierVersion,
        },
      });
    } catch {
      if (!this.destroyed) this.saveFailed.set(true);
    }
  }

  private seek(ms: number): void {
    const next = Math.max(0, Math.min(this.duration(), ms));
    this.positionMs = next;
    this.position.set(next);
  }

  protected toggle(): void {
    if (!this.story()) return;
    if (this.ended()) {
      this.seek(0);
      this.playing.set(true);
      return;
    }
    if (this.playing()) void this.save();
    this.playing.set(!this.playing());
  }

  protected jump(delta: number): void {
    const story = this.story();
    const current = this.current();
    if (!story || !current) return;
    const target = delta < 0 && current.local > 1500 ? current.index : current.index + delta;
    this.seek(sceneStart(story.scenes, Math.max(0, Math.min(story.scenes.length - 1, target))));
  }

  // ---------------------------------------------------------------- story gestures

  private static readonly HOLD_MS = 220;
  private static readonly SWIPE_PX = 60;

  protected onPointerDown(e: PointerEvent): void {
    if (!this.story()) return;
    this.pointer = { x: e.clientX, y: e.clientY, at: performance.now(), wasPlaying: this.playing() };
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (!this.pointer) return;
      this.holding.set(true);
      if (this.playing()) this.playing.set(false);
    }, StoryPlayerComponent.HOLD_MS);
  }

  protected onPointerUp(e: PointerEvent): void {
    const start = this.pointer;
    this.pointer = null;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > StoryPlayerComponent.SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
      this.releaseHold(start.wasPlaying);
      this.swipe.emit(dy < 0 ? 'up' : 'down');
      return;
    }
    if (this.holding()) {
      this.releaseHold(start.wasPlaying);
      return;
    }
    // A tap: left third goes back a scene, the rest goes forward.
    const box = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    const left = box ? e.clientX - box.left < box.width / 3 : false;
    this.jump(left ? -1 : 1);
  }

  protected onPointerCancel(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    const start = this.pointer;
    this.pointer = null;
    if (start && this.holding()) this.releaseHold(start.wasPlaying);
  }

  private releaseHold(resume: boolean): void {
    this.holding.set(false);
    if (resume && !this.ended()) this.playing.set(true);
  }

  /** Shortcuts work while any control inside the player has focus. */
  protected onKeydown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const onButton = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement;
    if (key === 'k' || (key === ' ' && !onButton)) this.toggle();
    else if (key === 'arrowleft') this.jump(-1);
    else if (key === 'arrowright') this.jump(1);
    else if (key === 'm') this.toggleMute.emit();
    else if (key === 'c') this.toggleCaptions.emit();
    else return;
    e.preventDefault();
  }
}
