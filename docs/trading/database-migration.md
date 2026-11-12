# Virtual-trading migration: backup, apply, rollback

Migration: `apps/api/prisma/migrations/20261110090000_virtual_trading/migration.sql`

| Database | Status (9 Nov 2026) |
| --- | --- |
| `PIF_test` (disposable test database) | **Applied.** All API e2e suites pass on it |
| `PIF` (development database) | **Applied on 9 Nov 2026 at 17:57, with approval**, together with `20261111090000_actuarial_scenarios`. See section 5 |

## 1. What the migration does

It is **purely additive**. It contains no `DROP`, does not alter or rewrite any existing table, and does not touch user, session, audit or learning data.

- **8 enum types:**
  - `InstrumentAssetClass`, `InstrumentStatus`;
  - `TradingPortfolioStatus`, `TradingOrderSide`, `TradingOrderType`, `TradingOrderStatus`;
  - `CashEntryType`, `ValuationSnapshotKind`.
- **8 tables:**
  - `instruments`;
  - `trading_portfolios`, `portfolio_positions`, `portfolio_cash_entries`;
  - `trading_orders`, `trading_executions`;
  - `portfolio_valuation_snapshots`;
  - `watchlist_items`.
- **Indexes and foreign keys:** foreign keys to `users` cascade on user deletion, so deleting a user also deletes their virtual portfolios.
- **CHECK constraints:**
  - cash ≥ 0;
  - position quantity > 0 with cost ≥ 0;
  - order quantity > 0 and 0 ≤ filled ≤ quantity;
  - execution quantity, price > 0, fee ≥ 0;
  - maximum weight 1–100.
- **Seed:** the 7 fictional instruments, with `ON CONFLICT (symbol) DO NOTHING`, so a re-run is harmless.

It was generated with `prisma migrate diff` from the previous schema to the new one, then reviewed by hand.

## 2. Backups taken before applying anything

Custom-format dumps (`pg_dump -Fc`), stored outside the repository and outside OneDrive:

| File | Size |
| --- | --- |
| `%LOCALAPPDATA%\PIF\db-backups\PIF-before-virtual-trading-20261109-153340.dump` | 74,270 bytes |
| `%LOCALAPPDATA%\PIF\db-backups\PIF_test-before-virtual-trading-20261109-153340.dump` | 56,752 bytes |

**Restore test.** The `PIF` dump was restored with `pg_restore` into a scratch database, `pif_restore_check`. Its row counts matched the source:

| Table | Rows |
| --- | --- |
| users | 19 |
| audit_events | 169 |
| auth_sessions | 45 |
| auth_tokens | 152 |
| applied migrations | 4 |
| learning tables | 0 |

The scratch database was dropped afterwards.

The `PIF` dump is from 15:33 on 9 Nov 2026. **Take a fresh dump immediately before applying** if anything has been written to `PIF` since.

## 3. Applying to `PIF` (after approval)

Run from `apps/api`. The connection string comes from `.env` and is never printed.

```powershell
# 1. Fresh backup (asks for nothing if DATABASE_URL carries the credentials; otherwise use a pgpass file).
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dir = Join-Path $env:LOCALAPPDATA 'PIF\db-backups'; New-Item -ItemType Directory -Force $dir | Out-Null
& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' -Fc --dbname "<from DATABASE_URL>" -f (Join-Path $dir "PIF-before-virtual-trading-$stamp.dump")

# 2. Check what is pending: only 20261110090000_virtual_trading should be listed.
npx prisma migrate status

# 3. Apply (non-interactive, applies pending migrations only; never resets).
npx prisma migrate deploy
```

Never use `prisma migrate reset` or `prisma db push --force-reset` on `PIF`.

**Verify after applying:**

- run `npx prisma migrate status`;
- `GET /api/market/instruments` returns 7 instruments;
- creating a portfolio in the web app works;
- the counts in section 2 are unchanged.

## 4. Rollback

**Preferred: restore the backup.** It returns the database exactly to its pre-migration state. Run it into a fresh database, check it, then swap:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\createdb.exe' PIF_restored
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' --dbname PIF_restored --no-owner "<dump file>"
```

**Alternative: remove only the new objects.** This is valid because nothing else depends on them. It deletes every virtual portfolio, order and trade, so export those first if they matter:

```sql
BEGIN;
DROP TABLE IF EXISTS "watchlist_items", "portfolio_valuation_snapshots", "portfolio_cash_entries",
  "trading_executions", "trading_orders", "portfolio_positions", "trading_portfolios", "instruments";
DROP TYPE IF EXISTS "ValuationSnapshotKind", "CashEntryType", "TradingOrderStatus", "TradingOrderType",
  "TradingOrderSide", "TradingPortfolioStatus", "InstrumentStatus", "InstrumentAssetClass";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261110090000_virtual_trading';
COMMIT;
```

After a rollback, deploy the previous application build. The current build would answer `503 DATABASE_SCHEMA_OUTDATED` on the trading endpoints, and it keeps working everywhere else.

## 5. Application log

**9 Nov 2026: `PIF`.** Both pending migrations (`20261110090000_virtual_trading` and `20261111090000_actuarial_scenarios`) were applied together, after explicit approval.

1. **Status check.** `npx prisma migrate status` listed exactly those two as pending.
2. **Backup.** A fresh backup was taken: `%LOCALAPPDATA%\PIF\db-backups\PIF-before-trading-actuarial-20261109-175645.dump` (74,270 bytes).
3. **Restore test.** The dump was restored into `pif_restore_check`, which was then dropped. Its counts were identical to the source:

   | Table | Rows |
   | --- | --- |
   | users | 19 |
   | audit_events | 169 |
   | auth_sessions | 45 |
   | auth_tokens | 152 |
   | applied migrations | 4 |
   | tables | 14 |

4. **Apply.** `npx prisma migrate deploy` applied both migrations. `migrate status` now reports "Database schema is up to date" (6 migrations).
5. **Verification.**
   - The existing counts are unchanged: users 19, audit_events 169, auth_sessions 45, auth_tokens 152.
   - There are now 23 tables (9 new).
   - `instruments` holds 7 rows.
   - `actuarial_scenarios` holds 0 rows.

**Rollback:** restore the dump above, as described in section 4.

**9 Nov 2026, about 18:06–18:11: `PIF`, unapproved apply and rollback.** The actuarial migration `20261112090000_actuarial_simulation_runs` was applied to `PIF` by mistake, then rolled back after a restore-tested backup (`PIF-before-simulation-runs-rollback-20261109-181109.dump`). No existing row was changed. Full log and the guard now used before every database command: [actuarial architecture §7](../actuarial/architecture.md#7-incident-unapproved-apply-to-pif-and-rollback).

**9 Nov 2026, 18:52: `PIF`.** `20261112090000_actuarial_simulation_runs` was applied with explicit approval. A fresh backup was taken first, `PIF-before-simulation-runs-20261109-185210.dump` (105,217 bytes), and restore-tested: all 23 tables had identical counts. After the deploy, the 22 existing tables kept their row counts, and `migrate status` reports 7 migrations, up to date. Details: [actuarial architecture §6](../actuarial/architecture.md#simulation-runs-migration).

**9 Nov 2026, 20:15–20:16: `PIF_test`, then `PIF`: `20261113090000_trading_event_sequence`.** Applied with explicit approval: add the sequence, apply to `PIF_test`, then to `PIF` after a fresh, restore-tested backup.

- **What it does.** It is additive. It adds `sequence INTEGER` to `trading_orders`, `trading_executions` and `portfolio_cash_entries`, and backfills existing rows per portfolio in financial-time order, with ties broken by write time, then id. It then adds `NOT NULL`, `CHECK (sequence >= 1)` and a unique index on (`portfolio_id`, `sequence`). No existing value is modified.
- **Rollback.** Drop the three `*_portfolio_id_sequence_key` indexes and the three `sequence` columns.
- **`PIF_test`.** Applied first. `prisma migrate diff` shows no drift, and the trading e2e suite passed 9/9 on three consecutive runs.
- **`PIF` backup.** `PIF-before-trading-event-sequence-20261109-201509.dump` (107,945 bytes).
- **Restore test.** The backup was restored into the scratch database `pif_restore_check`. All 24 tables had identical row counts and content hashes (md5 of every row); the scratch database was then dropped. `migrate status` listed exactly this one migration as pending.
- **Deploy.** The fingerprint was re-checked just before the deploy and was unchanged. After `migrate deploy`:
  - `migrate status` reports "Database schema is up to date!" (8 migrations), and `migrate diff` shows no drift;
  - comparing fingerprints, the only difference is `_prisma_migrations`, 7 to 8 rows. Users 19, audit events 169, sessions 45, tokens 152, and every other table's content hash are unchanged;
  - the trading tables were empty, so there was nothing to backfill;
  - the three columns are `NOT NULL`, and the three CHECK constraints are validated.

**9 Nov 2026, about 23:05: `PIF`: `20261114090000_actuarial_reserving_runs`.** Applied with explicit approval, after a fresh, restore-tested backup, `PIF-before-reserving-runs-20261109-230407.dump` (109,528 bytes). The restore matched all 24 tables by row count and content hash. After the deploy, the only differences were `_prisma_migrations` (8 to 9 rows) and the new, empty `actuarial_reserving_runs`; `migrate status` reports 9 migrations, up to date, with no drift. Details: [actuarial architecture §6](../actuarial/architecture.md#reserving-runs-migration).
