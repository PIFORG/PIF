import { useId } from 'react';
import styles from './Charts.module.css';

export interface ChartSeries {
  label: string;
  values: number[];
  tone: 'brand' | 'cyan' | 'muted';
  /** Draw a filled area under the first series. */
  area?: boolean;
  dashed?: boolean;
}

interface LineChartProps {
  series: ChartSeries[];
  /** Plain-language description read by assistive technology. */
  summary: string;
  height?: number;
  formatY?: (value: number) => string;
  xLabels?: [string, string];
}

const W = 1000;

function niceBounds(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || Math.abs(max) || 1) * 0.08;
  return [min - pad, max + pad];
}

function toPath(values: number[], min: number, max: number, h: number): string {
  const step = values.length > 1 ? W / (values.length - 1) : W;
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)} ${(h - ((v - min) / (max - min)) * h).toFixed(2)}`)
    .join(' ');
}

/** Responsive line/area chart. Drawing scales with `preserveAspectRatio="none"`; labels are HTML so text never distorts. */
export function LineChart({ series, summary, height = 220, formatY = (v) => v.toFixed(0), xLabels }: LineChartProps) {
  const gradientId = useId();
  const all = series.flatMap((s) => s.values);
  const [min, max] = niceBounds(all);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className={styles.figure}>
      <div className={styles.plot} style={{ height }}>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ top: `${t * 100}%` }} className="num">
              {formatY(max - t * (max - min))}
            </span>
          ))}
        </div>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--mtr-brand)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--mtr-brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <line
              key={t}
              x1="0"
              x2={W}
              y1={t * height}
              y2={t * height}
              className={styles.gridLine}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.map((s) => {
            const d = toPath(s.values, min, max, height);
            return (
              <g key={s.label}>
                {s.area ? <path d={`${d} L${W} ${height} L0 ${height} Z`} fill={`url(#${gradientId})`} /> : null}
                <path
                  d={d}
                  className={styles.line}
                  data-tone={s.tone}
                  strokeDasharray={s.dashed ? '6 5' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.legend}>
          {series.map((s) => (
            <span key={s.label} className={styles.legendItem}>
              <span className={styles.swatch} data-tone={s.tone} data-dashed={s.dashed ? 'true' : undefined} aria-hidden />
              {s.label}
            </span>
          ))}
        </span>
        {xLabels ? (
          <span className={styles.xLabels} aria-hidden="true">
            <span>{xLabels[0]}</span>
            <span>{xLabels[1]}</span>
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function Sparkline({ values, label, width = 96, height = 28 }: { values: number[]; label: string; width?: number; height?: number }) {
  const [min, max] = niceBounds(values);
  const step = width / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${(height - ((v - min) / (max - min)) * height).toFixed(1)}`)
    .join(' ');
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={styles.spark}>
      <path d={d} data-tone={rising ? 'pos' : 'neg'} className={styles.sparkLine} />
    </svg>
  );
}

const ALLOCATION_TONES = ['brand', 'cyan', 'amber', 'violet', 'muted'] as const;

export function AllocationBar({ items, label }: { items: { label: string; weight: number }[]; label: string }) {
  return (
    <div className={styles.allocation}>
      <div className={styles.allocBar} role="img" aria-label={label}>
        {items.map((item, i) => (
          <span
            key={item.label}
            className={styles.allocSegment}
            data-tone={ALLOCATION_TONES[i % ALLOCATION_TONES.length]}
            style={{ width: `${item.weight * 100}%` }}
          />
        ))}
      </div>
      <ul className={styles.allocLegend}>
        {items.map((item, i) => (
          <li key={item.label}>
            <span className={styles.allocSwatch} data-tone={ALLOCATION_TONES[i % ALLOCATION_TONES.length]} aria-hidden />
            <span className={styles.allocName}>{item.label}</span>
            <span className="num">{(item.weight * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
