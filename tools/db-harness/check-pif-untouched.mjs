import pg from 'pg';
const { Client } = pg;
const c = new Client({ connectionString: 'postgresql://nasma:root@localhost:5432/PIF' });
await c.connect();
const t = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'platform_%'");
console.log('PIF platform tables:', JSON.stringify(t.rows));
const m = await c.query("SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%platform_admin%'");
console.log('PIF admin migrations:', JSON.stringify(m.rows));
await c.end();