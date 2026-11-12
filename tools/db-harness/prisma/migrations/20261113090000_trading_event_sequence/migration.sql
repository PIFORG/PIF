-- Trading: deterministic per-portfolio event order for orders, executions and cash-ledger entries.
-- Additive: one column per table, backfilled in financial-time order (ties by recording time, then id),
-- then NOT NULL, CHECK (>= 1) and unique per portfolio. No existing value is modified.
-- Rollback: DROP INDEX the three *_portfolio_id_sequence_key indexes; ALTER TABLE ... DROP COLUMN "sequence" on the three tables.

-- AlterTable
ALTER TABLE "trading_orders" ADD COLUMN "sequence" INTEGER;

UPDATE "trading_orders" AS o
SET "sequence" = s.n
FROM (
    SELECT "id", row_number() OVER (PARTITION BY "portfolio_id" ORDER BY "submitted_at", "created_at", "id") AS n
    FROM "trading_orders"
) AS s
WHERE o."id" = s."id";

ALTER TABLE "trading_orders" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_sequence_check" CHECK ("sequence" >= 1);

-- AlterTable
ALTER TABLE "trading_executions" ADD COLUMN "sequence" INTEGER;

UPDATE "trading_executions" AS e
SET "sequence" = s.n
FROM (
    SELECT "id", row_number() OVER (PARTITION BY "portfolio_id" ORDER BY "executed_at", "recorded_at", "id") AS n
    FROM "trading_executions"
) AS s
WHERE e."id" = s."id";

ALTER TABLE "trading_executions" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "trading_executions" ADD CONSTRAINT "trading_executions_sequence_check" CHECK ("sequence" >= 1);

-- AlterTable
ALTER TABLE "portfolio_cash_entries" ADD COLUMN "sequence" INTEGER;

UPDATE "portfolio_cash_entries" AS c
SET "sequence" = s.n
FROM (
    SELECT "id", row_number() OVER (PARTITION BY "portfolio_id" ORDER BY "occurred_at", "created_at", "id") AS n
    FROM "portfolio_cash_entries"
) AS s
WHERE c."id" = s."id";

ALTER TABLE "portfolio_cash_entries" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "portfolio_cash_entries" ADD CONSTRAINT "portfolio_cash_entries_sequence_check" CHECK ("sequence" >= 1);

-- CreateIndex
CREATE UNIQUE INDEX "trading_orders_portfolio_id_sequence_key" ON "trading_orders"("portfolio_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "trading_executions_portfolio_id_sequence_key" ON "trading_executions"("portfolio_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_cash_entries_portfolio_id_sequence_key" ON "portfolio_cash_entries"("portfolio_id", "sequence");
