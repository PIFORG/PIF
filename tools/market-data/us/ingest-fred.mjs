/**
 * FRED connector (requires FRED_API_KEY). Imports macro series since 2008 with realtime periods when present.
 */
import https from 'node:https';
import { connectAllowedDb } from '../lib.mjs';

const SOURCE_ID = 'FRED';
const SERIES = [
  { id: 'FEDFUNDS', name: 'Federal Funds Effective Rate' },
  { id: 'DGS10', name: '10-Year Treasury Constant Maturity Rate' },
  { id: 'DGS2', name: '2-Year Treasury Constant Maturity Rate' },
  { id: 'CPIAUCSL', name: 'CPI All Urban Consumers' },
  { id: 'UNRATE', name: 'Unemployment Rate' },
  { id: 'VIXCLS', name: 'CBOE Volatility Index: VIX' },
];

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'MarketTradingRoom/1.0 (academic)' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`));
            return;
          }
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        });
      })
      .on('error', reject);
  });
}

async function main() {
  const key = process.env.FRED_API_KEY;
  if (!key) {
    console.log(JSON.stringify({
      ok: false,
      blocked: true,
      reason: 'FRED_API_KEY manquante — connecteur prêt, aucune donnée téléchargée.',
      signup: 'https://fred.stlouisfed.org/docs/api/api_key.html',
      seriesPlanned: SERIES,
    }, null, 2));
    process.exit(0);
  }
  const client = await connectAllowedDb();
  const batch = await client.query(
    `INSERT INTO market_import_batches (source_id, source_path, status) VALUES ($1,'fred-api','RUNNING') RETURNING id`,
    [SOURCE_ID],
  );
  const batchId = batch.rows[0].id;
  let n = 0;
  try {
    for (const s of SERIES) {
      const url =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}` +
        `&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=2008-01-01`;
      const body = await getJson(url);
      for (const obs of body.observations || []) {
        if (obs.value === '.') continue;
        const v = Number(obs.value);
        if (!Number.isFinite(v)) continue;
        await client.query(
          `INSERT INTO market_macro_observations
            (source_id, series_id, obs_date, value_numeric, realtime_start, realtime_end, import_batch_id)
           VALUES ($1,$2,$3::date,$4,$5::date,$6::date,$7)
           ON CONFLICT (source_id, series_id, obs_date, realtime_start) DO UPDATE SET value_numeric = EXCLUDED.value_numeric`,
          [SOURCE_ID, s.id, obs.date, v, obs.realtime_start || null, obs.realtime_end || null, batchId],
        );
        n++;
      }
    }
    await client.query(
      `UPDATE market_import_batches SET finished_at=NOW(), status='SUCCESS', rows_inserted=$2 WHERE id=$1`,
      [batchId, n],
    );
    console.log(JSON.stringify({ ok: true, rows: n }));
  } catch (e) {
    await client.query(`UPDATE market_import_batches SET finished_at=NOW(), status='FAILED', error_log=$2 WHERE id=$1`, [
      batchId,
      String(e.stack || e),
    ]);
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});