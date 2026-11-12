import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let nextId = 0;

/**
 * Counterpart of apps/web ConfirmDialog. Projected content (step-up fields) is wrapped in a form when
 * `hasFields` is set, so Enter confirms. The input is `heading`, not `title`: a static `title` attribute
 * on the host element would become a tooltip over the whole dialog.
 */
@Component({
  selector: 'mtr-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (open()) {
      <div class="dialog-backdrop" role="presentation" (mousedown)="onBackdrop($event)">
        <div
          #panel
          class="dialog-panel"
          role="alertdialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          [attr.aria-describedby]="error() ? descId + ' ' + errorId : descId"
        >
          <h2 [id]="titleId">{{ heading() }}</h2>
          <p [id]="descId">{{ description() }}</p>
          @if (hasFields()) {
            <form (submit)="onSubmit($event)" novalidate>
              <ng-content />
              <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
            </form>
          }
          @if (error()) {
            <p [id]="errorId" class="form-error-banner" role="alert">{{ error() }}</p>
          }
          <div class="dialog-actions">
            <button #cancelButton type="button" class="btn btn-secondary" (click)="cancelled.emit()" [disabled]="busy()">
              {{ cancelLabel() }}
            </button>
            <button
              type="button"
              [class]="danger() ? 'btn btn-danger' : 'btn btn-primary'"
              (click)="confirmed.emit()"
              [disabled]="busy()"
              [attr.aria-busy]="busy()"
            >
              {{ busy() ? 'Traitement…' : confirmLabel() }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  readonly open = input.required<boolean>();
  readonly heading = input.required<string>();
  readonly description = input.required<string>();
  readonly confirmLabel = input('Confirmer');
  readonly cancelLabel = input('Annuler');
  readonly danger = input(false);
  readonly busy = input(false);
  readonly hasFields = input(false);
  /** Inline error shown inside the dialog so it is not hidden behind the overlay. */
  readonly error = input<string | null | undefined>(null);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly id = ++nextId;
  protected readonly titleId = `confirm-dialog-${this.id}-title`;
  protected readonly descId = `confirm-dialog-${this.id}-desc`;
  protected readonly errorId = `confirm-dialog-${this.id}-error`;
  private readonly panel = viewChild<ElementRef<HTMLDivElement>>('panel');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    afterRenderEffect((onCleanup) => {
      const panel = this.panel()?.nativeElement;
      if (!this.open() || !panel) return;
      untracked(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        // Danger dialogs focus the first field (or Annuler), never the destructive button.
        const firstInput = panel.querySelector<HTMLElement>('input, select, textarea');
        (firstInput ?? this.cancelButton()?.nativeElement)?.focus();

        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape' && !this.busy()) {
            e.preventDefault();
            this.cancelled.emit();
            return;
          }
          if (e.key !== 'Tab') return;
          const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        };
        document.addEventListener('keydown', onKey);
        onCleanup(() => {
          document.removeEventListener('keydown', onKey);
          previouslyFocused?.focus?.();
        });
      });
    });
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget && !this.busy()) this.cancelled.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.busy()) this.confirmed.emit();
  }
}
