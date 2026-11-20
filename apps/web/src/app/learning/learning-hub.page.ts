import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import '../../styles/lazy-learning';
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
import { IconComponent } from '../shared/icon/icon.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { AvailabilityBadgeComponent, CompetencyListComponent } from './learning-parts.components';

const LEVELS: LearningLevel[] = ['ROOKIE', 'STRATEGIST', 'COMMANDER'];

const CHARACTER_NAME: Record<StorySummary['character'], string> = { SARAH: 'Sarah', ADAM: 'Adam', YOUSSEF: 'Youssef' };

interface HubData {
  profile: LearningProfile;
  missions: MissionSummary[];
  stories: StorySummary[];
}

interface ContinueFocus {
  mission: MissionSummary;
  kind: 'resume' | 'recommend' | 'next';
  reason: string | null;
  sessionId: string | null;
  step: number | null;
}

/** /learn — parcours pédagogique : progression + prochaine action + carte des missions. */
@Component({
  selector: 'mtr-learning-hub-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, IconComponent, ...WORKSPACE_PRIMITIVES, AvailabilityBadgeComponent, CompetencyListComponent],
  host: { style: 'display: contents' },
  templateUrl: './learning-hub.page.html',
})
export class LearningHubPage {
  private readonly learningApi = inject(LearningApi);
  private readonly storiesApi = inject(StoriesFeedApi);
  private destroyed = false;

  protected readonly data = signal<HubData | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly levelLabel = LEVEL_LABEL;
  protected readonly competencyLabel = COMPETENCY_LABEL;
  protected readonly characterName = CHARACTER_NAME;
  protected readonly formatDateTime = formatDateTime;
  protected readonly round = Math.round;

  protected readonly profile = computed(() => this.data()?.profile);
  protected readonly nextStory = computed(() => {
    const stories = this.data()?.stories;
    return stories?.find((s) => !s.progress.completed) ?? stories?.[0];
  });
  protected readonly levels = computed(() => {
    const missions = this.data()?.missions ?? [];
    return LEVELS.map((level, index) => ({ level, index, missions: missions.filter((m) => m.level === level) }));
  });

  /** Priorité : session active → recommandation API → première mission jouable non verrouillée / non réussie. */
  protected readonly continueFocus = computed((): ContinueFocus | null => {
    const data = this.data();
    if (!data) return null;
    const { profile, missions } = data;
    const active = profile.activeSessions[0];
    if (active) {
      const mission = missions.find((m) => m.slug === active.missionSlug);
      if (mission) {
        return { mission, kind: 'resume', reason: null, sessionId: active.id, step: active.currentStep };
      }
    }
    const rec = profile.recommendations[0];
    if (rec) {
      const mission = missions.find((m) => m.slug === rec.slug);
      if (mission?.playable) {
        return { mission, kind: 'recommend', reason: rec.reason, sessionId: mission.progress.activeSessionId, step: null };
      }
    }
    const next = missions.find((m) => m.playable && !m.levelLocked && !m.progress.passed);
    if (next) return { mission: next, kind: 'next', reason: null, sessionId: next.progress.activeSessionId, step: null };
    return null;
  });

  protected readonly lastActivity = computed(() => {
    const profile = this.profile();
    if (!profile) return null;
    const active = profile.activeSessions[0];
    if (active) return `${active.missionTitle} · étape ${active.currentStep}`;
    const recent = profile.recentAssessments[0];
    if (recent) return `${recent.missionTitle} · ${formatDateTime(recent.createdAt)}`;
    return null;
  });

  protected readonly calibrationValue = computed(() => {
    const profile = this.profile();
    return profile?.calibration.interpretable && profile.calibration.brierScore !== null ? profile.calibration.brierScore.toFixed(3) : '—';
  });
  protected readonly calibrationHint = computed(() => {
    const profile = this.profile();
    if (!profile?.calibration.ratedOrders) return 'Notez votre confiance sur les ordres pour la voir.';
    return profile.calibration.interpretable
      ? `Score de Brier sur ${profile.calibration.observations} résultats ajustés du marché · plus bas, mieux c'est`
      : `${profile.calibration.observations} sur ${profile.calibration.minimumOrders} résultats nécessaires avant que ce chiffre ait un sens`;
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
      if (!this.destroyed) this.error.set(describeApiError(err, "Impossible de charger votre profil d'apprentissage."));
    }
  }
}
