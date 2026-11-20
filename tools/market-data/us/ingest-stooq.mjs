/**
 * Download Stooq daily OHLCV for US indices/ETFs (2008 → latest) into PIF_spring_test.
 * Free HTTP CSV — rate-limited politely. Idempotent upserts.
 */
import https from 'node:https';
import { connectAllowedDb, toMillimes } from '../lib.mjs';

const SOURCE_ID = 'STOOQ';
const START = '2008-01-01';

/** Stooq symbols → display metadata */
const UNIVERSE = [
  { s: '^spx', name: 'S&P 500', trading: 'SPX', asset: 'INDEX' },
  { s: '^ndq', name: 'Nasdaq Composite', trading: 'COMP', asset: 'INDEX' },
  { s: '^dji', name: 'Dow Jones Industrial Average', trading: 'DJI', asset: 'INDEX' },
  { s: '^rut', name: 'Russell 2000', trading: 'RUT', asset: 'INDEX' },
  { s: '^vix', name: 'CBOE Volatility Index', trading: 'VIX', asset: 'INDEX' },
  { s: 'spy.us', name: 'SPDR S&P 500 ETF', trading: 'SPY', asset: 'ETF' },
  { s: 'qqq.us', name: 'Invesco QQQ Trust', trading: 'QQQ', asset: 'ETF' },
  { s: 'iwm.us', name: 'iShares Russell 2000 ETF', trading: 'IWM', asset: 'ETF' },
  { s: 'dia.us', name: 'SPDR Dow Jones Industrial Average ETF', trading: 'DIA', asset: 'ETF' },
  { s: 'aapl.us', name: 'Apple Inc.', trading: 'AAPL', asset: 'EQUITY' },
  { s: 'msft.us', name: 'Microsoft Corp.', trading: 'MSFT', asset: 'EQUITY' },
  { s: 'jpm.us', name: 'JPMorgan Chase', trading: 'JPM', asset: 'EQUITY' },
  { s: 'xom.us', name: 'Exxon Mobil', trading: 'XOM', asset: 'EQUITY' },
  { s: 'unh.us', name: 'UnitedHealth Group', trading: 'UNH', asset: 'EQUITY' },
  { s: 'pg.us', name: 'Procter & Gamble', trading: 'PG', asset: 'EQUITY' },
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'MarketTradingRoom/1.0 (academic; contact=local-dev)',
          Accept: 'text/csv,text/plain,*/*',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseStooqCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, open, high, low, close, volume] = lines[i].split(',');
    if (!date || date < START) continue;
    const c = toMillimes(close);
    if (c == null) continue;
    out.push({
      session_date: date,
      open_millimes: toMillimes(open),
      high_millimes: toMillimes(high),
      low_millimes: toMillimes(low),
      close_millimes: c,
      volume: volume && volume !== '' ? Math.round(Number(volume)) : null,
    });
  }
  return out;
}

async function main() {
  const client = await connectAllowedDb();
  const batch = await client.query(
    `INSERT INTO market_import_batches (source_id, source_path, status) VALUES ($1,'stooq-bulk','RUNNING') RETURNING id`,
    [SOURCE_ID],
  );
  const batchId = batch.rows[0].id;
  let read = 0;
  let inserted = 0;
  let updated = 0;
  let rejected = 0;
  try {
    for (const u of UNIVERSE) {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(u.s)}&i=d`;
      console.log('FETCH', u.s);
      let text;
      try {
        text = await fetchText(url);
      } catch (e) {
        console.error('FAIL', u.s, e.message);
        rejected++;
        await sleep(1500);
        continue;
      }
      const bars = parseStooqCsv(text);
      read += bars.length;
      await client.query(
        `INSERT INTO market_instruments_ext
          (source_id, source_symbol, name, exchange, currency, asset_class, trading_symbol, metadata)
         VALUES ($1,$2,$3,'US','USD',$4,$5,$6::jsonb)
         ON CONFLICT (source_id, source_symbol) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [SOURCE_ID, u.s, u.name, u.asset, u.trading, JSON.stringify({ stooq: u.s })],
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
      await sleep(1200);
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