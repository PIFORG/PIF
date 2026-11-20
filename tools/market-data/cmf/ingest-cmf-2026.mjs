import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { connectAllowedDb, fileSha256, toMillimes, parseFrDate } from '../lib.mjs';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
const XLSX = require('xlsx');
const SOURCE_ID = 'CMF_BVMT_HIST';
const filePath = process.env.CMF_XLSX ||
  'C:/Users/housi/Downloads/wetransfer_wetransfer_historiques_2026-11-02_1558_2026-11-17_1033/wetransfer_historiques_2026-11-02_1558/HistoCours jan-octobr  2026/HistoCours jan-octobr  2026.xlsx';

const client = await connectAllowedDb();
const batch = await client.query(
  `INSERT INTO market_import_batches (source_id, source_path, content_hash, status) VALUES ($1,$2,$3,'RUNNING') RETURNING id`,
  [SOURCE_ID, filePath, fileSha256(filePath)],
);
const batchId = batch.rows[0].id;
const wb = XLSX.readFile(filePath, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
let inserted = 0, updated = 0, rejected = 0;
const buf = [];
async function flush() {
  if (!buf.length) return;
  const chunk = buf.splice(0, buf.length);
  const res = await client.query(
    `INSERT INTO market_price_bars AS b
      (source_id, source_symbol, session_date, open_millimes, high_millimes, low_millimes, close_millimes,
       volume, turnover_millimes, trade_count, quality_flag, import_batch_id)
     SELECT $1, x.sym, x.d::date, x.o, x.h, x.l, x.c, x.v, x.t, x.tc, x.q, $2
     FROM UNNEST($3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[], $11::int[], $12::text[])
       AS x(sym, d, o, h, l, c, v, t, tc, q)
     ON CONFLICT (source_id, source_symbol, session_date) DO UPDATE SET
       open_millimes=EXCLUDED.open_millimes, high_millimes=EXCLUDED.high_millimes, low_millimes=EXCLUDED.low_millimes,
       close_millimes=EXCLUDED.close_millimes, volume=EXCLUDED.volume, turnover_millimes=EXCLUDED.turnover_millimes,
       trade_count=EXCLUDED.trade_count, quality_flag=EXCLUDED.quality_flag, import_batch_id=EXCLUDED.import_batch_id
     RETURNING (xmax=0) AS inserted`,
    [SOURCE_ID, batchId, chunk.map(r=>r.sym), chunk.map(r=>r.d), chunk.map(r=>r.o), chunk.map(r=>r.h), chunk.map(r=>r.l), chunk.map(r=>r.c), chunk.map(r=>r.v), chunk.map(r=>r.t), chunk.map(r=>r.tc), chunk.map(r=>r.q)],
  );
  for (const row of res.rows) { if (row.inserted) inserted++; else updated++; }
}
const instruments = new Set();
for (const obj of rows) {
  const code = String(obj.codeISIN || '').trim();
  const name = String(obj.valeur || code).trim();
  const session = parseFrDate(obj.dateSeance) || String(obj.dateSeance || '').slice(0, 10);
  const close = toMillimes(obj.cloture);
  if (!code || !session || close == null) { rejected++; continue; }
  if (!instruments.has(code)) {
    await client.query(
      `INSERT INTO market_instruments_ext (source_id, source_symbol, isin, name, exchange, currency, asset_class, trading_symbol)
       VALUES ($1,$2,$2,$3,'BVMT','TND','EQUITY',$4)
       ON CONFLICT (source_id, source_symbol) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`,
      [SOURCE_ID, code, name, name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8) || code.slice(0,8)],
    );
    instruments.add(code);
  }
  buf.push({
    sym: code, d: session,
    o: toMillimes(obj.coursOuvert), h: toMillimes(obj.plusHaut), l: toMillimes(obj.plusBas), c: close,
    v: Math.round(Number(obj.quantites)||0), t: toMillimes(obj.capitaux), tc: Math.round(Number(obj.echanges)||0),
    q: 'OK',
  });
  if (buf.length >= 1000) await flush();
}
await flush();
await client.query(`UPDATE market_import_batches SET finished_at=NOW(), status='SUCCESS', rows_read=$2, rows_inserted=$3, rows_updated=$4, rows_rejected=$5 WHERE id=$1`,
  [batchId, rows.length, inserted, updated, rejected]);
const cov = await client.query(`SELECT MIN(session_date) min_d, MAX(session_date) max_d, COUNT(*)::bigint n FROM market_price_bars WHERE source_id=$1`, [SOURCE_ID]);
console.log(JSON.stringify({ ok:true, inserted, updated, rejected, instruments: instruments.size, coverage: cov.rows[0] }, null, 2));
await client.end();