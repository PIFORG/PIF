import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { syncControlledValue } from './form-field.component';

/** Counterpart of apps/web PasswordField: password input with a Show/Hide toggle. */
@Component({
  selector: 'mtr-password-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="field">
      <label [attr.for]="controlId()">{{ label() }}</label>
      <div class="password-wrap">
        <input
          #control
          [id]="controlId()"
          [attr.name]="name()"
          class="input"
          [type]="visible() ? 'text' : 'password'"
          [attr.aria-invalid]="error() ? true : null"
          [attr.aria-describedby]="describedBy()"
          [attr.autocomplete]="autocomplete()"
          [attr.required]="required() ? '' : null"
          [value]="value()"
          (input)="valueChange.emit($any($event.target).value)"
        />
        <button
          type="button"
          class="password-toggle"
          (click)="visible.set(!visible())"
          [attr.aria-pressed]="visible()"
          [attr.aria-label]="visible() ? 'Hide password' : 'Show password'"
        >
          {{ visible() ? 'Hide' : 'Show' }}
        </button>
      </div>
      @if (hint()) {
        <span [id]="controlId() + '-hint'" class="field-hint">{{ hint() }}</span>
      }
      @if (error()) {
        <span [id]="controlId() + '-error'" class="field-error" role="alert">{{ error() }}</span>
      }
    </div>
  `,
})
export class PasswordFieldComponent {
  readonly fieldId = input<string | undefined>(undefined);
  readonly label = input.required<string>();
  readonly name = input<string | undefined>(undefined);
  readonly autocomplete = input<string | undefined>(undefined);
  readonly required = input(false);
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | null | undefined>(undefined);
  readonly value = input('');
  readonly valueChange = output<string>();

  protected readonly visible = signal(false);
  protected readonly controlId = computed(() => this.fieldId() || this.name() || 'password');
  protected readonly describedBy = computed(
    () =>
      [this.hint() ? `${this.controlId()}-hint` : null, this.error() ? `${this.controlId()}-error` : null]
        .filter(Boolean)
        .join(' ') || null,
  );
  private readonly control = viewChild.required<ElementRef<HTMLInputElement>>('control');

  constructor() {
    syncControlledValue(this.control, this.value);
  }
}
