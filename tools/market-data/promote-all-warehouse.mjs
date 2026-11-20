/**
 * Promote every warehouse instrument that has validated bars into trading.instruments.
 * Unique symbols: ISIN / BV{code} / Yahoo trading_symbol. Indices = non-tradable (metadata).
 * Idempotent. PIF_spring_test only. Does NOT re-import bars.
 */
import { connectAllowedDb } from './lib.mjs';

const INDEX_TRADING = new Set(['SPX', 'COMP', 'DJI', 'RUT', 'VIX']);

function tradingSymbol(row) {
  if (row.source_id === 'YAHOO' || row.source_id === 'STOOQ') {
    return String(row.trading_symbol || row.source_symbol).replace(/[^A-Za-z0-9]/g, '').slice(0, 16).toUpperCase() || 'USX';
  }
  const src = String(row.source_symbol || '');
  if (/^TN[0-9A-Z]{10}$/i.test(src)) return src.toUpperCase().slice(0, 16);
  return ('BV' + src.replace(/[^A-Za-z0-9]/g, '')).slice(0, 16).toUpperCase();
}

function assetClass(row) {
  const a = String(row.asset_class || 'EQUITY').toUpperCase();
  if (a === 'ETF' || a === 'FUND') return 'FUND';
  if (a === 'INDEX') return 'EQUITY';
  if (['EQUITY', 'FUND', 'BOND', 'COMMODITY', 'FX'].includes(a)) return a;
  return 'EQUITY';
}

function isIndex(row, sym) {
  const a = String(row.asset_class || '').toUpperCase();
  if (a === 'INDEX') return true;
  if (INDEX_TRADING.has(sym)) return true;
  if (String(row.source_symbol || '').startsWith('^')) return true;
  return false;
}

const client = await connectAllowedDb();
const { rows } = await client.query(`
  SELECT e.source_id, e.source_symbol, e.name, e.isin, e.currency, e.asset_class, e.trading_symbol, e.exchange,
         COUNT(b.*)::int AS bars, MIN(b.session_date) AS min_d, MAX(b.session_date) AS max_d
  FROM market_instruments_ext e
  INNER JOIN market_price_bars b ON b.source_id = e.source_id AND b.source_symbol = e.source_symbol
  WHERE e.source_id IN ('CMF_BVMT_HIST', 'YAHOO')
  GROUP BY e.source_id, e.source_symbol, e.name, e.isin, e.currency, e.asset_class, e.trading_symbol, e.exchange
  HAVING COUNT(b.*) >= 5
`);

const used = new Set();
const existing = await client.query('SELECT symbol FROM instruments');
for (const r of existing.rows) used.add(r.symbol);

let inserted = 0;
let updated = 0;
let skipped = 0;
const promoted = [];

for (const row of rows) {
  let sym = tradingSymbol(row);
  if (used.has(sym) && !promoted.find((p) => p.symbol === sym)) {
    // collision with another new candidate: disambiguate
    const alt = (sym.slice(0, 12) + String(row.source_symbol).replace(/[^A-Za-z0-9]/g, '').slice(-4)).slice(0, 16);
    if (!used.has(alt)) sym = alt;
    else {
      skipped++;
      continue;
    }
  }
  const index = isIndex(row, sym);
  const ac = assetClass(row);
  const currency = (row.currency || (row.source_id === 'YAHOO' ? 'USD' : 'TND')).slice(0, 3);
  const sector = index ? 'Indice' : row.source_id === 'YAHOO' ? 'International' : 'BVMT';
  const meta = {
    tradable: !index,
    kind: index ? 'INDEX' : ac === 'FUND' ? 'ETF_OR_FUND' : 'EQUITY',
    market: row.source_id === 'YAHOO' ? 'US' : 'TN',
    sourceId: row.source_id,
    sourceSymbol: row.source_symbol,
    bars: row.bars,
    minDate: row.min_d,
    maxDate: row.max_d,
    exchange: row.exchange || (row.source_id === 'YAHOO' ? 'US' : 'BVMT'),
  };
  const res = await client.query(
    `INSERT INTO instruments
      (id, symbol, name, asset_class, sector, quote_currency, status, price_decimals, quantity_decimals, lot_size,
       provider_id, provider_symbol, fictional, metadata, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3::"InstrumentAssetClass", $4, $5, 'ACTIVE', 3, 0, 1,
             $6, $7, false, $8::jsonb, NOW(), NOW())
     ON CONFLICT (symbol) DO UPDATE SET
       name = EXCLUDED.name,
       asset_class = EXCLUDED.asset_class,
       sector = EXCLUDED.sector,
       quote_currency = EXCLUDED.quote_currency,
       provider_id = EXCLUDED.provider_id,
       provider_symbol = EXCLUDED.provider_symbol,
       fictional = false,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [sym, String(row.name || sym).slice(0, 120), ac, sector, currency, row.source_id, row.source_symbol, JSON.stringify(meta)],
  );
  if (res.rows[0]?.inserted) inserted++;
  else updated++;
  used.add(sym);
  promoted.push({ symbol: sym, source: row.source_symbol, sourceId: row.source_id, tradable: !index, bars: row.bars });
}

const counts = await client.query(`
  SELECT fictional, COUNT(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`);
console.log(JSON.stringify({
  ok: true,
  candidates: rows.length,
  inserted,
  updated,
  skipped,
  instrumentsByFictional: counts.rows,
  sample: promoted.slice(0, 8),
  tradable: promoted.filter((p) => p.tradable).length,
  browseOnly: promoted.filter((p) => !p.tradable).length,
}, null, 2));
await client.end();