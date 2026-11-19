import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * Pure SVG charts from inputs. Hover overlay is local pointer state only.
 * Series tones map to --mtr-chart-* tokens (visualization palette).
 * Paths stay linear (M/L) so financial geometry is not cosmetically warped.
 */

export type ChartTone = 'brand' | 'cyan' | 'sky' | 'mauve' | 'violet' | 'lavender' | 'muted';

export interface ChartSeries {
  label: string;
  values: number[];
  tone: ChartTone;
  /** Draw a filled area under the series (per-tone gradient). */
  area?: boolean;
  dashed?: boolean;
}

const W = 1000;
const TICKS = [0, 0.25, 0.5, 0.75, 1];
let gradientSeq = 0;

const TONE_CSS: Record<ChartTone, string> = {
  brand: '--mtr-chart-brand',
  cyan: '--mtr-chart-sky',
  sky: '--mtr-chart-sky',
  mauve: '--mtr-chart-mauve',
  violet: '--mtr-chart-violet',
  lavender: '--mtr-chart-lavender',
  muted: '--mtr-chart-muted',
};

export function chartToneVar(tone: ChartTone): string {
  return TONE_CSS[tone] ?? TONE_CSS.brand;
}

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
  host: {
    class: 'ch-figure',
    '[attr.data-tip]': 'tip() ? "true" : null',
    '[attr.data-focus]': 'focusLabel() || null',
  },
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
        <svg
          class="ch-svg"
          [attr.viewBox]="'0 0 1000 ' + height()"
          preserveAspectRatio="none"
          role="img"
          [attr.aria-label]="summary()"
          [style.--ch-stroke-grad]="'url(#' + strokeGradId + ')'"
        >
          <defs>
            <pattern [attr.id]="gridId" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" class="ch-gridDot" />
            </pattern>
            <linearGradient [attr.id]="strokeGradId" x1="0" y1="0" x2="1000" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="var(--mtr-chart-brand)" />
              <stop offset="55%" stop-color="var(--mtr-chart-sky)" />
              <stop offset="100%" stop-color="var(--mtr-chart-mauve)" />
            </linearGradient>
            @for (s of paths(); track s.gradId) {
              @if (s.area) {
                <linearGradient [attr.id]="s.gradId" x1="0" y1="0" x2="0" y2="1">
                  @if (s.signature) {
                    <stop offset="0%" stop-color="var(--mtr-chart-brand)" stop-opacity="0.4" />
                    <stop offset="42%" stop-color="var(--mtr-chart-mauve)" stop-opacity="0.16" />
                    <stop offset="100%" stop-color="var(--mtr-chart-violet)" stop-opacity="0" />
                  } @else {
                    <stop offset="0%" [attr.stop-color]="'var(' + s.cssVar + ')'" stop-opacity="0.3" />
                    <stop offset="55%" [attr.stop-color]="'var(' + s.cssVar + ')'" stop-opacity="0.1" />
                    <stop offset="100%" [attr.stop-color]="'var(' + s.cssVar + ')'" stop-opacity="0" />
                  }
                </linearGradient>
              }
            }
          </defs>
          <rect class="ch-plotBed" x="0" y="0" width="1000" [attr.height]="height()" [attr.fill]="'url(#' + gridId + ')'" />
          @for (t of ticks; track t) {
            <line x1="0" x2="1000" [attr.y1]="t * height()" [attr.y2]="t * height()" class="ch-gridLine" vector-effect="non-scaling-stroke" />
          }
          @for (s of paths(); track s.label) {
            <g class="ch-series" [attr.data-tone]="s.tone" [attr.data-dim]="isDimmed(s.label) ? 'true' : null">
              @if (s.area) {
                <path class="ch-area" [attr.d]="s.area" [attr.fill]="'url(#' + s.gradId + ')'" />
              }
              <path
                [attr.d]="s.d"
                class="ch-line"
                [attr.data-tone]="s.tone"
                [attr.data-signature]="s.signature ? 'true' : null"
                [attr.stroke-dasharray]="s.dashed ? '6 5' : null"
                vector-effect="non-scaling-stroke"
              />
            </g>
          }
          @if (endpoint(); as ep) {
            <circle class="ch-endDot" [attr.data-tone]="ep.tone" [attr.cx]="ep.x" [attr.cy]="ep.y" r="3.5" vector-effect="non-scaling-stroke" />
          }
          @if (tip(); as t) {
            <line class="ch-crosshair" [attr.x1]="t.x" [attr.x2]="t.x" y1="0" [attr.y2]="height()" vector-effect="non-scaling-stroke" />
            @if (t.guideY !== null) {
              <line class="ch-crosshair ch-crosshairH" x1="0" x2="1000" [attr.y1]="t.guideY" [attr.y2]="t.guideY" vector-effect="non-scaling-stroke" />
            }
            @for (dot of t.dots; track dot.label) {
              <circle
                class="ch-activeDot"
                [attr.data-tone]="dot.tone"
                [attr.cx]="t.x"
                [attr.cy]="dot.y"
                r="4.5"
                vector-effect="non-scaling-stroke"
              />
            }
          }
        </svg>
        @if (endpoint(); as ep) {
          <span class="ch-priceTag" [attr.data-tone]="ep.tone" [style.top.px]="ep.y" aria-hidden="true">{{ ep.label }}</span>
        }
        @if (tip(); as t) {
          <div class="ch-tip" [style.left.%]="t.leftPct" role="status">
            <strong>{{ t.title }}</strong>
            @for (row of t.rows; track row.label) {
              <span class="ch-tipRow">
                <span class="ch-tipSwatch" [attr.data-tone]="row.tone" aria-hidden="true"></span>
                <span class="ch-tipLabel">{{ row.label }}</span>
                <span class="ch-tipValue num">{{ row.value }}</span>
              </span>
            }
          </div>
        }
      </div>
    </div>
    <figcaption class="ch-caption">
      <span class="ch-legend">
        @for (s of series(); track s.label) {
          <button
            type="button"
            class="ch-legendItem"
            [attr.data-tone]="s.tone"
            [attr.data-active]="focusLabel() === s.label ? 'true' : null"
            (pointerenter)="focusLabel.set(s.label)"
            (pointerleave)="focusLabel.set(null)"
            (focus)="focusLabel.set(s.label)"
            (blur)="focusLabel.set(null)"
          >
            <span class="ch-swatch" [attr.data-tone]="s.tone" [attr.data-dashed]="s.dashed ? 'true' : null" aria-hidden="true"></span>
            {{ s.label }}
          </button>
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
  private readonly uid = ++gradientSeq;
  protected readonly gridId = `ch-grid-${this.uid}`;
  protected readonly strokeGradId = `ch-stroke-${this.uid}`;
  protected readonly tip = signal<{
    x: number;
    leftPct: number;
    title: string;
    guideY: number | null;
    rows: { label: string; value: string; tone: ChartTone }[];
    dots: { label: string; y: number; tone: ChartTone }[];
  } | null>(null);
  protected readonly focusLabel = signal<string | null>(null);

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
    const primary = this.series().find((s) => !s.dashed) ?? this.series()[0];
    return this.series().map((s, i) => {
      const d = toPath(s.values, min, max, h, count);
      const end = count > 1 ? ((s.values.length - 1) * W) / (count - 1) : W;
      const signature = s === primary && (s.tone === 'brand' || s.area === true) && !s.dashed;
      return {
        label: s.label,
        tone: s.tone,
        dashed: !!s.dashed,
        signature,
        cssVar: chartToneVar(s.tone),
        gradId: `ch-grad-${this.uid}-${i}`,
        d,
        area: s.area ? `${d} L${end.toFixed(2)} ${h} L0 ${h} Z` : null,
      };
    });
  });

  /** Last point of the primary (non-dashed) series — terminal-style price tag. */
  protected readonly endpoint = computed(() => {
    const { min, max, count } = this.bounds();
    const primary = this.series().find((s) => !s.dashed) ?? this.series()[0];
    if (!primary?.values.length) return null;
    const last = primary.values[primary.values.length - 1];
    const h = this.height();
    const i = primary.values.length - 1;
    const step = count > 1 ? W / (count - 1) : 0;
    return {
      x: i * step,
      y: h - ((last - min) / (max - min || 1)) * h,
      tone: primary.tone,
      label: this.formatY()(last),
    };
  });

  protected isDimmed(label: string): boolean {
    const focus = this.focusLabel();
    return !!focus && focus !== label;
  }

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
    const rows: { label: string; value: string; tone: ChartTone }[] = [];
    const dots: { label: string; y: number; tone: ChartTone }[] = [];
    for (const s of this.series()) {
      if (index >= s.values.length) continue;
      const v = s.values[index];
      rows.push({ label: s.label, value: format(v), tone: s.tone });
      const y = h - ((v - min) / (max - min || 1)) * h;
      dots.push({ label: s.label, y, tone: s.tone });
    }
    this.tip.set({
      x,
      leftPct: (x / W) * 100,
      title,
      guideY: dots[0]?.y ?? null,
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

const ALLOCATION_TONES = ['brand', 'sky', 'mauve', 'violet', 'lavender', 'muted'] as const;

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
