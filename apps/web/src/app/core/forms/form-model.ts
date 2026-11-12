import { signal, type WritableSignal } from '@angular/core';
import { hasErrors, type FieldErrors } from '../validation/validators';

type Validate<V> = (values: V) => { values: V; errors: FieldErrors<keyof V & string> };

/**
 * The react-hook-form + zodResolver behaviour the Next.js forms rely on: validate everything on submit,
 * then re-validate only the edited field; reset()/resetField(); focus the first invalid field, in
 * registration order (`fieldIds`), when submit-time validation fails.
 */
export class FormModel<V extends Record<string, string>> {
  readonly values: WritableSignal<V>;
  readonly errors = signal<FieldErrors<keyof V & string>>({});
  readonly submitting = signal(false);
  private submitted = false;

  constructor(
    private readonly initial: V,
    private readonly validate: Validate<V>,
    private readonly fieldIds: Partial<Record<keyof V & string, string>> = {},
  ) {
    this.values = signal(initial);
  }

  set(field: keyof V & string, value: string): void {
    this.values.update((current) => ({ ...current, [field]: value }));
    if (this.submitted) {
      const { errors } = this.validate(this.values());
      this.errors.update((current) => ({ ...current, [field]: errors[field] }));
    }
  }

  setError(field: keyof V & string, message: string): void {
    this.errors.update((current) => ({ ...current, [field]: message }));
  }

  reset(): void {
    this.values.set(this.initial);
    this.errors.set({});
    this.submitted = false;
  }

  resetField(field: keyof V & string): void {
    this.values.update((current) => ({ ...current, [field]: this.initial[field] }));
    this.errors.update((current) => ({ ...current, [field]: undefined }));
  }

  async submit(event: Event, onValid: (values: V) => Promise<void> | void): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;
    this.submitted = true;
    const { values, errors } = this.validate(this.values());
    this.errors.set(errors);
    if (hasErrors(errors)) {
      this.focusFirstError(errors);
      return;
    }
    this.submitting.set(true);
    try {
      await onValid(values);
    } finally {
      this.submitting.set(false);
    }
  }

  private focusFirstError(errors: FieldErrors<keyof V & string>): void {
    for (const [field, id] of Object.entries(this.fieldIds) as [keyof V & string, string][]) {
      const element = errors[field] ? document.getElementById(id) : null;
      if (element) {
        element.focus();
        return;
      }
    }
  }
}
