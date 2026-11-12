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
import { sectorLabel } from '../trading/trading-format';
import { AvailabilityBadgeComponent, MeterComponent } from './learning-parts.components';

const MENTOR_MODES: { value: SessionMentorMode; label: string; detail: string }[] = [
  { value: 'GUIDED', label: 'Guidé', detail: 'Un conseil direct sur le point le plus important.' },
  { value: 'SOCRATIC', label: 'Socratique', detail: 'Des questions qui vous mènent vous-même à la réponse.' },
  { value: 'CRITICAL', label: 'Critique', detail: 'Remet votre plan en question et signale ce qui peut mal tourner.' },
];

const WEIGHT_LABEL = { risk: 'Gestion du risque', decision: 'Qualité des décisions', reasoning: 'Raisonnement', execution: 'Exécution' } as const;
const ORDER_TYPE_WORD = { MARKET: 'marché', LIMIT: 'limite', STOP: 'stop' } as const;
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
  protected readonly orderTypes = computed(() =>
    (this.mission()?.rules.allowedOrderTypes ?? []).map((t) => ORDER_TYPE_WORD[t] ?? t.toLowerCase()).join(', '),
  );
  protected readonly durationLabel = computed(() => {
    const mission = this.mission();
    if (!mission) return '';
    const plural = mission.steps > 1;
    const unit = mission.stepLabel === 'day' ? (plural ? 'jours de bourse' : 'jour de bourse') : plural ? 'semaines' : 'semaine';
    return `${mission.steps} ${unit}`;
  });
  protected readonly tradable = computed(() => (this.mission()?.assets ?? []).map((a) => `${a.symbol} (${sectorLabel(a.sector)})`).join(', '));
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
      `Seuil de réussite ${this.mission()?.scoring.passThreshold} / 100. Le profit seul ne fait jamais réussir une mission : un résultat chanceux et imprudent est mal noté sur le risque et le raisonnement.`,
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
      if (!this.destroyed && slug === this.slug()) this.error.set(describeApiError(err, 'Impossible de charger cette mission.'));
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
      this.error.set(describeApiError(err, 'Impossible de démarrer la mission.'));
      this.starting.set(false);
    }
  }
}
