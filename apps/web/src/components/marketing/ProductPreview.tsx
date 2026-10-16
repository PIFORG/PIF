import { LineChart, Sparkline } from '@/components/charts/Charts';
import { MtrsEmblem } from '@/components/brand/BrandMark';
import { Change, DemoModeLabel } from '@/components/workspace/primitives';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format/finance';
import {
  SAMPLE_CURRENCY,
  sampleBenchmarkCurve,
  sampleEquityCurve,
  sampleRisk,
  sampleSummary,
  sampleWatchlist,
} from '@/lib/demo/sampleWorkspace';
import styles from './ProductPreview.module.css';

/** Code-built composition of the workspace, rendered from labelled sample fixtures. */
export function ProductPreview() {
  const summary = sampleSummary();
  return (
    <figure className={styles.window} aria-labelledby="preview-caption">
      <div className={styles.chrome} aria-hidden="true">
        <span className={styles.dots}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.chromeTitle}>Market Trading Room — Overview</span>
      </div>
      <div className={styles.body}>
        <div className={styles.rail} aria-hidden="true">
          <MtrsEmblem size={22} />
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={styles.railItem} data-active={i === 0 ? 'true' : undefined} />
          ))}
        </div>
        <div className={styles.content}>
          <div className={styles.head}>
            <div>
              <p className={styles.headLabel}>Simulated portfolio value</p>
              <p className={`${styles.headValue} num`}>{formatMoney(summary.equity, SAMPLE_CURRENCY)}</p>
            </div>
            <div className={styles.headMeta}>
              <Change value={summary.dayChangePct} />
              <DemoModeLabel />
            </div>
          </div>
          <div className={styles.grid}>
            <div className={styles.chartCard}>
              <LineChart
                height={150}
                summary="Sample chart: a fictitious simulated portfolio compared with a fictitious benchmark over 64 sessions."
                formatY={(v) => formatMoney(v, SAMPLE_CURRENCY, { compact: true })}
                series={[
                  { label: 'Sample portfolio', values: sampleEquityCurve.map((p) => p.value), tone: 'brand', area: true },
                  { label: 'Sample benchmark', values: sampleBenchmarkCurve.map((p) => p.value), tone: 'muted', dashed: true },
                ]}
              />
            </div>
            <div className={styles.side}>
              <ul className={styles.watch} aria-label="Sample watchlist">
                {sampleWatchlist.slice(0, 4).map((q) => (
                  <li key={q.symbol}>
                    <span className={styles.sym}>{q.symbol}</span>
                    <Sparkline values={q.spark} width={56} height={18} label={`${q.symbol} sample trend`} />
                    <span className={styles.quote}>
                      <span className="num">{formatNumber(q.last)}</span>
                      <Change value={q.change} />
                    </span>
                  </li>
                ))}
              </ul>
              <dl className={styles.risk}>
                <div>
                  <dt>1-day VaR 95%</dt>
                  <dd className="num">{formatPercent(sampleRisk.var95)}</dd>
                </div>
                <div>
                  <dt>Volatility</dt>
                  <dd className="num">{formatPercent(sampleRisk.annualVolatility, { digits: 1 })}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
      <figcaption id="preview-caption" className={styles.caption}>
        Product preview built from fictitious sample data. Not market data and not a real account.
      </figcaption>
    </figure>
  );
}
