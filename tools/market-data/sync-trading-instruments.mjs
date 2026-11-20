/**
 * Promote a curated set of CMF / Stooq instruments into trading.instruments (fictional=false).
 * Does not delete existing fictional instruments. PIF_spring_test only.
 */
import { connectAllowedDb } from './lib.mjs';

const CURATED_CMF = [
  // Prefer liquid names; matched by name ILIKE or ISIN
  { match: 'SFBT', symbol: 'SFBT', name: 'SFBT', sector: 'Consommation' },
  { match: 'BIAT', symbol: 'BIAT', name: 'BIAT', sector: 'Banque' },
  { match: 'ATTIJARI', symbol: 'TJARI', name: 'Attijari Bank', sector: 'Banque' },
  { match: 'TUNISIE LEASING', symbol: 'TLS', name: 'Tunisie Leasing', sector: 'Finance' },
  { match: 'ONE TECH', symbol: 'OTL', name: 'One Tech Holding', sector: 'Industrie' },
  { match: 'SAH', symbol: 'SAH', name: 'SAH', sector: 'Divers' },
];

const CURATED_US = [
  { source_symbol: '^spx', symbol: 'SPX', name: 'S&P 500', sector: 'Indice', asset: 'EQUITY' },
  { source_symbol: '^vix', symbol: 'VIX', name: 'VIX', sector: 'Volatilité', asset: 'EQUITY' },
  { source_symbol: 'spy.us', symbol: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'ETF', asset: 'FUND' },
  { source_symbol: 'aapl.us', symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technologie', asset: 'EQUITY' },
  { source_symbol: 'msft.us', symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technologie', asset: 'EQUITY' },
];

const client = await connectAllowedDb();
const promoted = [];

for (const c of CURATED_CMF) {
  const found = await client.query(
    `SELECT source_symbol, name, isin, trading_symbol
     FROM market_instruments_ext
     WHERE source_id='CMF_BVMT_HIST' AND (name ILIKE '%'||$1||'%' OR source_symbol ILIKE '%'||$1||'%')
     ORDER BY CASE WHEN source_symbol LIKE 'TN%' THEN 0 ELSE 1 END, length(source_symbol) DESC LIMIT 1`,
    [c.match],
  );
  if (!found.rows.length) continue;
  const row = found.rows[0];
  await client.query(
    `INSERT INTO instruments
      (id, symbol, name, asset_class, sector, quote_currency, status, price_decimals, quantity_decimals, lot_size,
       provider_id, provider_symbol, fictional, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'EQUITY', $3, 'TND', 'ACTIVE', 3, 0, 1,
             'CMF_BVMT_HIST', $4, false, NOW(), NOW())
     ON CONFLICT (symbol) DO UPDATE SET
       name = EXCLUDED.name,
       provider_id = EXCLUDED.provider_id,
       provider_symbol = EXCLUDED.provider_symbol,
       fictional = false,
       updated_at = NOW()`,
    [c.symbol, c.name, c.sector, row.source_symbol],
  );
  promoted.push({ market: 'TN', symbol: c.symbol, source: row.source_symbol });
}

for (const u of CURATED_US) {
  const exists = await client.query(
    `SELECT 1 FROM market_instruments_ext WHERE source_id='YAHOO' AND source_symbol=$1`,
    [u.source_symbol],
  );
  if (!exists.rows.length) continue;
  await client.query(
    `INSERT INTO instruments
      (id, symbol, name, asset_class, sector, quote_currency, status, price_decimals, quantity_decimals, lot_size,
       provider_id, provider_symbol, fictional, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3::"InstrumentAssetClass", $4, 'USD', 'ACTIVE', 3, 0, 1,
             'YAHOO', $5, false, NOW(), NOW())
     ON CONFLICT (symbol) DO UPDATE SET
       name = EXCLUDED.name,
       provider_id = EXCLUDED.provider_id,
       provider_symbol = EXCLUDED.provider_symbol,
       fictional = false,
       updated_at = NOW()`,
    [u.symbol, u.name, u.asset, u.sector, u.source_symbol],
  );
  promoted.push({ market: 'US', symbol: u.symbol, source: u.source_symbol });
}

console.log(JSON.stringify({ ok: true, promoted, db: (await client.query('SELECT current_database() d')).rows[0].d }, null, 2));
await client.end();