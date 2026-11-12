import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import {
  ORDER_STATUS_LABEL,
  PortfolioApi,
  type Metric,
  type PortfolioSummary,
  type Provenance,
  type TradeOrderStatus,
} from '../core/api/trading-api';
import { IconComponent } from '../shared/icon/icon.component';
import { dateTime, describeTradingError, dt, pct, signedDt } from './trading-format';

/** Signed amount that never relies on colour alone. */
@Component({
  selector: 'span[mtr-signed-amount]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { '[class]': 'cssClass()' },
  template: `@if (value() !== 0) {<svg mtrIcon [name]="value() > 0 ? 'arrow-up' : 'arrow-down'" [size]="11" />} {{ text() }}`,
})
export class SignedAmountComponent {
  readonly value = input.required<number>();
  readonly kind = input<'dt' | 'pct'>('dt');
  protected readonly text = computed(() => (this.kind() === 'dt' ? signedDt(this.value()) : pct(this.value(), true)));
  protected readonly cssClass = computed(() =>
    this.value() > 0 ? 'num tr-pos' : this.value() < 0 ? 'num tr-neg' : 'num',
  );
}

/** A metric is either a number or an explicit reason it cannot be computed. Never a silent zero. */
@Component({
  selector: 'mtr-metric-value',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `@if (formatted(); as text) {<ng-container>{{ text }}</ng-container>} @else {<span aria-hidden="true">{{ dash }}</span><span class="tr-unavailable">Indisponible : {{ metric().unavailableReason ?? 'pas encore assez de données.' }}</span>}`,
})
export class MetricValueComponent {
  readonly metric = input.required<Metric>();
  readonly format = input.required<(value: number) => string>();
  protected readonly dash = '\u2014';
  protected readonly formatted = computed(() => {
    const value = this.metric().value;
    return value === null ? null : this.format()(value);
  });
}

const STATUS_BADGE: Record<TradeOrderStatus, string> = {
  OPEN: 'badge-info',
  PARTIALLY_FILLED: 'badge-pending',
  FILLED: 'badge-active',
  CANCELLED: 'badge-muted',
  REJECTED: 'badge-danger',
  EXPIRED: 'badge-muted',
};

@Component({
  selector: 'span[mtr-order-status]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'badge ' + badge()" },
  template: `{{ label() }}{{ partial() ? ' après exécution partielle' : '' }}`,
})
export class OrderStatusBadgeComponent {
  readonly status = input.required<TradeOrderStatus>();
  readonly filled = input<number | undefined>(undefined);
  protected readonly badge = computed(() => STATUS_BADGE[this.status()]);
  protected readonly label = computed(() => ORDER_STATUS_LABEL[this.status()]);
  protected readonly partial = computed(() => {
    const filled = this.filled();
    return (this.status() === 'CANCELLED' || this.status() === 'EXPIRED') && !!filled && filled > 0;
  });
}

@Component({
  selector: 'p[mtr-provenance-note]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'tr-provenance' },
  template: `<svg mtrIcon name="flask" [size]="16" /><span><strong>{{ kind() }}</strong> · {{ provenance().description }} Prix en {{ currency() }}{{ quoted() }}. Argent virtuel uniquement ; rien ici n'est une transaction réelle.</span>`,
})
export class ProvenanceNoteComponent {
  readonly provenance = input.required<Provenance>();
  readonly asOf = input<string | undefined>(undefined);
  protected readonly kind = computed(() =>
    this.provenance().kind === 'FICTIONAL' ? 'Prix simulés fictifs' : this.provenance().kind,
  );
  protected readonly currency = computed(() =>
    this.provenance().currency === 'TND' ? 'dinars tunisiens (DT)' : this.provenance().currency,
  );
  protected readonly quoted = computed(() => {
    const asOf = this.asOf();
    return asOf ? `, cotés le ${dateTime(asOf)}` : '';
  });
}

@Component({
  selector: 'mtr-portfolio-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <label class="tr-picker">
      <span class="sr-only">Portefeuille</span>
      <select class="select" (change)="changed.emit($any($event.target).value)">
        @for (portfolio of portfolios(); track portfolio.id) {
          <option [value]="portfolio.id" [selected]="portfolio.id === activeId()">{{ portfolio.name }} · {{ equity(portfolio) }}</option>
        }
      </select>
    </label>
  `,
})
export class PortfolioPickerComponent {
  readonly portfolios = input.required<PortfolioSummary[]>();
  readonly activeId = input<string | null>(null);
  readonly changed = output<string>();

  protected equity(portfolio: PortfolioSummary): string {
    return dt(portfolio.equity);
  }
}

const NAME = /^[\p{L}\p{N} .,'&()-]{1,60}$/u;
const CAPITAL = /^\d+(\.\d{1,3})?$/;

@Component({
  selector: 'mtr-create-portfolio-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <form (submit)="submit($event)" novalidate aria-label="Créer un portefeuille virtuel">
      <div class="tr-createForm">
        <div class="field">
          <label class="field-label" for="portfolio-name">Nom du portefeuille</label>
          <input
            id="portfolio-name"
            class="input"
            [value]="name()"
            maxlength="60"
            placeholder="ex. Croissance"
            (input)="name.set($any($event.target).value)"
            [attr.aria-invalid]="name().length > 0 && !nameValid()"
          />
          @if (name().length > 0 && !nameValid()) {
            <p class="field-error">Utilisez des lettres, des chiffres, des espaces et . , ' &amp; ( ) -</p>
          }
        </div>
        <div class="field">
          <label class="field-label" for="portfolio-capital">Trésorerie virtuelle de départ (DT)</label>
          <input
            id="portfolio-capital"
            class="input num"
            inputmode="decimal"
            [value]="capital()"
            (input)="capital.set($any($event.target).value)"
            [attr.aria-invalid]="!capitalValid()"
            aria-describedby="portfolio-capital-hint"
          />
          <p id="portfolio-capital-hint" [class]="capitalValid() ? 'field-hint' : 'field-error'">Entre 1 000 et 1 000 000 DT.</p>
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="!nameValid() || !capitalValid() || pending()">{{ pending() ? 'Création…' : compact() ? 'Créer' : 'Créer le portefeuille' }}</button>
      </div>
      @if (error()) {
        <p class="form-error-banner" role="alert">{{ error() }}</p>
      }
    </form>
  `,
})
export class CreatePortfolioFormComponent {
  private readonly api = inject(PortfolioApi);
  readonly compact = input(false);
  readonly created = output<PortfolioSummary>();

  protected readonly name = signal('');
  protected readonly capital = signal('100000');
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal(false);
  protected readonly nameValid = computed(() => NAME.test(this.name().trim()));
  protected readonly capitalValid = computed(() => {
    const value = Number(this.capital());
    return CAPITAL.test(this.capital().trim()) && value >= 1000 && value <= 1_000_000;
  });

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.nameValid() || !this.capitalValid() || this.pending()) return;
    this.pending.set(true);
    this.error.set(null);
    try {
      const portfolio = await this.api.create({ name: this.name().trim(), initialCapital: Number(this.capital()) });
      this.name.set('');
      this.created.emit(portfolio);
    } catch (err) {
      this.error.set(describeTradingError(err, 'Le portefeuille n\'a pas pu être créé.'));
    } finally {
      this.pending.set(false);
    }
  }
}
