import { connectAllowedDb } from './lib.mjs';
const c = await connectAllowedDb();
const r = await c.query(`SELECT
  COUNT(*) FILTER (WHERE fictional=false)::int AS real_n,
  COUNT(*) FILTER (WHERE fictional=true)::int AS fict_n,
  COUNT(*) FILTER (WHERE fictional=false AND provider_id='CMF_BVMT_HIST')::int AS cmf,
  COUNT(*) FILTER (WHERE fictional=false AND provider_id='YAHOO')::int AS yahoo,
  COUNT(*) FILTER (WHERE fictional=false AND coalesce(metadata->>'tradable','true')='false')::int AS non_tradable,
  COUNT(*) FILTER (WHERE fictional=false AND symbol LIKE 'TN%')::int AS isin_sym,
  COUNT(*) FILTER (WHERE fictional=false AND symbol LIKE 'BV%')::int AS bv_sym
FROM instruments`);
console.log(JSON.stringify(r.rows[0], null, 2));
await c.end();