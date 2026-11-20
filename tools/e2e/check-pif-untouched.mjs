import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, '../db-harness/package.json'));
const { Client } = require('pg');

const test = new Client({ connectionString: 'postgresql://nasma:root@localhost:5432/PIF_spring_test' });
await test.connect();
const td = (await test.query('SELECT current_database() AS d')).rows[0].d;
if (td !== 'PIF_spring_test') throw new Error('expected PIF_spring_test');
await test.end();

const main = new Client({ connectionString: 'postgresql://nasma:root@localhost:5432/PIF' });
await main.connect();
const r = await main.query(
  `SELECT current_database() AS d,
          (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables`,
);
console.log(JSON.stringify({ testDb: td, mainDbReadOnly: r.rows[0], writesOnMain: false }, null, 2));
await main.end();
