import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterEveryRender,
  computed,
  input,
  output,
  viewChild,
  type Signal,
} from '@angular/core';

/**
 * Keeps the DOM value equal to the model after every render, like a React controlled input. A `[value]`
 * binding alone misses a reset when the field was typed into and cleared before change detection ran
 * (e.g. a password manager filling and submitting in one task), leaving the old secret on screen.
 */
export function syncControlledValue(control: Signal<ElementRef<HTMLInputElement>>, value: Signal<string>): void {
  afterEveryRender({
    write: () => {
      const element = control().nativeElement;
      if (element.value !== value()) element.value = value();
    },
  });
}

/**
 * Counterpart of apps/web AuthFormField (text input variant). The control is driven by `value`;
 * `normalize` mimics a React controlled input that rewrites what was typed.
 */
@Component({
  selector: 'mtr-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div class="field">
      <label [attr.for]="controlId()">{{ label() }}</label>
      <input
        #control
        [id]="controlId()"
        class="input"
        [attr.name]="name()"
        [attr.type]="type()"
        [attr.autocomplete]="autocomplete()"
        [attr.inputmode]="inputmode()"
        [attr.maxlength]="maxlength()"
        [attr.pattern]="pattern()"
        [attr.spellcheck]="spellcheck()"
        [attr.required]="required() ? '' : null"
        [attr.aria-invalid]="error() ? true : null"
        [attr.aria-describedby]="describedBy()"
        [value]="value()"
        (input)="onInput($any($event.target))"
      />
      @if (hint()) {
        <span [id]="controlId() + '-hint'" class="field-hint">{{ hint() }}</span>
      }
      @if (error()) {
        <span [id]="controlId() + '-error'" class="field-error" role="alert">{{ error() }}</span>
      }
    </div>
  `,
})
export class FormFieldComponent {
  readonly fieldId = input<string | undefined>(undefined);
  readonly label = input.required<string>();
  readonly name = input<string | undefined>(undefined);
  readonly type = input<string | undefined>(undefined);
  readonly autocomplete = input<string | undefined>(undefined);
  readonly inputmode = input<string | undefined>(undefined);
  readonly maxlength = input<number | undefined>(undefined);
  readonly pattern = input<string | undefined>(undefined);
  readonly spellcheck = input<'false' | undefined>(undefined);
  readonly required = input(false);
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | null | undefined>(undefined);
  readonly value = input('');
  readonly normalize = input<(raw: string) => string>((raw) => raw);
  readonly valueChange = output<string>();

  protected readonly controlId = computed(
    () => this.fieldId() || this.name() || `field-${this.label().replace(/\s+/g, '-').toLowerCase()}`,
  );
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

  protected onInput(target: HTMLInputElement): void {
    const next = this.normalize()(target.value);
    if (next !== target.value) target.value = next;
    this.valueChange.emit(next);
  }
}
