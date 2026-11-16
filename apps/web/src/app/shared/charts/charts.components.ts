import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * apps/web/src/components/charts/Charts.tsx: pure SVG drawn from inputs. Hover overlay is local
 * pointer state only — no timers or subscriptions that outlive the component.
 */

export interface ChartSeries {
  label: string;
  values: number[];
  tone: 'brand' | 'cyan' | 'muted';
  /** Draw a filled area under the first series. */
  area?: boolean;
  dashed?: boolean;
}

const W = 1000;
const TICKS = [0, 0.25, 0.5, 0.75, 1];
let gradientSeq = 0;

export function niceBounds(values: number[], minSpan = 0): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || Math.abs(max) || 1) * 0.08;
  const lo = min - pad;
  const hi = max + pad;
  if (hi - lo >= minSpan) return [lo, hi];
  const mid = (min + max) / 2;
  return [mid - minSpan / 2, mid + minSpan / 2];
}

export function toPath(values: number[], min: number, max: number, h: number, count = values.length): string {
  const step = count > 1 ? W / (count - 1) : W;
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)} ${(h - ((v - min) / (max - min)) * h).toFixed(2)}`)
    .join(' ');
}

/** Responsive line/area chart. Drawing scales with preserveAspectRatio="none"; labels are HTML so text never distorts. */
@Component({
  selector: 'figure[mtr-line-chart]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ch-figure' },
  template: `
    <div class="ch-plot" [style.height.px]="height()">
      <div class="ch-yAxis" aria-hidden="true">
        @for (tick of axis(); track tick.t) {
          <span class="num" [style.top.%]="tick.t * 100">{{ tick.label }}</span>
        }
      </div>
      <div
        class="ch-plotSurface"
        (pointermove)="onMove($event)"
        (pointerleave)="clearTip()"
      >
        <svg class="ch-svg" [attr.viewBox]="'0 0 1000 ' + height()" preserveAspectRatio="none" role="img" [attr.aria-label]="summary()">
          <defs>
            <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--mtr-brand)" stop-opacity="0.22" />
              <stop offset="1" stop-color="var(--mtr-brand)" stop-opacity="0" />
            </linearGradient>
          </defs>
          @for (t of ticks; track t) {
            <line x1="0" x2="1000" [attr.y1]="t * height()" [attr.y2]="t * height()" class="ch-gridLine" vector-effect="non-scaling-stroke" />
          }
          @for (s of paths(); track s.label) {
            <g>
              @if (s.area) {
                <path [attr.d]="s.area" [attr.fill]="'url(#' + gradientId + ')'" />
              }
              <path [attr.d]="s.d" class="ch-line" [attr.data-tone]="s.tone" [attr.stroke-dasharray]="s.dashed ? '6 5' : null" vector-effect="non-scaling-stroke" />
            </g>
          }
          @if (tip(); as t) {
            <line class="ch-crosshair" [attr.x1]="t.x" [attr.x2]="t.x" y1="0" [attr.y2]="height()" vector-effect="non-scaling-stroke" />
            @for (dot of t.dots; track dot.label) {
              <circle class="ch-activeDot" [attr.cx]="t.x" [attr.cy]="dot.y" r="4" vector-effect="non-scaling-stroke" />
            }
          }
        </svg>
        @if (tip(); as t) {
          <div class="ch-tip" [style.left.%]="t.leftPct" role="status">
            <strong>{{ t.title }}</strong>
            @for (row of t.rows; track row.label) {
              <span>{{ row.label }} · {{ row.value }}</span>
            }
          </div>
        }
      </div>
    </div>
    <figcaption class="ch-caption">
      <span class="ch-legend">
        @for (s of series(); track s.label) {
          <span class="ch-legendItem"><span class="ch-swatch" [attr.data-tone]="s.tone" [attr.data-dashed]="s.dashed ? 'true' : null" aria-hidden="true"></span>{{ s.label }}</span>
        }
      </span>
      @if (xLabels(); as labels) {
        <span class="ch-xLabels" aria-hidden="true"><span>{{ labels[0] }}</span><span>{{ labels[1] }}</span></span>
      }
    </figcaption>
  `,
})
export class LineChartComponent {
  readonly series = input.required<ChartSeries[]>();
  /** Plain-language description read by assistive technology. */
  readonly summary = input.required<string>();
  readonly height = input(220);
  readonly formatY = input<(value: number) => string>((v) => v.toFixed(0));
  readonly xLabels = input<[string, string] | undefined>(undefined);
  /** Optional per-index labels for the hover tooltip (dates, periods…). */
  readonly pointLabels = input<string[] | undefined>(undefined);
  /** Number of x positions on the axis; defaults to the longest series. Shorter series stop early instead of stretching. */
  readonly xCount = input<number | undefined>(undefined);
  /** Smallest y range to show, centred on the data, so tiny moves are not stretched into dramatic swings. */
  readonly minSpan = input<number | undefined>(undefined);
  /** Lower bound of the y axis for quantities that cannot go below it (e.g. 0 for a density). */
  readonly yMin = input<number | undefined>(undefined);

  protected readonly ticks = TICKS;
  protected readonly gradientId = `ch-gradient-${++gradientSeq}`;
  protected readonly tip = signal<{
    x: number;
    leftPct: number;
    title: string;
    rows: { label: string; value: string }[];
    dots: { label: string; y: number }[];
  } | null>(null);

  private readonly bounds = computed(() => {
    const all = this.series().flatMap((s) => s.values);
    const [paddedMin, max] = niceBounds(all, this.minSpan());
    const yMin = this.yMin();
    const min = yMin === undefined ? paddedMin : Math.max(yMin, paddedMin);
    const count = this.xCount() ?? Math.max(...this.series().map((s) => s.values.length));
    return { min, max, count };
  });

  protected readonly axis = computed(() => {
    const { min, max } = this.bounds();
    const format = this.formatY();
    return TICKS.map((t) => ({ t, label: format(max - t * (max - min)) }));
  });

  protected readonly paths = computed(() => {
    const { min, max, count } = this.bounds();
    const h = this.height();
    return this.series().map((s) => {
      const d = toPath(s.values, min, max, h, count);
      const end = count > 1 ? ((s.values.length - 1) * W) / (count - 1) : W;
      return {
        label: s.label,
        tone: s.tone,
        dashed: !!s.dashed,
        d,
        area: s.area ? `${d} L${end.toFixed(2)} ${h} L0 ${h} Z` : null,
      };
    });
  });

  protected onMove(event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const { min, max, count } = this.bounds();
    if (count < 1) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = count === 1 ? 0 : Math.round(ratio * (count - 1));
    const step = count > 1 ? W / (count - 1) : 0;
    const x = index * step;
    const h = this.height();
    const format = this.formatY();
    const labels = this.pointLabels();
    const title = labels?.[index] ?? (this.xLabels() ? `Point ${index + 1}` : `Index ${index + 1}`);
    const rows: { label: string; value: string }[] = [];
    const dots: { label: string; y: number }[] = [];
    for (const s of this.series()) {
      if (index >= s.values.length) continue;
      const v = s.values[index];
      rows.push({ label: s.label, value: format(v) });
      const y = h - ((v - min) / (max - min || 1)) * h;
      dots.push({ label: s.label, y });
    }
    this.tip.set({
      x,
      leftPct: (x / W) * 100,
      title,
      rows,
      dots,
    });
  }

  protected clearTip(): void {
    this.tip.set(null);
  }
}

@Component({
  selector: 'svg[mtr-sparkline]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ch-spark',
    role: 'img',
    '[attr.width]': 'width()',
    '[attr.height]': 'height()',
    '[attr.viewBox]': "'0 0 ' + width() + ' ' + height()",
    '[attr.aria-label]': 'label()',
  },
  template: `<svg:path [attr.d]="d()" [attr.data-tone]="rising() ? 'pos' : 'neg'" class="ch-sparkLine" />`,
})
export class SparklineComponent {
  readonly values = input.required<number[]>();
  readonly label = input.required<string>();
  readonly width = input(96);
  readonly height = input(28);

  protected readonly d = computed(() => {
    const values = this.values();
    const [min, max] = niceBounds(values);
    const step = this.width() / (values.length - 1);
    const h = this.height();
    return values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${(h - ((v - min) / (max - min)) * h).toFixed(1)}`)
      .join(' ');
  });
  protected readonly rising = computed(() => {
    const values = this.values();
    return values[values.length - 1] >= values[0];
  });
}

const ALLOCATION_TONES = ['brand', 'cyan', 'amber', 'violet', 'muted'] as const;

@Component({
  selector: 'div[mtr-allocation-bar]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ch-allocation' },
  template: `
    <div class="ch-allocBar" role="img" [attr.aria-label]="label()">
      @for (item of items(); track item.label; let i = $index) {
        <span class="ch-allocSegment" [attr.data-tone]="tone(i)" [style.width.%]="item.weight * 100"></span>
      }
    </div>
    <ul class="ch-allocLegend">
      @for (item of items(); track item.label; let i = $index) {
        <li>
          <span class="ch-allocSwatch" [attr.data-tone]="tone(i)" aria-hidden="true"></span>
          <span class="ch-allocName">{{ item.label }}</span>
          <span class="num">{{ (item.weight * 100).toFixed(0) }}%</span>
        </li>
      }
    </ul>
  `,
})
export class AllocationBarComponent {
  readonly items = input.required<{ label: string; weight: number }[]>();
  readonly label = input.required<string>();

  protected tone(index: number): string {
    return ALLOCATION_TONES[index % ALLOCATION_TONES.length];
  }
}
