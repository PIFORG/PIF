import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  AVAILABILITY_LABEL,
  COMPETENCY_LABEL,
  type CompetencyMastery,
  type MissionAvailability,
  type ObjectiveResult,
  type ObjectiveStatus,
} from '../core/api/learning-api';
import { IconComponent, type IconName } from '../shared/icon/icon.component';

/** apps/web/src/components/learning/parts.tsx. LearnShell is the workspace layout (protected route + app shell). */

const AVAILABILITY_BADGE: Record<MissionAvailability, string> = {
  IMPLEMENTED: 'badge badge-active',
  CONFIGURED: 'badge badge-info',
  PLANNED: 'badge badge-muted',
};

@Component({
  selector: 'span[mtr-availability-badge]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'badgeClass()' },
  template: `{{ label() }}`,
})
export class AvailabilityBadgeComponent {
  readonly availability = input.required<MissionAvailability>();
  protected readonly badgeClass = computed(() => AVAILABILITY_BADGE[this.availability()]);
  protected readonly label = computed(() => AVAILABILITY_LABEL[this.availability()]);
}

const EVIDENCE_LABEL: Record<CompetencyMastery['evidenceLevel'], string> = {
  NONE: 'Pas encore de preuve',
  EMERGING: 'Preuve émergente',
  DEVELOPING: 'Preuve en développement',
  ESTABLISHED: 'Preuve établie',
};

export function scoreTone(score: number | null): 'neg' | 'amber' | undefined {
  if (score === null) return undefined;
  if (score < 40) return 'neg';
  if (score < 60) return 'amber';
  return undefined;
}

@Component({
  selector: 'div[mtr-meter]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lr-meter',
    role: 'meter',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.data-tone]': 'tone() ?? null',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'value()',
    '[attr.aria-valuetext]': 'valueText()',
  },
  template: `<span [style.width.%]="width()"></span>@if (marker() !== undefined) {<span class="lr-meterMarker" [style.left.%]="marker()" aria-hidden="true"></span>}`,
})
export class MeterComponent {
  readonly value = input.required<number | null>();
  readonly label = input.required<string>();
  readonly marker = input<number | undefined>(undefined);
  protected readonly width = computed(() => {
    const value = this.value();
    return value === null ? 0 : Math.max(0, Math.min(100, value));
  });
  protected readonly tone = computed(() => scoreTone(this.value()));
  protected readonly valueText = computed(() => {
    const value = this.value();
    return value === null ? 'Pas encore évalué' : `${Math.round(value)} sur 100`;
  });
}

@Component({
  selector: 'div[mtr-competency-list]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MeterComponent],
  host: { class: 'lr-stack' },
  template: `
    @for (c of rows(); track c.competency) {
      <div class="lr-competency">
        <div class="lr-competencyHead">
          <strong>{{ c.label }}</strong>
          <span class="num">{{ c.score }}</span>
        </div>
        <div mtr-meter [value]="c.value" [label]="c.label + ' — maîtrise'"></div>
        <div class="lr-spread">
          <span class="lr-muted">{{ c.evidence }}</span>
          <span class="lr-muted">Sans mentor {{ c.unassisted }} · Avec le mentor {{ c.assisted }}</span>
        </div>
      </div>
    }
  `,
})
export class CompetencyListComponent {
  readonly competencies = input.required<CompetencyMastery[]>();
  protected readonly rows = computed(() =>
    this.competencies().map((c) => ({
      competency: c.competency,
      label: COMPETENCY_LABEL[c.competency],
      value: c.score,
      score: c.score === null ? '—' : `${Math.round(c.score)} / 100`,
      evidence: `${EVIDENCE_LABEL[c.evidenceLevel]}${c.observations ? ` · ${c.observations} mission${c.observations === 1 ? '' : 's'}` : ''}`,
      unassisted: c.unassistedScore === null ? '—' : Math.round(c.unassistedScore),
      assisted: c.assistedScore === null ? '—' : Math.round(c.assistedScore),
    })),
  );
}

const OBJECTIVE_ICON: Record<ObjectiveStatus, IconName> = {
  PENDING: 'clock',
  ON_TRACK: 'check',
  AT_RISK: 'alert',
  MET: 'check',
  NOT_MET: 'close',
  FAILED: 'close',
};

const OBJECTIVE_TEXT: Record<ObjectiveStatus, string> = {
  PENDING: 'En attente',
  ON_TRACK: 'En bonne voie',
  AT_RISK: 'À risque',
  MET: 'Atteint',
  NOT_MET: 'Non atteint',
  FAILED: 'Échoué',
};

@Component({
  selector: 'ul[mtr-objective-list]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'lr-list' },
  template: `
    @for (o of objectives(); track o.id) {
      <li class="lr-objective" [attr.data-status]="o.status">
        <span class="lr-objectiveIcon" aria-hidden="true"><svg mtrIcon [name]="icon[o.status]" [size]="12" /></span>
        <div>
          <strong>{{ o.label }}{{ o.required ? '' : ' (facultatif)' }}</strong>
          <span>{{ text[o.status] }} · {{ o.detail }}</span>
        </div>
      </li>
    }
  `,
})
export class ObjectiveListComponent {
  readonly objectives = input.required<ObjectiveResult[]>();
  protected readonly icon = OBJECTIVE_ICON;
  protected readonly text = OBJECTIVE_TEXT;
}

export function pct(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value.toFixed(digits)} %`;
}
