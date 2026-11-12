import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { describeApiError, hasErrorCode } from '../core/api/errors';
import {
  COMPETENCY_LABEL,
  LearningApi,
  RATIONALE_LABEL,
  formatDT,
  type Assessment,
  type AssessmentComponentKey,
  type BranchStrategy,
  type ComparedSession,
  type Comparison,
  type Competency,
  type LearningSession,
  type MentorMessage,
  type Timeline,
  type TimelineDecision,
} from '../core/api/learning-api';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { IconComponent } from '../shared/icon/icon.component';
import { HeadingActionsSlot, PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { MeterComponent, ObjectiveListComponent, pct } from './learning-parts.components';

const COMPONENT_LABEL: Record<AssessmentComponentKey, string> = {
  risk: 'Risk management',
  decision: 'Decision quality',
  reasoning: 'Reasoning',
  execution: 'Execution',
};

const formatEquityAxis = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));

function sessionName(s: ComparedSession): string {
  return s.kind === 'MISSION' ? 'Original attempt' : `Replay from decision ${s.branchFromSeq}`;
}

const COMPARISON_ROWS: { label: string; value: (s: ComparedSession) => string }[] = [
  { label: 'Status', value: (s) => s.status.toLowerCase() },
  { label: 'Score', value: (s) => (s.assessment ? `${s.assessment.total} · ${s.assessment.passed ? 'passed' : 'not passed'}` : 'Not assessed') },
  { label: 'Final value', value: (s) => formatDT(s.metrics.equity) },
  { label: 'Return', value: (s) => pct(s.metrics.totalReturnPct, 2) },
  { label: 'Max drawdown', value: (s) => pct(s.metrics.maxDrawdownPct) },
  { label: 'Largest position', value: (s) => pct(s.metrics.maxWeightPct) },
  { label: 'Trading decisions', value: (s) => String(s.decisions) },
  { label: 'Fees and spread', value: (s) => formatDT(s.metrics.feesPaid + s.metrics.spreadCost) },
];

/** Side-by-side view of two attempts on the same market path (ComparisonView in SessionReview.tsx). */
@Component({
  selector: 'div[mtr-comparison-view]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LineChartComponent],
  host: { class: 'lr-stack' },
  template: `
    <figure mtr-line-chart [series]="view().series" [xCount]="steps() + 1" [height]="200" [summary]="view().summary" [formatY]="formatY" [xLabels]="xLabels"></figure>
    <div class="lr-compareGrid" role="table" aria-label="Side-by-side comparison">
      <div role="row" style="display: contents">
        <div class="lr-compareHead" role="columnheader">Measure</div>
        <div class="lr-compareHead" role="columnheader">{{ view().nameA }}</div>
        <div class="lr-compareHead" role="columnheader">{{ view().nameB }}</div>
      </div>
      @for (r of view().rows; track r.label) {
        <div role="row" style="display: contents">
          <div role="rowheader">{{ r.label }}</div>
          <div role="cell" class="num">{{ r.a }}</div>
          <div role="cell" class="num">{{ r.b }}</div>
        </div>
      }
    </div>
    <p class="lr-muted">{{ view().note }}</p>
  `,
})
export class ComparisonViewComponent {
  readonly comparison = input.required<Comparison>();
  readonly steps = input.required<number>();
  protected readonly formatY = formatEquityAxis;
  protected readonly xLabels: [string, string] = ['Start', 'End'];
  protected readonly view = computed(() => {
    const comparison = this.comparison();
    const [a, b] = comparison.sessions;
    const nameA = sessionName(a);
    const nameB = sessionName(b);
    const series: ChartSeries[] = [
      { label: nameA, values: a.equityCurve.map((p) => p.equity), tone: 'brand' },
      { label: nameB, values: b.equityCurve.map((p) => p.equity), tone: 'cyan', dashed: true },
    ];
    return {
      nameA,
      nameB,
      series,
      summary: `Portfolio value of ${nameA} and ${nameB} on the same market path.`,
      rows: COMPARISON_ROWS.map((r) => ({ label: r.label, a: r.value(a), b: r.value(b) })),
      note: `${comparison.divergenceSeq ? `The paths split at decision ${comparison.divergenceSeq}. ` : 'Both sessions made the same decisions. '}${comparison.note}`,
    };
  });
}

/** /learn/sessions/:id/review: apps/web/src/components/learning/SessionReview.tsx (assessment, debrief, Financial Time Machine). */
@Component({
  selector: 'mtr-session-review-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IconComponent,
    PageHeadingComponent,
    HeadingActionsSlot,
    ...WORKSPACE_PRIMITIVES,
    LineChartComponent,
    MeterComponent,
    ObjectiveListComponent,
    ComparisonViewComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './session-review.page.html',
})
export class SessionReviewPage {
  private readonly learningApi = inject(LearningApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private destroyed = false;

  protected readonly sessionId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('id') ?? '',
  });
  protected readonly session = signal<LearningSession | null>(null);
  protected readonly assessment = signal<Assessment | null>(null);
  protected readonly timeline = signal<Timeline | null>(null);
  protected readonly debrief = signal<MentorMessage | null>(null);
  protected readonly comparison = signal<Comparison | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly fromSeq = signal<number | null>(null);
  protected readonly strategy = signal<BranchStrategy>('HOLD');

  protected readonly componentLabel = COMPONENT_LABEL;
  protected readonly rationaleLabel = RATIONALE_LABEL;
  protected readonly formatDT = formatDT;
  protected readonly pct = pct;
  protected readonly round = Math.round;
  protected readonly formatEquityAxis = formatEquityAxis;

  protected readonly marketAdjusted = computed(() => this.assessment()?.calibration.method === 'MARKET_ADJUSTED');
  protected readonly isReplay = computed(() => this.session()?.kind === 'REPLAY');
  protected readonly stepWord = computed(() => (this.session()?.state.stepLabel === 'day' ? 'Day' : 'Week'));
  protected readonly decisions = computed(() => (this.timeline()?.decisions ?? []).filter((d) => d.type !== 'REQUEST_HINT'));
  protected readonly competencyScores = computed(() =>
    (Object.entries(this.assessment()?.competencyScores ?? {}) as [Competency, number | null][]).map(([competency, score]) => ({
      competency,
      label: COMPETENCY_LABEL[competency],
      score,
    })),
  );
  protected readonly calibrationNote = computed(() => {
    const calibration = this.assessment()?.calibration;
    return `${calibration?.observations ?? 0} outcome(s) compared. At least ${calibration?.minimumOrders ?? 10} are needed before this says anything about over- or under-confidence, and a poor outcome on its own is not evidence of overconfidence.`;
  });
  protected readonly timelineChart = computed(() => {
    const timeline = this.timeline();
    const session = this.session();
    if (!timeline || !session) return null;
    return {
      series: [{ label: 'Portfolio value', values: timeline.equityCurve.map((p) => p.equity), tone: 'brand', area: true }] as ChartSeries[],
      xCount: session.state.steps + 1,
      summary: `Portfolio value through the mission, ending at ${formatDT(timeline.equityCurve[timeline.equityCurve.length - 1]?.equity ?? 0)}.`,
      xLabels: ['Start', `${this.stepWord()} ${session.state.steps}`] as [string, string],
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect(() => {
      const id = this.sessionId();
      untracked(() => {
        this.session.set(null);
        this.timeline.set(null);
        this.assessment.set(null);
        this.debrief.set(null);
        this.comparison.set(null);
        this.fromSeq.set(null);
        void this.load(id);
      });
    });
  }

  private async load(id = this.sessionId()): Promise<void> {
    this.error.set(null);
    try {
      const [s, t] = await Promise.all([this.learningApi.session(id), this.learningApi.timeline(id)]);
      if (this.destroyed || id !== this.sessionId()) return;
      this.session.set(s);
      this.timeline.set(t);
      if (s.status === 'COMPLETED' || s.status === 'FAILED') {
        try {
          const assessment = await this.learningApi.assessment(id);
          if (!this.destroyed && id === this.sessionId()) this.assessment.set(assessment);
        } catch (err) {
          if (!hasErrorCode(err, 'ASSESSMENT_NOT_READY')) throw err;
        }
      }
    } catch (err) {
      if (!this.destroyed && id === this.sessionId()) this.error.set(describeApiError(err, 'Could not load this review.'));
    }
  }

  private async act<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    this.busy.set(label);
    this.actionError.set(null);
    try {
      return await fn();
    } catch (err) {
      this.actionError.set(describeApiError(err, 'That action failed.'));
      return null;
    } finally {
      this.busy.set(null);
    }
  }

  protected async loadDebrief(): Promise<void> {
    const res = await this.act('debrief', () => this.learningApi.mentor(this.sessionId(), 'DEBRIEF'));
    if (res && !this.destroyed) this.debrief.set(res.mentor);
  }

  protected async compareWith(otherId: string): Promise<void> {
    const res = await this.act(`compare-${otherId}`, () => this.learningApi.compare(this.sessionId(), otherId));
    if (res && !this.destroyed) this.comparison.set(res);
  }

  protected async branch(): Promise<void> {
    const fromSeq = this.fromSeq();
    if (fromSeq === null) return;
    const created = await this.act('branch', () => this.learningApi.branch(this.sessionId(), fromSeq, this.strategy()));
    if (!created || this.destroyed) return;
    if (created.status === 'ACTIVE') {
      void this.router.navigateByUrl(`/learn/sessions/${created.id}`);
      return;
    }
    await this.load();
    await this.compareWith(created.id);
  }

  protected componentScore(c: Assessment['components'][number]): string {
    const applied = Math.round(c.appliedWeight);
    return `${c.score === null ? 'Not judged' : `${Math.round(c.score)} / 100`} · weight ${applied} %${applied !== c.configuredWeight ? ` (configured ${c.configuredWeight} %)` : ''}`;
  }

  protected decisionText(d: TimelineDecision): string {
    return `· ${d.summary}${d.rationale ? ` · ${RATIONALE_LABEL[d.rationale]}` : ''}${d.outcome === 'REJECTED' ? ' · rejected' : ''}`;
  }

  protected setStrategy(value: string): void {
    this.strategy.set(value as BranchStrategy);
  }
}
