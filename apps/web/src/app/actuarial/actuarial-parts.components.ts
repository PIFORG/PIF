import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { describeApiError, hasErrorCode } from '../core/api/errors';
import { IconComponent } from '../shared/icon/icon.component';

/* apps/web/src/components/actuarial/parts.tsx, the NumberField and Segmented controls of AssumptionsForm.tsx and the
 * ColumnChart of apps/web/src/components/charts/Charts.tsx (only the actuarial lab draws columns). */

/** Explains a failed request in plain English; maps the "migration pending" case explicitly. */
export function describeActuarialError(error: unknown, fallback: string, feature: 'scenarios' | 'simulations' | 'reserving' = 'scenarios'): string {
  if (hasErrorCode(error, 'DATABASE_SCHEMA_OUTDATED')) {
    if (feature === 'reserving') return 'Les simulations de provisionnement enregistrées ne sont pas encore activées sur ce serveur : la migration de base provisionnement n\'a pas été appliquée. Les calculs de provisions fonctionnent toujours.';
    return feature === 'simulations'
      ? 'Les runs Monte Carlo ne sont pas encore activés sur ce serveur : la migration de base simulation n\'a pas été appliquée. Les calculs de tarification fonctionnent toujours.'
      : 'Les scénarios enregistrés ne sont pas encore activés sur ce serveur : la migration de base actuarielle n\'a pas été appliquée. Les calculs de tarification fonctionnent toujours.';
  }
  return describeApiError(error, fallback);
}

/** A success or error line under a panel's form. */
export interface ActuarialMessage {
  tone: 'error' | 'ok';
  text: string;
}

/** Workspaces of the lab. Only built ones are links; the others are announced as planned. */
export const ACTUARIAL_WORKSPACES = [
  { id: 'overview', title: "Vue d'ensemble", href: '/actuarial', available: true },
  { id: 'pricing', title: 'Studio sinistres et tarification', href: '/actuarial/pricing', available: true },
  { id: 'monte-carlo', title: 'Laboratoire Monte Carlo', href: '/actuarial/monte-carlo', available: true },
  { id: 'reserving', title: 'Studio de provisionnement', href: '/actuarial/reserving', available: true },
  { id: 'capital', title: 'Capital économique', href: null, available: false },
  { id: 'alm', title: 'Laboratoire ALM', href: null, available: false },
] as const;

@Component({
  selector: 'nav[mtr-actuarial-tabs]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  host: { 'aria-label': 'Espaces du laboratoire actuariel' },
  template: `
    <ul class="ac-tabs">
      @for (w of workspaces; track w.id) {
        <li>
          @if (w.href) {
            <a [routerLink]="w.href" class="ac-tab" routerLinkActive="" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">{{ w.title }}</a>
          } @else {
            <span class="ac-tab" aria-disabled="true">{{ w.title }} <span class="ac-tabNote">Prévu</span></span>
          }
        </li>
      }
    </ul>
  `,
})
export class ActuarialTabsComponent {
  protected readonly workspaces = ACTUARIAL_WORKSPACES;
}

@Component({
  selector: 'p[mtr-estimate-note]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'ac-provenance' },
  template: `
    <svg mtrIcon name="info" [size]="16" />
    <span>
      <strong>Estimations du modèle à partir d'hypothèses fictives.</strong>&ngsp;<ng-content
        >Aucune donnée de sinistres observée n'est utilisée. Les résultats viennent des modèles actuariels côté serveur et servent à l'apprentissage, pas au reporting réglementaire ni aux provisions techniques.</ng-content
      >
    </span>
  `,
})
export class EstimateNoteComponent {}

@Component({
  selector: 'div[mtr-number-field]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'field' },
  template: `
    <label class="field-label" [attr.for]="fieldId()">{{ label() }}{{ suffix() ? ' (' + suffix() + ')' : '' }}</label>
    <input
      [id]="fieldId()"
      class="input num"
      inputmode="decimal"
      autocomplete="off"
      [value]="value()"
      [attr.placeholder]="placeholder() ?? null"
      [attr.aria-invalid]="error() ? true : null"
      [attr.aria-describedby]="describedBy()"
      (input)="changed.emit($any($event.target).value)"
    />
    @if (hint()) {
      <p [id]="fieldId() + '-hint'" class="field-hint">{{ hint() }}</p>
    }
    @if (error()) {
      <p [id]="fieldId() + '-error'" class="field-error">{{ error() }}</p>
    }
  `,
})
export class NumberFieldComponent {
  readonly fieldId = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input<string | undefined>(undefined);
  readonly suffix = input<string | undefined>(undefined);
  readonly value = input.required<string>();
  readonly error = input<string | undefined>(undefined);
  readonly placeholder = input<string | undefined>(undefined);
  readonly changed = output<string>();
  protected readonly describedBy = computed(
    () => [this.hint() ? `${this.fieldId()}-hint` : null, this.error() ? `${this.fieldId()}-error` : null].filter(Boolean).join(' ') || null,
  );
}

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
}

@Component({
  selector: 'div[mtr-segmented]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', class: 'ac-segmented', '[attr.aria-label]': 'label()', '[attr.data-count]': 'options().length' },
  template: `
    @for (o of options(); track o.value) {
      <button type="button" [attr.aria-pressed]="value() === o.value" (click)="changed.emit(o.value)">{{ o.label }}</button>
    }
  `,
})
export class SegmentedComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly options = input.required<readonly SegmentedOption[]>();
  readonly changed = output<string>();
}

/* ---------- Column chart ---------- */

export interface ChartMarker {
  label: string;
  value: number;
  tone: 'brand' | 'cyan' | 'amber' | 'neg';
}

const W = 1000;
const COLUMN_TICKS = [0, 0.5, 1];

/** Responsive histogram / probability-mass chart with labelled reference markers. Pure SVG drawn from inputs. */
@Component({
  selector: 'figure[mtr-column-chart]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ch-figure' },
  template: `
    <div class="ch-plot" [style.height.px]="height()">
      <div class="ch-yAxis" aria-hidden="true">
        @for (tick of axis(); track tick.t) {
          <span class="num" [style.top.%]="tick.t * 100">{{ tick.label }}</span>
        }
      </div>
      <svg class="ch-svg" [attr.viewBox]="'0 0 1000 ' + height()" preserveAspectRatio="none" role="img" [attr.aria-label]="summary()">
        @for (t of ticks; track t) {
          <line x1="0" x2="1000" [attr.y1]="t * height()" [attr.y2]="t * height()" class="ch-gridLine" vector-effect="non-scaling-stroke" />
        }
        @for (c of columns(); track $index) {
          <rect class="ch-column" [attr.x]="c.x" [attr.y]="c.y" [attr.width]="c.width" [attr.height]="c.height" />
        }
        @for (m of drawnMarkers(); track m.label) {
          <line class="ch-marker" [attr.data-tone]="m.tone" [attr.x1]="m.x" [attr.x2]="m.x" y1="0" [attr.y2]="height()" vector-effect="non-scaling-stroke" />
        }
      </svg>
    </div>
    <figcaption class="ch-caption">
      <span class="ch-legend">
        <span class="ch-legendItem"><span class="ch-columnSwatch" aria-hidden="true"></span>{{ seriesLabel() }}</span>
        @for (m of legend(); track m.label) {
          <span class="ch-legendItem"
            ><span class="ch-swatch" [attr.data-tone]="m.tone" data-dashed="true" aria-hidden="true"></span>{{ m.label }}: <span class="num">{{ m.text }}</span
            >{{ m.offScale ? ' (off scale)' : '' }}</span
          >
        }
      </span>
      <span class="ch-xLabels" aria-hidden="true">
        <span>{{ range().from }}</span>
        <span>to</span>
        <span>{{ range().to }}</span>
      </span>
    </figcaption>
  `,
})
export class ColumnChartComponent {
  /** values[i] is the height of the column covering [from + i·binWidth, from + (i + 1)·binWidth). */
  readonly from = input.required<number>();
  readonly binWidth = input.required<number>();
  readonly values = input.required<number[]>();
  readonly summary = input.required<string>();
  readonly height = input(200);
  readonly formatX = input<(value: number) => string>((v) => v.toFixed(0));
  readonly formatY = input<(value: number) => string>((v) => v.toFixed(2));
  /** Vertical reference lines (e.g. expected value, premium), listed with their values in the legend. */
  readonly markers = input<ChartMarker[]>([]);
  readonly seriesLabel = input('Probability');

  protected readonly ticks = COLUMN_TICKS;

  private readonly scale = computed(() => {
    const values = this.values();
    const max = Math.max(...values, Number.MIN_VALUE) * 1.08;
    const n = Math.max(values.length, 1);
    return { max, n, span: n * this.binWidth() };
  });

  private readonly visible = computed(() => {
    const from = this.from();
    const { span } = this.scale();
    return this.markers().filter((m) => m.value >= from && m.value <= from + span);
  });

  protected readonly axis = computed(() => {
    const { max } = this.scale();
    const format = this.formatY();
    return COLUMN_TICKS.map((t) => ({ t, label: format(max - t * max) }));
  });

  protected readonly columns = computed(() => {
    const { max, n } = this.scale();
    const h = this.height();
    const columnWidth = W / n;
    const gap = Math.min(columnWidth * 0.18, 4);
    return this.values().map((v, i) => {
      const height = max > 0 ? (v / max) * h : 0;
      return { x: i * columnWidth + gap / 2, y: h - height, width: Math.max(columnWidth - gap, 0.5), height };
    });
  });

  protected readonly drawnMarkers = computed(() => {
    const from = this.from();
    const { span } = this.scale();
    return this.visible().map((m) => ({ label: m.label, tone: m.tone, x: ((m.value - from) / span) * W }));
  });

  protected readonly legend = computed(() => {
    const visible = this.visible();
    const format = this.formatX();
    return this.markers().map((m) => ({ label: m.label, tone: m.tone, text: format(m.value), offScale: !visible.includes(m) }));
  });

  protected readonly range = computed(() => {
    const format = this.formatX();
    return { from: format(this.from()), to: format(this.from() + this.scale().span) };
  });
}
