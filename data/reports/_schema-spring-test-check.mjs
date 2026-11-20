import pg from 'pg';

const url = (process.env.DATABASE_URL || 'postgresql://nasma:root@localhost:5432/PIF_spring_test')
  .replace('?schema=public', '');
const client = new pg.Client({ connectionString: url });
await client.connect();
const db = (await client.query('select current_database() d')).rows[0].d;
console.log('DB', db);

const enums = await client.query("SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='TradingOrderType' ORDER BY e.enumsortorder");
console.log('TradingOrderType', enums.rows.map(r => r.enumlabel));

const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'platform_%' OR tablename IN ('instruments','portfolios','orders','executions')) ORDER BY 1");
console.log('tables', tables.rows.map(r => r.tablename));

const assets = await client.query('SELECT asset_class, fictional, count(*)::int AS n FROM instruments GROUP BY 1, 2 ORDER BY 1, 2');
console.log('assets', assets.rows);

const mig = await client.query("SELECT migration_name FROM _prisma_migrations WHERE migration_name ILIKE '%admin%' OR migration_name ILIKE '%take%' OR migration_name ILIKE '%platform%' OR migration_name ILIKE '%bond%' OR migration_name ILIKE '%fx%' ORDER BY finished_at NULLS LAST");
console.log('mig', mig.rows.map(r => r.migration_name));

const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='orders' AND column_name ILIKE '%take%'");
console.log('orders_take_cols', cols.rows);

await client.end();