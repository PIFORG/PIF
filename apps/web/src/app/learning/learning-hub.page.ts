import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../core/api/errors';
import {
  COMPETENCY_LABEL,
  LEVEL_LABEL,
  LearningApi,
  StoriesFeedApi,
  type LearningLevel,
  type LearningProfile,
  type MissionSummary,
  type StorySummary,
} from '../core/api/learning-api';
import { formatDateTime } from '../core/format/finance';
import { FR } from '../core/i18n/fr';
import { IconComponent } from '../shared/icon/icon.component';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { AvailabilityBadgeComponent, CompetencyListComponent } from './learning-parts.components';

const LEVELS: LearningLevel[] = ['ROOKIE', 'STRATEGIST', 'COMMANDER'];

const CHARACTER_NAME: Record<StorySummary['character'], string> = { SARAH: 'Sarah', ADAM: 'Adam', YOUSSEF: 'Youssef' };

interface HubData {
  profile: LearningProfile;
  missions: MissionSummary[];
  stories: StorySummary[];
}

/** /learn: apps/web/src/components/learning/LearningHub.tsx */
@Component({
  selector: 'mtr-learning-hub-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    IconComponent,
    PageHeadingComponent,
    HeadingActionsSlot,
    ...WORKSPACE_PRIMITIVES,
    AvailabilityBadgeComponent,
    CompetencyListComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './learning-hub.page.html',
})
export class LearningHubPage {
  private readonly learningApi = inject(LearningApi);
  private readonly storiesApi = inject(StoriesFeedApi);
  private destroyed = false;

  protected readonly copy = FR.learn;
  protected readonly data = signal<HubData | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly levelLabel = LEVEL_LABEL;
  protected readonly competencyLabel = COMPETENCY_LABEL;
  protected readonly characterName = CHARACTER_NAME;
  protected readonly formatDateTime = formatDateTime;
  protected readonly round = Math.round;

  protected readonly profile = computed(() => this.data()?.profile);
  protected readonly showcase = computed(() => this.data()?.missions.find((m) => m.slug === 'survive-the-market-crash'));
  protected readonly nextStory = computed(() => {
    const stories = this.data()?.stories;
    return stories?.find((s) => !s.progress.completed) ?? stories?.[0];
  });
  protected readonly levels = computed(() => {
    const missions = this.data()?.missions ?? [];
    return LEVELS.map((level, index) => ({ level, index, missions: missions.filter((m) => m.level === level) }));
  });

  protected readonly calibrationValue = computed(() => {
    const profile = this.profile();
    return profile?.calibration.interpretable && profile.calibration.brierScore !== null ? profile.calibration.brierScore.toFixed(3) : '—';
  });
  protected readonly calibrationHint = computed(() => {
    const profile = this.profile();
    if (!profile?.calibration.ratedOrders) return 'Rate your confidence on orders to see it.';
    return profile.calibration.interpretable
      ? `Brier score over ${profile.calibration.observations} market-adjusted outcomes · lower is better`
      : `${profile.calibration.observations} of ${profile.calibration.minimumOrders} outcomes needed before this is meaningful`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      const [profile, catalog, feed] = await Promise.all([this.learningApi.profile(), this.learningApi.missions(), this.storiesApi.feed()]);
      if (this.destroyed) return;
      this.data.set({ profile, missions: catalog.missions, stories: feed.stories });
    } catch (err) {
      if (!this.destroyed) this.error.set(describeApiError(err, 'Could not load your learning profile.'));
    }
  }
}
