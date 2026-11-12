import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatDT, type StoryCharacter } from '../core/api/learning-api';
import type { StoryScene, StoryVisual } from '../core/api/stories-api';
import { easeOut, sparkPath } from './story-timeline';

export const CHARACTER_NAME: Record<StoryCharacter, string> = { SARAH: 'Sarah', ADAM: 'Adam', YOUSSEF: 'Youssef' };

/**
 * The motion-graphics frame of one scene (Visual in apps/web/src/components/learning/stories/StoryPlayer.tsx).
 * `progress` runs from 0 to 1 over the scene's animation; every style is derived from it, so pausing freezes the frame.
 */
@Component({
  selector: 'mtr-story-visual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (intro(); as v) {
      <div class="st-avatar" [style.transform]="v.scale" aria-hidden="true">{{ v.initial }}</div>
      <div [style.opacity]="fadeOpacity()" [style.transform]="fadeTransform()">
        <div class="st-name">{{ v.name }}</div>
        <div class="st-label">Starting amount</div>
        <div class="st-big">{{ v.amount }}</div>
      </div>
    } @else if (headline(); as v) {
      <div class="st-headline" [attr.data-sentiment]="v.sentiment" [style.opacity]="fadeOpacity()" [style.transform]="fadeTransform()">
        <span class="st-label">{{ v.sentiment === 'NEUTRAL' ? 'Coming up' : 'Breaking' }}</span>
        <strong>{{ v.text }}</strong>
      </div>
      @if (scene().kind === 'DECISION') {
        <div class="st-choices" aria-hidden="true" [style.opacity]="choicesOpacity()">
          <p><span>A</span> or <span>B</span>?</p>
          <small>Decide in your head — the story shows both paths.</small>
        </div>
      }
    } @else if (allocation(); as v) {
      <div class="st-alloc">
        <span class="st-label">Portfolio</span>
        @for (s of v; track s.label) {
          <div class="st-allocRow">
            <span>{{ s.label }} · {{ s.shown }} %</span>
            <span class="st-allocTrack"><span [style.width.%]="s.width"></span></span>
          </div>
        }
      </div>
    } @else if (chart(); as v) {
      @if (v.label) {
        <span class="st-label">{{ v.label }}</span>
      }
      <svg class="st-chart" [attr.data-tone]="v.tone" viewBox="0 0 300 160" role="img" [attr.aria-label]="v.description">
        <path [attr.d]="v.d" pathLength="1" stroke-dasharray="1" [attr.stroke-dashoffset]="1 - eased()" />
      </svg>
      <div class="st-big" [style.opacity]="fadeOpacity()" [style.transform]="fadeTransform()">{{ v.last }}</div>
    } @else if (outcome(); as v) {
      <span class="st-label">{{ v.label }}</span>
      <div class="st-big">{{ v.value }}</div>
      <div class="st-delta" [attr.data-direction]="v.direction" [style.opacity]="fadeOpacity()" [style.transform]="fadeTransform()">{{ v.delta }}<span class="sr-only">{{ v.spoken }}</span></div>
      <span class="st-label" [style.opacity]="fadeOpacity()" [style.transform]="fadeTransform()">from {{ v.from }}</span>
    } @else if (visual().type === 'rewind') {
      <div class="st-rewind">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          aria-hidden="true"
          [style.transform]="'rotate(' + -540 * eased() + 'deg)'"
        >
          <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
          <path d="M3.5 3.5v3.5H7" />
        </svg>
        <div class="st-rewindTitle">Let's rewind!</div>
        <span class="st-label">Back to the decision</span>
      </div>
    } @else if (lesson(); as v) {
      <span class="st-label">Takeaways</span>
      <ul class="st-points">
        @for (point of v.points; track point; let i = $index) {
          <li
            [style.opacity]="i < v.shown ? 1 : 0"
            [style.transform]="i < v.shown ? 'none' : 'translateY(8px)'"
            style="transition: opacity 300ms, transform 300ms"
          >{{ point }}</li>
        }
      </ul>
    }
  `,
})
export class StoryVisualComponent {
  readonly visual = input.required<StoryVisual>();
  readonly scene = input.required<StoryScene>();
  readonly progress = input.required<number>();

  protected readonly eased = computed(() => easeOut(this.progress()));
  protected readonly fadeOpacity = computed(() => Math.min(1, this.progress() * 2.5));
  protected readonly fadeTransform = computed(() => `translateY(${(1 - this.eased()) * 12}px)`);
  protected readonly choicesOpacity = computed(() => Math.max(0, this.progress() * 2 - 0.6));

  protected readonly intro = computed(() => {
    const v = this.visual();
    if (v.type !== 'intro') return null;
    const p = this.eased();
    const name = CHARACTER_NAME[v.character];
    return { name, initial: name[0], scale: `scale(${0.85 + 0.15 * p})`, amount: formatDT(v.amount * p, 0) };
  });

  protected readonly headline = computed(() => {
    const v = this.visual();
    return v.type === 'headline' ? v : null;
  });

  protected readonly allocation = computed(() => {
    const v = this.visual();
    if (v.type !== 'allocation') return null;
    const p = this.eased();
    return v.slices.map((s) => ({ label: s.label, shown: Math.round(s.pct * p), width: s.pct * p }));
  });

  protected readonly chart = computed(() => {
    const v = this.visual();
    if (v.type !== 'chart') return null;
    const first = v.series[0];
    const last = v.series[v.series.length - 1];
    return {
      label: v.label,
      tone: v.tone,
      d: sparkPath(v.series, 300, 160),
      description: `Chart from ${first.toLocaleString('en-US')} to ${last.toLocaleString('en-US')}`,
      last: last.toLocaleString('en-US', { maximumFractionDigits: 3 }),
    };
  });

  protected readonly outcome = computed(() => {
    const v = this.visual();
    if (v.type !== 'outcome') return null;
    const value = v.from + (v.to - v.from) * this.eased();
    const delta = v.to - v.from;
    const deltaPct = (delta / v.from) * 100;
    const direction = delta < 0 ? 'down' : 'up';
    return {
      label: v.label,
      value: formatDT(value, 2),
      direction,
      delta: `${direction === 'down' ? '▼' : '▲'} ${formatDT(Math.abs(delta))} (${deltaPct >= 0 ? '+' : '−'}${Math.abs(deltaPct).toFixed(1)} %)`,
      spoken: direction === 'down' ? ' decrease' : ' increase',
      from: formatDT(v.from, 2),
    };
  });

  protected readonly lesson = computed(() => {
    const v = this.visual();
    if (v.type !== 'lesson') return null;
    const progress = this.progress();
    const shown = progress >= 1 ? v.points.length : Math.ceil(progress * v.points.length * 1.4);
    return { points: v.points, shown };
  });
}
