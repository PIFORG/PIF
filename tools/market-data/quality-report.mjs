import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectAllowedDb, projectRoot } from './lib.mjs';

const c = await connectAllowedDb();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const report = {
  db: (await q('SELECT current_database() d'))[0].d,
  bars: (await q('SELECT COUNT(*)::bigint n FROM market_price_bars'))[0].n,
  instruments_ext: (await q('SELECT COUNT(*)::bigint n FROM market_instruments_ext'))[0].n,
  news: (await q('SELECT COUNT(*)::bigint n FROM market_news_items_real'))[0].n,
  crises: (await q('SELECT COUNT(*)::bigint n FROM market_crisis_episodes'))[0].n,
  bySource: await q(
    'SELECT source_id, COUNT(*)::bigint bars, MIN(session_date) min_d, MAX(session_date) max_d FROM market_price_bars GROUP BY 1 ORDER BY 1',
  ),
  tradingCounts: (await q(`SELECT
    COUNT(*) FILTER (WHERE fictional=false)::int AS real_n,
    COUNT(*) FILTER (WHERE fictional=true)::int AS fict_n,
    COUNT(*) FILTER (WHERE fictional=false AND provider_id='CMF_BVMT_HIST')::int AS cmf,
    COUNT(*) FILTER (WHERE fictional=false AND provider_id='YAHOO')::int AS yahoo,
    COUNT(*) FILTER (WHERE fictional=false AND coalesce(metadata->>'tradable','true')='false')::int AS non_tradable
  FROM instruments`))[0],
  tradingSample: await q(
    `SELECT symbol, provider_id, provider_symbol, fictional
     FROM instruments WHERE fictional = false
     ORDER BY CASE WHEN symbol ~ '^[A-Z]{2,5}$' THEN 0 ELSE 1 END, symbol
     LIMIT 25`,
  ),
  sampleCmf: await q(
    "SELECT source_symbol, session_date, close_millimes FROM market_price_bars WHERE source_id='CMF_BVMT_HIST' ORDER BY session_date DESC LIMIT 3",
  ),
  sampleUs: await q(
    "SELECT source_symbol, session_date, close_millimes FROM market_price_bars WHERE source_id='YAHOO' AND source_symbol='spy.us' ORDER BY session_date DESC LIMIT 3",
  ),
};
const out = path.join(projectRoot(), 'data', 'reports', 'quality-snapshot.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await c.end();