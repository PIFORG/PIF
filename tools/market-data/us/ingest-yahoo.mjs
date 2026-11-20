/**
 * US daily OHLCV via Yahoo Finance chart API (public JSON).
 * Coverage from 2008-01-01 when available. PIF_spring_test only.
 * Not a live feed — delayed/historical. Respect Yahoo ToS for your deployment.
 */
import https from 'node:https';
import { connectAllowedDb, toMillimes } from '../lib.mjs';

const SOURCE_ID = 'YAHOO';
const START_SEC = Math.floor(Date.parse('2008-01-01T00:00:00Z') / 1000);

const UNIVERSE = [
  { y: '^GSPC', s: '^spx', name: 'S&P 500', trading: 'SPX', asset: 'INDEX' },
  { y: '^IXIC', s: '^ndq', name: 'Nasdaq Composite', trading: 'COMP', asset: 'INDEX' },
  { y: '^DJI', s: '^dji', name: 'Dow Jones Industrial Average', trading: 'DJI', asset: 'INDEX' },
  { y: '^RUT', s: '^rut', name: 'Russell 2000', trading: 'RUT', asset: 'INDEX' },
  { y: '^VIX', s: '^vix', name: 'CBOE Volatility Index', trading: 'VIX', asset: 'INDEX' },
  { y: 'SPY', s: 'spy.us', name: 'SPDR S&P 500 ETF', trading: 'SPY', asset: 'ETF' },
  { y: 'QQQ', s: 'qqq.us', name: 'Invesco QQQ Trust', trading: 'QQQ', asset: 'ETF' },
  { y: 'IWM', s: 'iwm.us', name: 'iShares Russell 2000 ETF', trading: 'IWM', asset: 'ETF' },
  { y: 'DIA', s: 'dia.us', name: 'SPDR Dow Jones Industrial Average ETF', trading: 'DIA', asset: 'ETF' },
  { y: 'AAPL', s: 'aapl.us', name: 'Apple Inc.', trading: 'AAPL', asset: 'EQUITY' },
  { y: 'MSFT', s: 'msft.us', name: 'Microsoft Corp.', trading: 'MSFT', asset: 'EQUITY' },
  { y: 'JPM', s: 'jpm.us', name: 'JPMorgan Chase', trading: 'JPM', asset: 'EQUITY' },
  { y: 'XOM', s: 'xom.us', name: 'Exxon Mobil', trading: 'XOM', asset: 'EQUITY' },
  { y: 'UNH', s: 'unh.us', name: 'UnitedHealth Group', trading: 'UNH', asset: 'EQUITY' },
  { y: 'PG', s: 'pg.us', name: 'Procter & Gamble', trading: 'PG', asset: 'EQUITY' },
];

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MarketTradingRoom/1.0; academic)',
            Accept: 'application/json',
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 180)}`));
              return;
            }
            resolve(JSON.parse(text));
          });
        },
      )
      .on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function barsFromChart(json) {
  const result = json?.chart?.result?.[0];
  if (!result) return [];
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close == null || !Number.isFinite(close)) continue;
    const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    if (d < '2008-01-01') continue;
    out.push({
      session_date: d,
      open_millimes: toMillimes(q.open?.[i]),
      high_millimes: toMillimes(q.high?.[i]),
      low_millimes: toMillimes(q.low?.[i]),
      close_millimes: toMillimes(close),
      volume: q.volume?.[i] != null ? Math.round(q.volume[i]) : null,
    });
  }
  return out;
}

async function main() {
  const client = await connectAllowedDb();
  await client.query(
    `INSERT INTO market_data_sources (id, name, kind, market, license_note, homepage_url)
     VALUES ('YAHOO','Yahoo Finance chart API','HTTP_JSON','US',
       'Historique via API publique non officielle — vérifier conditions Yahoo pour redistribution.',
       'https://finance.yahoo.com/')
     ON CONFLICT (id) DO NOTHING`,
  );
  const batch = await client.query(
    `INSERT INTO market_import_batches (source_id, source_path, status) VALUES ($1,'yahoo-chart','RUNNING') RETURNING id`,
    [SOURCE_ID],
  );
  const batchId = batch.rows[0].id;
  let read = 0, inserted = 0, updated = 0, rejected = 0;
  const end = Math.floor(Date.now() / 1000);
  try {
    for (const u of UNIVERSE) {
      const url =
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(u.y)}` +
        `?period1=${START_SEC}&period2=${end}&interval=1d&events=history`;
      console.log('FETCH', u.y);
      let bars = [];
      try {
        const json = await getJson(url);
        bars = barsFromChart(json);
      } catch (e) {
        console.error('FAIL', u.y, e.message);
        rejected++;
        await sleep(800);
        continue;
      }
      read += bars.length;
      await client.query(
        `INSERT INTO market_instruments_ext
          (source_id, source_symbol, name, exchange, currency, asset_class, trading_symbol, metadata)
         VALUES ($1,$2,$3,'US','USD',$4,$5,$6::jsonb)
         ON CONFLICT (source_id, source_symbol) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [SOURCE_ID, u.s, u.name, u.asset === 'ETF' ? 'FUND' : 'EQUITY', u.trading, JSON.stringify({ yahoo: u.y })],
      );
      for (let i = 0; i < bars.length; i += 1000) {
        const chunk = bars.slice(i, i + 1000);
        const res = await client.query(
          `INSERT INTO market_price_bars AS b
            (source_id, source_symbol, session_date, open_millimes, high_millimes, low_millimes, close_millimes,
             volume, quality_flag, import_batch_id)
           SELECT $1, x.sym, x.d::date, x.o, x.h, x.l, x.c, x.v, 'OK', $2
           FROM UNNEST($3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[])
             AS x(sym, d, o, h, l, c, v)
           ON CONFLICT (source_id, source_symbol, session_date) DO UPDATE SET
             open_millimes = EXCLUDED.open_millimes,
             high_millimes = EXCLUDED.high_millimes,
             low_millimes = EXCLUDED.low_millimes,
             close_millimes = EXCLUDED.close_millimes,
             volume = EXCLUDED.volume,
             import_batch_id = EXCLUDED.import_batch_id
           RETURNING (xmax = 0) AS inserted`,
          [
            SOURCE_ID,
            batchId,
            chunk.map(() => u.s),
            chunk.map((b) => b.session_date),
            chunk.map((b) => b.open_millimes),
            chunk.map((b) => b.high_millimes),
            chunk.map((b) => b.low_millimes),
            chunk.map((b) => b.close_millimes),
            chunk.map((b) => b.volume),
          ],
        );
        for (const row of res.rows) {
          if (row.inserted) inserted++;
          else updated++;
        }
      }
      await sleep(700);
    }
    await client.query(
      `UPDATE market_import_batches SET finished_at=NOW(), status='SUCCESS',
        rows_read=$2, rows_inserted=$3, rows_updated=$4, rows_rejected=$5 WHERE id=$1`,
      [batchId, read, inserted, updated, rejected],
    );
    const cov = await client.query(
      `SELECT source_symbol, MIN(session_date) min_d, MAX(session_date) max_d, COUNT(*)::bigint n
       FROM market_price_bars WHERE source_id=$1 GROUP BY 1 ORDER BY 1`,
      [SOURCE_ID],
    );
    console.log(JSON.stringify({ ok: true, read, inserted, updated, rejected, coverage: cov.rows }, null, 2));
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