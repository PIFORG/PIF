import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { passwordStrength } from '../../core/validation/validators';

@Component({
  selector: 'mtr-password-strength-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  styleUrl: './password-strength-hint.component.css',
  template: `
    @if (password()) {
      <div class="wrap" aria-live="polite">
        <div class="track" aria-hidden="true">
          <div class="fill" [style.width.%]="percent()" [attr.data-score]="strength().score"></div>
        </div>
        <p class="label">Strength: <strong>{{ strength().label }}</strong></p>
      </div>
    }
  `,
})
export class PasswordStrengthHintComponent {
  readonly password = input('');
  protected readonly strength = computed(() => passwordStrength(this.password()));
  protected readonly percent = computed(() => Math.max(12, (this.strength().score / 5) * 100));
}
