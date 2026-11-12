import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { describeApiError, hasErrorCode } from '../core/api/errors';
import {
  LEVEL_LABEL,
  LearningApi,
  RATIONALE_LABEL,
  formatDT,
  newIdempotencyKey,
  type Command,
  type CommandResponse,
  type LearningSession,
  type MentorMessage,
  type MissionOrderView,
  type MissionPosition,
  type SessionMentorMode,
  type SessionState,
} from '../core/api/learning-api';
import { formatNumber } from '../core/format/finance';
import { LineChartComponent, type ChartSeries } from '../shared/charts/charts.components';
import { IconComponent } from '../shared/icon/icon.component';
import { PageHeadingComponent } from '../shared/page-heading/page-heading.component';
import { WORKSPACE_PRIMITIVES } from '../shared/workspace/workspace.components';
import { sectorLabel } from '../trading/trading-format';
import { ObjectiveListComponent, pct } from './learning-parts.components';
import { MissionTicketComponent } from './mission-ticket.component';
import { emptyDraft, toCommand, type TicketDraft } from './ticket';

const ORDER_STATUS_BADGE: Record<string, string> = {
  OPEN: 'badge badge-info',
  FILLED: 'badge badge-active',
  PARTIALLY_FILLED: 'badge badge-pending',
  CANCELLED: 'badge badge-muted',
  EXPIRED: 'badge badge-muted',
  REJECTED: 'badge badge-danger',
};

interface Notice {
  tone: 'info' | 'amber' | 'neg';
  text: string;
}

@Component({
  selector: 'dl[mtr-mission-metrics]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'lr-metricGrid' },
  template: `
    <div>
      <dt>Drawdown max.</dt>
      <dd>{{ pct(state().metrics.maxDrawdownPct) }}</dd>
    </div>
    <div>
      <dt>Investi</dt>
      <dd>{{ pct(state().metrics.exposurePct) }}</dd>
    </div>
    <div>
      <dt>Plus grosse position</dt>
      <dd>{{ pct(state().metrics.maxWeightPct) }}</dd>
    </div>
    <div>
      <dt>Actifs effectifs</dt>
      <dd>{{ state().metrics.effectiveAssets === null ? '—' : state().metrics.effectiveAssets!.toFixed(1) }}</dd>
    </div>
    <div>
      <dt [attr.title]="varTitle">VaR 1 jour 95 %</dt>
      <dd>{{ state().metrics.var95 === null ? '—' : formatDT(state().metrics.var95!, 0) }}</dd>
    </div>
    <div>
      <dt>Volatilité / pas</dt>
      <dd>{{ pct(state().metrics.volatilityPct, 2) }}</dd>
    </div>
    <div>
      <dt>Frais payés</dt>
      <dd>{{ formatDT(state().metrics.feesPaid) }}</dd>
    </div>
    <div>
      <dt>Coût de l'écart</dt>
      <dd>{{ formatDT(state().metrics.spreadCost) }}</dd>
    </div>
  `,
})
export class MissionMetricsComponent {
  readonly state = input.required<SessionState>();
  protected readonly pct = pct;
  protected readonly formatDT = formatDT;
  protected readonly varTitle = 'Valeur à risque historique à 1 jour et 95 % des positions actuelles';
}

/** /learn/sessions/:id: apps/web/src/components/learning/MissionPlayer.tsx */
@Component({
  selector: 'mtr-mission-player-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IconComponent,
    PageHeadingComponent,
    ...WORKSPACE_PRIMITIVES,
    LineChartComponent,
    ObjectiveListComponent,
    MissionTicketComponent,
    MissionMetricsComponent,
  ],
  host: { style: 'display: contents' },
  templateUrl: './mission-player.page.html',
})
export class MissionPlayerPage {
  private readonly learningApi = inject(LearningApi);
  private readonly route = inject(ActivatedRoute);
  private readonly ticketRef = viewChild<ElementRef<HTMLElement>>('ticketRef');
  private destroyed = false;
  private busyFlag = false;

  protected readonly sessionId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('id') ?? '',
  });
  protected readonly session = signal<LearningSession | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly notice = signal<Notice | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly mentor = signal<MentorMessage | null>(null);
  protected readonly mentorMode = signal<SessionMentorMode | null>(null);
  protected readonly draft = signal<TicketDraft | null>(null);
  protected readonly confirmAbandon = signal(false);

  protected readonly levelLabel = LEVEL_LABEL;
  protected readonly rationaleLabel = RATIONALE_LABEL;
  protected readonly orderStatusBadge = ORDER_STATUS_BADGE;
  protected readonly formatDT = formatDT;
  protected readonly formatPrice = (v: number) => v.toFixed(2);
  protected readonly formatEquity = (v: number) => formatNumber(v, 0);
  protected readonly sectorLabel = sectorLabel;
  protected readonly lossLimitTitle = "Distance jusqu'à la limite de perte";

  protected readonly state = computed(() => this.session()?.state ?? null);
  protected readonly selected = computed(() => this.draft()?.symbol ?? this.state()?.quotes[0]?.symbol ?? '');
  protected readonly ended = computed(() => this.session()?.status !== 'ACTIVE');
  protected readonly disabled = computed(() => this.ended() || this.busy() !== null);
  protected readonly stepWord = computed(() => (this.state()?.stepLabel === 'day' ? 'Jour' : 'Semaine'));
  protected readonly nextStepLabel = computed(() => (this.state()?.stepLabel === 'day' ? 'Jour suivant' : 'Semaine suivante'));
  protected readonly maxLoss = computed(() => this.session()?.mission.failure.find((f) => f.kind === 'MAX_LOSS')?.limitPct);
  protected readonly lossPct = computed(() => {
    const portfolio = this.state()?.portfolio;
    return portfolio ? ((portfolio.initialEquity - portfolio.equity) / portfolio.initialEquity) * 100 : 0;
  });
  protected readonly canStop = computed(() => !!this.session()?.mission.rules.allowedOrderTypes.includes('STOP'));
  protected readonly stressTests = computed(() => [...(this.state()?.stressTests ?? [])].reverse());
  protected readonly selectedName = computed(() => this.state()?.quotes.find((q) => q.symbol === this.selected())?.name ?? '');

  protected readonly chart = computed(() => {
    const state = this.state();
    if (!state) return null;
    const selected = this.selected();
    const history = state.priceHistory[selected] ?? [];
    if (!history.length) return null;
    const firstStep = history[0].step;
    const values = history.map((p) => p.mid);
    const position = state.portfolio.positions.find((p) => p.symbol === selected);
    const stop = state.orders.find((o) => o.symbol === selected && o.type === 'STOP' && o.status === 'OPEN');
    const series: ChartSeries[] = [{ label: `${selected} cours médian`, values, tone: 'brand', area: true }];
    if (position) series.push({ label: 'Votre coût moyen', values: values.map(() => position.averageCost), tone: 'muted', dashed: true });
    if (stop?.stopPrice) series.push({ label: 'Votre seuil', values: values.map(() => stop.stopPrice as number), tone: 'cyan', dashed: true });
    const stepWord = this.stepWord();
    const before = -firstStep;
    return {
      series,
      xCount: state.steps - firstStep + 1,
      summary: `${selected}, cours médian, de ${before} ${this.stepNoun(before)} avant la mission jusqu'au ${stepWord.toLowerCase()} ${state.step}.`,
      xLabels: [`${before} ${this.stepNoun(before)} avant`, `${stepWord} ${state.steps}`] as [string, string],
    };
  });

  protected readonly equityChart = computed(() => {
    const state = this.state();
    if (!state) return null;
    const stepWord = this.stepWord();
    return {
      series: [{ label: 'Valeur du portefeuille', values: state.equityCurve.map((p) => p.equity), tone: 'cyan', area: true }] as ChartSeries[],
      xCount: state.steps + 1,
      summary: `Valeur du portefeuille du début jusqu'au ${stepWord.toLowerCase()} ${state.step} : ${formatDT(state.portfolio.equity)}.`,
      minSpan: (state.equityCurve[0]?.equity ?? state.portfolio.equity) * 0.04,
      xLabels: ['Début', `${stepWord} ${state.steps}`] as [string, string],
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect(() => {
      const id = this.sessionId();
      untracked(() => {
        this.session.set(null);
        this.draft.set(null);
        this.mentor.set(null);
        this.notice.set(null);
        this.confirmAbandon.set(false);
        void this.load(id);
      });
    });
  }

  private async load(id = this.sessionId()): Promise<void> {
    this.loadError.set(null);
    try {
      const next = await this.learningApi.session(id);
      if (this.destroyed || id !== this.sessionId()) return;
      this.session.set(next);
      this.draft.update((d) => d ?? emptyDraft(next.state));
    } catch (err) {
      if (!this.destroyed && id === this.sessionId()) this.loadError.set(describeApiError(err, 'Impossible de charger cette mission.'));
    }
  }

  private async run<T>(label: string, action: () => Promise<T>): Promise<T | null> {
    if (this.busyFlag) return null;
    this.busyFlag = true;
    this.busy.set(label);
    this.notice.set(null);
    try {
      return await action();
    } catch (err) {
      if (hasErrorCode(err, 'SEQUENCE_CONFLICT', 'SESSION_CLOSED')) {
        await this.load();
        this.notice.set({ tone: 'amber', text: `${describeApiError(err, 'Cette mission a changé.')} Le dernier état est affiché.` });
      } else {
        this.notice.set({ tone: 'neg', text: describeApiError(err, 'Cette action a échoué.') });
      }
      return null;
    } finally {
      this.busyFlag = false;
      this.busy.set(null);
    }
  }

  protected async send(command: Command, label: string): Promise<CommandResponse | null> {
    const session = this.session();
    if (!session) return null;
    const body = { idempotencyKey: newIdempotencyKey(), expectedSeq: session.lastSeq, command };
    const res = await this.run(label, async () => {
      try {
        return await this.learningApi.command(session.id, body);
      } catch (err) {
        if (err instanceof TypeError) return this.learningApi.command(session.id, body);
        throw err;
      }
    });
    if (res && !this.destroyed) {
      this.session.set(res.session);
      this.notice.set({ tone: res.outcome === 'REJECTED' ? 'amber' : 'info', text: res.message });
    }
    return res;
  }

  protected async askMentor(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const res = await this.run('mentor', () => this.learningApi.mentor(session.id, this.mentorMode() ?? session.mentorMode));
    if (res && !this.destroyed) {
      this.mentor.set(res.mentor);
      this.session.set(res.session);
    }
  }

  protected async abandon(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const res = await this.run('abandon', () => this.learningApi.abandon(session.id));
    if (res && !this.destroyed) this.session.set(res);
    this.confirmAbandon.set(false);
  }

  protected prefill(patch: Partial<TicketDraft>): void {
    const session = this.session();
    if (!session) return;
    this.draft.set({ ...emptyDraft(session.state), ...patch });
    this.ticketRef()?.nativeElement.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  protected protect(p: MissionPosition): void {
    const bid = this.state()?.quotes.find((q) => q.symbol === p.symbol)?.bid ?? p.averageCost;
    this.prefill({
      symbol: p.symbol,
      side: 'SELL',
      type: 'STOP',
      quantity: String(p.quantity),
      price: (Math.floor(bid * 0.95 * 1000) / 1000).toFixed(3),
      rationale: 'LIMIT_DOWNSIDE',
    });
  }

  protected selectSymbol(symbol: string): void {
    this.draft.update((d) => (d ? { ...d, symbol } : d));
  }

  protected placeOrder(): void {
    const draft = this.draft();
    if (!draft) return;
    void this.send(toCommand(draft), 'order').then((res) => {
      if (res?.outcome === 'ACCEPTED') this.draft.set({ ...emptyDraft(res.session.state), symbol: draft.symbol });
    });
  }

  protected setDraft(next: TicketDraft): void {
    this.draft.set(next);
  }

  protected units(value: number): string {
    return value.toLocaleString('en-US');
  }

  protected orderPrice(o: MissionOrderView): string {
    if (o.averageFillPrice !== null) return o.averageFillPrice.toFixed(3);
    if (o.limitPrice !== null) return `≤ ${o.limitPrice.toFixed(3)}`;
    if (o.stopPrice !== null) return `seuil ${o.stopPrice.toFixed(3)}`;
    return '—';
  }

  protected orderTypeWord(type: string): string {
    if (type === 'MARKET') return 'marché';
    if (type === 'LIMIT') return 'limite';
    return 'stop';
  }

  protected sentimentWord(sentiment: string): string {
    if (sentiment === 'POSITIVE') return 'positif';
    if (sentiment === 'NEGATIVE') return 'négatif';
    if (sentiment === 'NEUTRAL') return 'neutre';
    return sentiment.toLowerCase();
  }

  protected orderStatus(o: MissionOrderView): string {
    const labels: Record<string, string> = {
      OPEN: 'ouvert',
      FILLED: 'exécuté',
      PARTIALLY_FILLED: 'partiellement exécuté',
      CANCELLED: 'annulé',
      EXPIRED: 'expiré',
      REJECTED: 'rejeté',
    };
    return labels[o.status] ?? o.status.toLowerCase();
  }

  private stepNoun(count: number): string {
    const word = this.stepWord().toLowerCase();
    if (Math.abs(count) <= 1) return word;
    return word === 'jour' ? 'jours' : 'semaines';
  }
}
