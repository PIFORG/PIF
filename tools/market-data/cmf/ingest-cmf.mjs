import { fileURLToPath } from 'node:url';
/**
 * CMF / BVMT historical cotation ingest → PIF_spring_test only.
 * Source: local WeTransfer historiques (read-only). Idempotent upserts.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import {
  connectAllowedDb,
  fileSha256,
  loadConfig,
  parseFrDate,
  projectRoot,
  toMillimes,
} from '../lib.mjs';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
let XLSX;
try {
  XLSX = require('xlsx');
} catch {
  XLSX = null;
}

const SOURCE_ID = 'CMF_BVMT_HIST';

function listInputFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(csv|txt|xlsx)$/i.test(ent.name) && !ent.name.startsWith('.') && !ent.name.startsWith('~$')) files.push(p);
    }
  };
  walk(root);
  return files.sort();
}

function detectKind(filePath, firstLine) {
  const base = path.basename(filePath).toLowerCase();
  if (base.endsWith('.xlsx')) return 'xlsx';
  if (firstLine.includes(';') && /SEANCE/i.test(firstLine) && /CODE/i.test(firstLine)) return 'csv_semi';
  if (/SEANCE/i.test(firstLine) && /CODE_VAL/i.test(firstLine)) return 'txt_fw';
  if (firstLine.includes(';')) return 'csv_semi';
  return 'unknown';
}

function splitSemi(line) {
  return line.split(';').map((c) => c.trim());
}

/** Fixed-ish columns from BVMT txt exports 2018–2021 (space padded). */
function parseTxtRow(line) {
  if (!line || /^-+/.test(line) || /SEANCE/i.test(line)) return null;
  // Prefer regex capture of known layout
  const m = line.match(
    /^(\d{2}\/\d{2}\/\d{2,4})\s+(\d+)\s+(\S+)\s+(.+?)\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.-]+)\s+([\d,.\s-]+)\s+(\d+)\s+([\d,.\s-]+)/,
  );
  if (!m) {
    // Fallback: tokenize collapsing spaces after date
    const parts = line.trim().split(/\s+/);
    if (parts.length < 12) return null;
    const date = parts[0];
    const code = parts[2];
    // name may be multi-token — find first numeric after code
    let i = 3;
    while (i < parts.length && !/^[\d,.-]+$/.test(parts[i])) i++;
    const name = parts.slice(3, i).join(' ');
    const nums = parts.slice(i);
    if (nums.length < 9) return null;
    return {
      session: date,
      group: parts[1],
      code,
      name,
      open: nums[2],
      last: nums[3],
      close: nums[4],
      low: nums[5],
      high: nums[6],
      qty: nums[7],
      trades: nums[8],
      capitals: nums[9],
    };
  }
  return {
    session: m[1],
    group: m[2],
    code: m[3],
    name: m[4].trim(),
    open: m[7],
    last: m[8],
    close: m[9],
    low: m[10],
    high: m[11],
    qty: m[12],
    trades: m[13],
    capitals: m[14],
  };
}

function parseCsvHeaderMap(headerCells) {
  const map = {};
  headerCells.forEach((h, idx) => {
    map[h.replace(/\s+/g, '').toUpperCase()] = idx;
  });
  return map;
}

function rowFromCsv(cells, map) {
  const get = (...keys) => {
    for (const k of keys) {
      if (map[k] != null && cells[map[k]] != null) return cells[map[k]];
    }
    return null;
  };
  return {
    session: get('SEANCE'),
    group: get('GROUPE', 'C_GR_RLC'),
    code: get('CODE', 'CODE_VAL'),
    name: get('VALEUR', 'LIB_VAL'),
    open: get('OUVERTURE'),
    close: get('CLOTURE', 'DERNIER_COURS'),
    low: get('PLUS_BAS'),
    high: get('PLUS_HAUT'),
    qty: get('QUANTITE_NEGOCIEE'),
    trades: get('NB_TRANSACTION', 'NB_TRAN'),
    capitals: get('CAPITAUX'),
  };
}

function qualityOf(row) {
  const o = toMillimes(row.open);
  const h = toMillimes(row.high);
  const l = toMillimes(row.low);
  const c = toMillimes(row.close);
  if (c == null || c < 0) return 'REJECT_PRICE';
  if (h != null && l != null && h < l) return 'OHLC_INCONSISTENT';
  if (h != null && c != null && h === 0 && l === 0 && (toMillimes(row.qty) === 0 || row.qty === '0')) {
    return 'NO_TRADE_ZERO_RANGE';
  }
  if (o != null && h != null && l != null) {
    if (o > h || o < l || c > h || c < l) return 'OHLC_INCONSISTENT';
  }
  return 'OK';
}

function tradingSymbol(code, name) {
  // Prefer short mnemonic from name when ISIN-like; else truncate code
  const c = String(code || '').trim();
  if (/^TN[0-9A-Z]{10}$/i.test(c)) {
    const base = String(name || 'TNX')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 8);
    return (base || c.slice(0, 8)).slice(0, 16);
  }
  return c.slice(0, 16);
}

async function ensureBatch(client, sourcePath, hash) {
  const r = await client.query(
    `INSERT INTO market_import_batches (source_id, source_path, content_hash, status)
     VALUES ($1,$2,$3,'RUNNING') RETURNING id`,
    [SOURCE_ID, sourcePath, hash],
  );
  return r.rows[0].id;
}

async function upsertInstrument(client, row) {
  const ts = tradingSymbol(row.code, row.name);
  await client.query(
    `INSERT INTO market_instruments_ext
      (source_id, source_symbol, isin, name, exchange, currency, asset_class, trading_symbol, metadata)
     VALUES ($1,$2,$3,$4,'BVMT','TND','EQUITY',$5,$6::jsonb)
     ON CONFLICT (source_id, source_symbol) DO UPDATE SET
       name = EXCLUDED.name,
       trading_symbol = EXCLUDED.trading_symbol,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()`,
    [
      SOURCE_ID,
      String(row.code).trim(),
      /^TN/i.test(String(row.code).trim()) ? String(row.code).trim() : null,
      String(row.name || row.code).trim(),
      ts,
      JSON.stringify({ group: row.group || null }),
    ],
  );
  return ts;
}

async function flushBars(client, batchId, rows) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  // Use UNNEST bulk upsert
  const sourceSymbols = rows.map((r) => r.source_symbol);
  const dates = rows.map((r) => r.session_date);
  const opens = rows.map((r) => r.open_millimes);
  const highs = rows.map((r) => r.high_millimes);
  const lows = rows.map((r) => r.low_millimes);
  const closes = rows.map((r) => r.close_millimes);
  const vols = rows.map((r) => r.volume);
  const turns = rows.map((r) => r.turnover_millimes);
  const trades = rows.map((r) => r.trade_count);
  const quals = rows.map((r) => r.quality_flag);
  const res = await client.query(
    `INSERT INTO market_price_bars AS b
      (source_id, source_symbol, session_date, open_millimes, high_millimes, low_millimes, close_millimes,
       volume, turnover_millimes, trade_count, quality_flag, import_batch_id)
     SELECT $1, x.source_symbol, x.session_date::date, x.open_millimes, x.high_millimes, x.low_millimes,
            x.close_millimes, x.volume, x.turnover_millimes, x.trade_count, x.quality_flag, $2
     FROM UNNEST(
       $3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[],
       $9::bigint[], $10::bigint[], $11::int[], $12::text[]
     ) AS x(source_symbol, session_date, open_millimes, high_millimes, low_millimes, close_millimes,
            volume, turnover_millimes, trade_count, quality_flag)
     ON CONFLICT (source_id, source_symbol, session_date) DO UPDATE SET
       open_millimes = EXCLUDED.open_millimes,
       high_millimes = EXCLUDED.high_millimes,
       low_millimes = EXCLUDED.low_millimes,
       close_millimes = EXCLUDED.close_millimes,
       volume = EXCLUDED.volume,
       turnover_millimes = EXCLUDED.turnover_millimes,
       trade_count = EXCLUDED.trade_count,
       quality_flag = EXCLUDED.quality_flag,
       import_batch_id = EXCLUDED.import_batch_id
     RETURNING (xmax = 0) AS inserted`,
    [
      SOURCE_ID,
      batchId,
      sourceSymbols,
      dates,
      opens,
      highs,
      lows,
      closes,
      vols,
      turns,
      trades,
      quals,
    ],
  );
  let inserted = 0;
  let updated = 0;
  for (const row of res.rows) {
    if (row.inserted) inserted++;
    else updated++;
  }
  return { inserted, updated };
}

function normalizeRow(raw) {
  const session_date = parseFrDate(raw.session);
  if (!session_date || !raw.code) return { reject: 'BAD_KEY' };
  const close_millimes = toMillimes(raw.close ?? raw.last);
  if (close_millimes == null) return { reject: 'BAD_CLOSE' };
  const q = qualityOf(raw);
  if (q === 'REJECT_PRICE') return { reject: q };
  return {
    source_symbol: String(raw.code).trim(),
    name: raw.name,
    group: raw.group,
    session_date,
    open_millimes: toMillimes(raw.open),
    high_millimes: toMillimes(raw.high),
    low_millimes: toMillimes(raw.low),
    close_millimes,
    volume: (() => {
      const v = toMillimes(String(raw.qty || '0').replace(',', '.'));
      // qty is shares not TND — parse as int
      const n = Number(String(raw.qty || '0').replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? Math.round(n) : null;
    })(),
    turnover_millimes: toMillimes(raw.capitals),
    trade_count: (() => {
      const n = Number(String(raw.trades || '0').replace(/\s/g, ''));
      return Number.isFinite(n) ? Math.round(n) : null;
    })(),
    quality_flag: q,
  };
}

async function ingestTextFile(client, batchId, filePath, stats) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let kind = null;
  let map = null;
  let buffer = [];
  const instruments = new Map();

  for await (const line of rl) {
    stats.rows_read++;
    if (!kind) {
      kind = detectKind(filePath, line);
      if (kind === 'csv_semi') {
        map = parseCsvHeaderMap(splitSemi(line));
        continue;
      }
      if (kind === 'txt_fw') continue;
      stats.rows_rejected++;
      continue;
    }
    let raw;
    if (kind === 'csv_semi') {
      if (!line.trim() || /SEANCE/i.test(line)) continue;
      raw = rowFromCsv(splitSemi(line), map);
    } else {
      raw = parseTxtRow(line);
      if (!raw) continue;
    }
    const norm = normalizeRow(raw);
    if (norm.reject) {
      stats.rows_rejected++;
      continue;
    }
    if (!instruments.has(norm.source_symbol)) {
      await upsertInstrument(client, { ...raw, code: norm.source_symbol, name: norm.name, group: norm.group });
      instruments.set(norm.source_symbol, true);
    }
    buffer.push(norm);
    if (buffer.length >= 1000) {
      const r = await flushBars(client, batchId, buffer);
      stats.rows_inserted += r.inserted;
      stats.rows_updated += r.updated;
      buffer = [];
    }
  }
  if (buffer.length) {
    const r = await flushBars(client, batchId, buffer);
    stats.rows_inserted += r.inserted;
    stats.rows_updated += r.updated;
  }
  stats.instruments = instruments.size;
  return kind;
}

async function ingestXlsx(client, batchId, filePath, stats) {
  if (!XLSX) throw new Error('Package xlsx required for 2026 workbook — npm install xlsx --prefix tools/market-data');
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  let buffer = [];
  const instruments = new Map();
  for (const obj of rows) {
    stats.rows_read++;
    const keys = Object.keys(obj);
    const upper = {};
    for (const k of keys) upper[String(k).replace(/\s+/g, '').toUpperCase()] = obj[k];
    const raw = {
      session: upper.SEANCE || upper.DATE || upper.DATESEANCE || obj[keys[0]],
      group: upper.GROUPE || upper.C_GR_RLC,
      code: upper.CODE || upper.CODE_VAL || upper.ISIN || upper.CODEISIN,
      name: upper.VALEUR || upper.LIB_VAL || upper.NOM,
      open: upper.OUVERTURE || upper.COURSOUVERT,
      close: upper.CLOTURE || upper.DERNIER_COURS,
      low: upper.PLUS_BAS || upper.PLUSBAS,
      high: upper.PLUS_HAUT || upper.PLUSHAUT,
      qty: upper.QUANTITE_NEGOCIEE || upper.QUANTITES,
      trades: upper.NB_TRANSACTION || upper.NB_TRAN || upper.ECHANGES,
      capitals: upper.CAPITAUX,
    };
    if (typeof raw.session === 'object' && raw.session instanceof Date) {
      raw.session = raw.session.toISOString().slice(0, 10);
    }
    const norm = normalizeRow(raw);
    if (norm.reject) {
      stats.rows_rejected++;
      continue;
    }
    if (!instruments.has(norm.source_symbol)) {
      await upsertInstrument(client, { ...raw, code: norm.source_symbol, name: norm.name });
      instruments.set(norm.source_symbol, true);
    }
    buffer.push(norm);
    if (buffer.length >= 1000) {
      const r = await flushBars(client, batchId, buffer);
      stats.rows_inserted += r.inserted;
      stats.rows_updated += r.updated;
      buffer = [];
    }
  }
  if (buffer.length) {
    const r = await flushBars(client, batchId, buffer);
    stats.rows_inserted += r.inserted;
    stats.rows_updated += r.updated;
  }
  stats.instruments = instruments.size;
}

async function main() {
  const cfg = loadConfig();
  const sourceRoot = process.env.CMF_SOURCE_ROOT || cfg.cmfSourceRoot;
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`CMF source root not found: ${sourceRoot}`);
  }

  // Controlled inventory (no mutation of originals)
  const reportDir = path.join(projectRoot(), cfg.reportsDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const files = listInputFiles(sourceRoot).filter((f) => !f.toLowerCase().endsWith('.zip'));

  const client = await connectAllowedDb();
  const started = Date.now();
  const global = {
    files: [],
    rows_read: 0,
    rows_inserted: 0,
    rows_updated: 0,
    rows_rejected: 0,
  };

  try {
    for (const filePath of files) {
      const hash = fileSha256(filePath);
      const rel = path.relative(sourceRoot, filePath);
      const stats = {
        rows_read: 0,
        rows_inserted: 0,
        rows_updated: 0,
        rows_rejected: 0,
        instruments: 0,
      };
      const batchId = await ensureBatch(client, filePath, hash);
      console.log('INGEST', rel);
      try {
        if (filePath.toLowerCase().endsWith('.xlsx')) {
          await ingestXlsx(client, batchId, filePath, stats);
        } else {
          await ingestTextFile(client, batchId, filePath, stats);
        }
        await client.query(
          `UPDATE market_import_batches SET finished_at = NOW(), status = 'SUCCESS',
            rows_read=$2, rows_inserted=$3, rows_updated=$4, rows_rejected=$5,
            quality_json=$6::jsonb WHERE id=$1`,
          [
            batchId,
            stats.rows_read,
            stats.rows_inserted,
            stats.rows_updated,
            stats.rows_rejected,
            JSON.stringify({ instruments: stats.instruments, file: rel }),
          ],
        );
      } catch (e) {
        await client.query(
          `UPDATE market_import_batches SET finished_at = NOW(), status = 'FAILED', error_log=$2 WHERE id=$1`,
          [batchId, String(e.stack || e)],
        );
        throw e;
      }
      global.files.push({ file: rel, ...stats, hash });
      global.rows_read += stats.rows_read;
      global.rows_inserted += stats.rows_inserted;
      global.rows_updated += stats.rows_updated;
      global.rows_rejected += stats.rows_rejected;
    }

    const coverage = await client.query(
      `SELECT MIN(session_date) AS min_d, MAX(session_date) AS max_d, COUNT(*)::bigint AS bars,
              COUNT(DISTINCT source_symbol)::int AS symbols
       FROM market_price_bars WHERE source_id=$1`,
      [SOURCE_ID],
    );
    const out = {
      source: SOURCE_ID,
      sourceRoot,
      elapsedMs: Date.now() - started,
      ...global,
      coverage: coverage.rows[0],
      db: (await client.query('SELECT current_database() AS d')).rows[0].d,
    };
    const outPath = path.join(reportDir, 'cmf-ingest-report.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    console.log('report=', outPath);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});