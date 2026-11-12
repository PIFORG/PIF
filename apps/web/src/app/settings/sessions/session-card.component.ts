import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { AuthSession } from '../../core/api/types';
import { describeDevice } from '../../core/format/device';

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

@Component({
  selector: 'mtr-session-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  styleUrl: './session-card.component.css',
  template: `
    <article class="card" [attr.aria-label]="label()">
      <div class="head">
        <h3 class="title" [attr.title]="raw()">{{ label() }}</h3>
        @if (session().current) {
          <span class="badge badge-active">Cet appareil</span>
        }
      </div>
      <dl class="meta">
        <div>
          <dt>Dernière activité</dt>
          <dd>{{ format(session().lastSeenAt) }}</dd>
        </div>
        <div>
          <dt>Créée</dt>
          <dd>{{ format(session().createdAt) }}</dd>
        </div>
        <div>
          <dt>Expire</dt>
          <dd>{{ format(session().expiresAt) }}</dd>
        </div>
      </dl>
      @if (!session().current) {
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="revoke.emit(session().id)">
          Révoquer la session
        </button>
      }
    </article>
  `,
})
export class SessionCardComponent {
  readonly session = input.required<AuthSession>();
  readonly busy = input(false);
  readonly revoke = output<string>();

  protected readonly label = computed(() => describeDevice(this.session().deviceLabel, this.session().userAgent));
  protected readonly raw = computed(() => this.session().userAgent || this.session().deviceLabel || null);
  protected readonly format = formatDate;
}
