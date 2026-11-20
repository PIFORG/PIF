import pg from 'pg';

const url = (process.env.PIF_READONLY_URL || 'postgresql://nasma:root@localhost:5432/PIF').replace('?schema=public', '');
const client = new pg.Client({ connectionString: url });
await client.connect();
const db = (await client.query('select current_database() d')).rows[0].d;
if (db !== 'PIF') {
  await client.end();
  throw new Error('Expected database PIF, got ' + db);
}
console.log('DB', db, '(read-only probe)');

const enums = await client.query("SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='TradingOrderType' ORDER BY e.enumsortorder");
console.log('TradingOrderType', enums.rows.map(r => r.enumlabel));

const platform = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'platform_%' ORDER BY 1");
console.log('platform_tables', platform.rows.map(r => r.tablename));

const assets = await client.query('SELECT asset_class, count(*)::int AS n FROM instruments GROUP BY 1 ORDER BY 1');
console.log('asset_classes', assets.rows);

const tableCount = await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
console.log('public_tables', tableCount.rows[0].n);

await client.end();
console.log('writes: none');