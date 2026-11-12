import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { describeApiError } from '../core/api/errors';
import {
  COMPETENCY_LABEL,
  LEVEL_LABEL,
  LearningApi,
  formatDT,
  type MissionBriefing,
  type MissionSummary,
  type SessionMentorMode,
} from '../core/api/learning-api';
import { IconComponent } from '../shared/icon/icon.component';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { AvailabilityBadgeComponent, MeterComponent } from './learning-parts.components';

const MENTOR_MODES: { value: SessionMentorMode; label: string; detail: string }[] = [
  { value: 'GUIDED', label: 'Guided', detail: 'Direct advice on the most important issue.' },
  { value: 'SOCRATIC', label: 'Socratic', detail: 'Questions that lead you to the answer yourself.' },
  { value: 'CRITICAL', label: 'Critical', detail: 'Challenges your plan and points out what could go wrong.' },
];

const WEIGHT_LABEL = { risk: 'Risk management', decision: 'Decision quality', reasoning: 'Reasoning', execution: 'Execution' } as const;
const WEIGHT_KEYS = Object.keys(WEIGHT_LABEL) as (keyof typeof WEIGHT_LABEL)[];

/** /learn/missions/:slug: apps/web/src/components/learning/MissionBriefingView.tsx */
@Component({
  selector: 'mtr-mission-briefing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeadingComponent, HeadingActionsSlot, ...WORKSPACE_PRIMITIVES, AvailabilityBadgeComponent, MeterComponent],
  host: { style: 'display: contents' },
  templateUrl: './mission-briefing.page.html',
})
export class MissionBriefingPage {
  private readonly learningApi = inject(LearningApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private destroyed = false;

  protected readonly slug = toSignal(this.route.paramMap.pipe(map((params) => params.get('slug') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('slug') ?? '',
  });
  protected readonly mission = signal<MissionBriefing | null>(null);
  protected readonly summary = signal<MissionSummary | null>(null);
  protected readonly mode = signal<SessionMentorMode | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly starting = signal(false);

  protected readonly mentorModes = MENTOR_MODES;
  protected readonly weightKeys = WEIGHT_KEYS;
  protected readonly weightLabel = WEIGHT_LABEL;
  protected readonly levelLabel = LEVEL_LABEL;
  protected readonly formatDT = formatDT;

  protected readonly activeId = computed(() => this.summary()?.progress.activeSessionId ?? null);
  protected readonly playable = computed(() => this.summary()?.playable ?? this.mission()?.availability !== 'PLANNED');
  protected readonly maxLoss = computed(() => this.mission()?.failure.find((f) => f.kind === 'MAX_LOSS')?.limitPct);
  protected readonly selectedMode = computed(() => this.mode() ?? this.mission()?.mentorMode);
  protected readonly orderTypes = computed(() => (this.mission()?.rules.allowedOrderTypes ?? []).map((t) => t.toLowerCase()).join(', '));
  protected readonly tradable = computed(() => (this.mission()?.assets ?? []).map((a) => `${a.symbol} (${a.sector})`).join(', '));
  protected readonly competencies = computed(() => (this.mission()?.competencies ?? []).map((c) => COMPETENCY_LABEL[c.competency]).join(', '));
  protected readonly positions = computed(() => {
    const mission = this.mission();
    return (mission?.initialPositions ?? []).map((p) => ({
      symbol: p.symbol,
      name: mission?.assets.find((a) => a.symbol === p.symbol)?.name ?? p.symbol,
      quantity: p.quantity.toLocaleString('en-US'),
    }));
  });
  protected readonly scoringDescription = computed(
    () =>
      `Pass mark ${this.mission()?.scoring.passThreshold} / 100. Profit alone never passes a mission: a lucky, reckless result scores low on risk and reasoning.`,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect(() => {
      const slug = this.slug();
      untracked(() => void this.load(slug));
    });
  }

  protected async load(slug = this.slug()): Promise<void> {
    this.error.set(null);
    try {
      const [briefing, catalog] = await Promise.all([this.learningApi.mission(slug), this.learningApi.missions()]);
      if (this.destroyed || slug !== this.slug()) return;
      this.mission.set(briefing);
      this.summary.set(catalog.missions.find((m) => m.slug === slug) ?? null);
    } catch (err) {
      if (!this.destroyed && slug === this.slug()) this.error.set(describeApiError(err, 'Could not load this mission.'));
    }
  }

  protected async start(): Promise<void> {
    const mission = this.mission();
    if (!mission) return;
    this.starting.set(true);
    this.error.set(null);
    try {
      const { session } = await this.learningApi.start(mission.slug, this.mode() ?? mission.mentorMode);
      if (!this.destroyed) void this.router.navigateByUrl(`/learn/sessions/${session.id}`);
    } catch (err) {
      if (this.destroyed) return;
      this.error.set(describeApiError(err, 'Could not start the mission.'));
      this.starting.set(false);
    }
  }
}
