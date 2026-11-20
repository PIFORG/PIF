import { connectAllowedDb } from './lib.mjs';
const c = await connectAllowedDb();
const rows = await c.query(`
  SELECT source_id,
    COUNT(*)::int AS instruments,
    COUNT(*) FILTER (WHERE source_symbol LIKE 'TN%')::int AS isin_like,
    COUNT(*) FILTER (WHERE asset_class IS NOT NULL)::int AS with_class
  FROM market_instruments_ext GROUP BY 1 ORDER BY 1`);
const bars = await c.query(`
  SELECT e.source_id, e.asset_class,
    COUNT(DISTINCT e.source_symbol)::int AS symbols,
    COUNT(DISTINCT b.source_symbol)::int AS with_bars,
    MIN(b.session_date) AS min_d, MAX(b.session_date) AS max_d
  FROM market_instruments_ext e
  LEFT JOIN market_price_bars b ON b.source_id=e.source_id AND b.source_symbol=e.source_symbol
  GROUP BY 1,2 ORDER BY 1,2`);
const dup = await c.query(`
  SELECT trading_symbol, COUNT(*)::int n FROM market_instruments_ext
  WHERE trading_symbol IS NOT NULL AND trading_symbol <> ''
  GROUP BY 1 HAVING COUNT(*)>1 ORDER BY n DESC LIMIT 10`);
console.log(JSON.stringify({ instruments: rows.rows, coverage: bars.rows, dupTrading: dup.rows }, null, 2));
await c.end();