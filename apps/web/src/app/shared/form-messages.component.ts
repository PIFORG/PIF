import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'mtr-form-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `@if (message()) {<div class="form-error-banner" role="alert">{{ message() }}</div>}`,
})
export class FormErrorComponent {
  readonly message = input<string | null | undefined>(null);
}

@Component({
  selector: 'mtr-form-success',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `@if (message()) {<div class="form-success-banner" role="status">{{ message() }}</div>}`,
})
export class FormSuccessComponent {
  readonly message = input<string | null | undefined>(null);
}
