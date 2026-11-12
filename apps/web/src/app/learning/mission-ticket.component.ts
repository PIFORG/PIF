import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import {
  LearningApi,
  RATIONALE_LABEL,
  formatDT,
  type LearningSession,
  type OrderPreview,
  type OrderType,
  type Rationale,
} from '../core/api/learning-api';
import { ticketFormErrors, toCommand, type TicketDraft } from './ticket';

const CONFIDENCE_OPTIONS = ['50', '60', '70', '80', '90', '100'];
const PREVIEW_DELAY_MS = 250;
const RATIONALES = Object.keys(RATIONALE_LABEL) as Rationale[];

/** The order ticket of apps/web/src/components/learning/MissionPlayer.tsx, with the server pre-trade preview. */
@Component({
  selector: 'form[mtr-mission-ticket]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'lr-ticket', novalidate: '', 'aria-describedby': 'ticket-preview', '(submit)': 'submit($event)' },
  templateUrl: './mission-ticket.component.html',
})
export class MissionTicketComponent {
  private readonly learningApi = inject(LearningApi);

  readonly session = input.required<LearningSession>();
  readonly draft = model.required<TicketDraft>();
  readonly disabled = input(false);
  readonly submitted = output<void>();

  protected readonly sides = ['BUY', 'SELL'] as const;
  protected readonly rationales = RATIONALES;
  protected readonly rationaleLabel = RATIONALE_LABEL;
  protected readonly confidenceOptions = CONFIDENCE_OPTIONS;
  protected readonly formatDT = formatDT;
  protected readonly touched = signal(false);

  protected readonly rules = computed(() => this.session().mission.rules);
  protected readonly formErrors = computed(() => ticketFormErrors(this.draft(), this.rules()));
  private readonly order = computed(() => (this.formErrors().length ? null : toCommand(this.draft())));
  /** The order the preview is for, ignored once the order or the session state changes. */
  private readonly requestKey = computed(() => {
    const order = this.disabled() ? null : this.order();
    return order ? `${this.session().id}:${this.session().lastSeq}:${JSON.stringify(order)}` : null;
  });
  private readonly result = signal<{ key: string; preview: OrderPreview | null } | null>(null);
  private readonly current = computed(() => {
    const result = this.result();
    return result && result.key === this.requestKey() ? result : null;
  });
  protected readonly preview = computed(() => this.current()?.preview ?? null);
  protected readonly checking = computed(() => this.requestKey() !== null && this.current() === null);
  protected readonly unavailable = computed(() => {
    const current = this.current();
    return current !== null && current.preview === null;
  });
  protected readonly estimate = computed(() => this.preview()?.estimate ?? null);
  protected readonly refusal = computed(() => {
    const preview = this.preview();
    return preview && !preview.accepted ? preview.message : null;
  });

  constructor() {
    effect((onCleanup) => {
      const key = this.requestKey();
      if (!key) return;
      const { id, lastSeq } = untracked(() => this.session());
      const order = untracked(() => this.order());
      if (!order) return;
      let cancelled = false;
      const timer = setTimeout(() => {
        this.learningApi.previewOrder(id, order).then(
          (preview) => !cancelled && this.result.set({ key, preview: preview.seq === lastSeq ? preview : null }),
          () => !cancelled && this.result.set({ key, preview: null }),
        );
      }, PREVIEW_DELAY_MS);
      onCleanup(() => {
        cancelled = true;
        clearTimeout(timer);
      });
    });
  }

  protected update(patch: Partial<TicketDraft>): void {
    this.draft.set({ ...this.draft(), ...patch });
  }

  protected changeType(type: OrderType): void {
    this.update({ type, ...(type === 'STOP' ? { side: 'SELL' as const } : {}) });
  }

  /** Trimmed like the controlled React inputs, so the field never shows characters the draft dropped. */
  protected trimmed(event: Event): string {
    const field = event.target as HTMLInputElement;
    const value = field.value.trim();
    if (field.value !== value) field.value = value;
    return value;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.touched.set(true);
    if (this.formErrors().length || this.refusal()) return;
    this.submitted.emit();
    this.touched.set(false);
  }
}
