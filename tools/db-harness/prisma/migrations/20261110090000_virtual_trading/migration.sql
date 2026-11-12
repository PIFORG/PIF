-- CreateEnum
CREATE TYPE "InstrumentAssetClass" AS ENUM ('EQUITY', 'FUND');

-- CreateEnum
CREATE TYPE "InstrumentStatus" AS ENUM ('ACTIVE', 'HALTED');

-- CreateEnum
CREATE TYPE "TradingPortfolioStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TradingOrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "TradingOrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP');

-- CreateEnum
CREATE TYPE "TradingOrderStatus" AS ENUM ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CashEntryType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ValuationSnapshotKind" AS ENUM ('OPENING', 'CASH_FLOW', 'POST_TRADE');

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "symbol" VARCHAR(16) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "asset_class" "InstrumentAssetClass" NOT NULL,
    "sector" VARCHAR(60) NOT NULL,
    "quote_currency" VARCHAR(3) NOT NULL DEFAULT 'TND',
    "status" "InstrumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "price_decimals" INTEGER NOT NULL DEFAULT 3,
    "quantity_decimals" INTEGER NOT NULL DEFAULT 0,
    "lot_size" INTEGER NOT NULL DEFAULT 1,
    "provider_id" VARCHAR(40) NOT NULL,
    "provider_symbol" VARCHAR(32) NOT NULL,
    "fictional" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_portfolios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "base_currency" VARCHAR(3) NOT NULL DEFAULT 'TND',
    "status" "TradingPortfolioStatus" NOT NULL DEFAULT 'ACTIVE',
    "initial_capital_millimes" BIGINT NOT NULL,
    "cash_millimes" BIGINT NOT NULL,
    "net_contributions_millimes" BIGINT NOT NULL,
    "realized_pnl_millimes" BIGINT NOT NULL DEFAULT 0,
    "fees_paid_millimes" BIGINT NOT NULL DEFAULT 0,
    "spread_cost_millimes" BIGINT NOT NULL DEFAULT 0,
    "max_position_weight_pct" INTEGER NOT NULL DEFAULT 50,
    "version" INTEGER NOT NULL DEFAULT 0,
    "matched_through" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trading_portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_positions" (
    "id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cost_basis_millimes" BIGINT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_cash_entries" (
    "id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "type" "CashEntryType" NOT NULL,
    "amount_millimes" BIGINT NOT NULL,
    "balance_after_millimes" BIGINT NOT NULL,
    "execution_id" UUID,
    "description" VARCHAR(160) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_orders" (
    "id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "client_order_id" VARCHAR(80) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "side" "TradingOrderSide" NOT NULL,
    "type" "TradingOrderType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "limit_price_millimes" BIGINT,
    "stop_price_millimes" BIGINT,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "status" "TradingOrderStatus" NOT NULL,
    "filled_quantity" INTEGER NOT NULL DEFAULT 0,
    "average_price_millimes" BIGINT,
    "rejection_code" VARCHAR(40),
    "status_reason" VARCHAR(240),
    "quote_mid_millimes" BIGINT NOT NULL,
    "quote_bid_millimes" BIGINT NOT NULL,
    "quote_ask_millimes" BIGINT NOT NULL,
    "quote_as_of" TIMESTAMP(3) NOT NULL,
    "provider_id" VARCHAR(40) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trading_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_executions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "side" "TradingOrderSide" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price_millimes" BIGINT NOT NULL,
    "notional_millimes" BIGINT NOT NULL,
    "fee_millimes" BIGINT NOT NULL,
    "spread_cost_millimes" BIGINT NOT NULL,
    "realized_pnl_millimes" BIGINT NOT NULL,
    "quote_mid_millimes" BIGINT NOT NULL,
    "quote_bid_millimes" BIGINT NOT NULL,
    "quote_ask_millimes" BIGINT NOT NULL,
    "provider_id" VARCHAR(40) NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trading_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_valuation_snapshots" (
    "id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "kind" "ValuationSnapshotKind" NOT NULL,
    "equity_millimes" BIGINT NOT NULL,
    "cash_millimes" BIGINT NOT NULL,
    "positions_value_millimes" BIGINT NOT NULL,
    "net_contributions_millimes" BIGINT NOT NULL,
    "external_flow_millimes" BIGINT NOT NULL DEFAULT 0,
    "as_of" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_valuation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instruments_symbol_key" ON "instruments"("symbol");

-- CreateIndex
CREATE INDEX "instruments_asset_class_idx" ON "instruments"("asset_class");

-- CreateIndex
CREATE INDEX "trading_portfolios_user_id_status_idx" ON "trading_portfolios"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trading_portfolios_user_id_name_key" ON "trading_portfolios"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_positions_portfolio_id_instrument_id_key" ON "portfolio_positions"("portfolio_id", "instrument_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_cash_entries_execution_id_key" ON "portfolio_cash_entries"("execution_id");

-- CreateIndex
CREATE INDEX "portfolio_cash_entries_portfolio_id_occurred_at_idx" ON "portfolio_cash_entries"("portfolio_id", "occurred_at");

-- CreateIndex
CREATE INDEX "trading_orders_portfolio_id_status_idx" ON "trading_orders"("portfolio_id", "status");

-- CreateIndex
CREATE INDEX "trading_orders_portfolio_id_submitted_at_idx" ON "trading_orders"("portfolio_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "trading_orders_portfolio_id_client_order_id_key" ON "trading_orders"("portfolio_id", "client_order_id");

-- CreateIndex
CREATE INDEX "trading_executions_portfolio_id_executed_at_idx" ON "trading_executions"("portfolio_id", "executed_at");

-- CreateIndex
CREATE INDEX "trading_executions_order_id_idx" ON "trading_executions"("order_id");

-- CreateIndex
CREATE INDEX "portfolio_valuation_snapshots_portfolio_id_as_of_idx" ON "portfolio_valuation_snapshots"("portfolio_id", "as_of");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_user_id_instrument_id_key" ON "watchlist_items"("user_id", "instrument_id");

-- AddForeignKey
ALTER TABLE "trading_portfolios" ADD CONSTRAINT "trading_portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "trading_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_cash_entries" ADD CONSTRAINT "portfolio_cash_entries_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "trading_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_cash_entries" ADD CONSTRAINT "portfolio_cash_entries_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "trading_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "trading_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_executions" ADD CONSTRAINT "trading_executions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "trading_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_executions" ADD CONSTRAINT "trading_executions_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "trading_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_executions" ADD CONSTRAINT "trading_executions_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_valuation_snapshots" ADD CONSTRAINT "portfolio_valuation_snapshots_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "trading_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ledger invariants enforced by the database as well as by the trading service.
ALTER TABLE "trading_portfolios" ADD CONSTRAINT "trading_portfolios_cash_non_negative" CHECK ("cash_millimes" >= 0);
ALTER TABLE "trading_portfolios" ADD CONSTRAINT "trading_portfolios_weight_limit_range" CHECK ("max_position_weight_pct" BETWEEN 1 AND 100);
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_quantity_positive" CHECK ("quantity" > 0 AND "cost_basis_millimes" >= 0);
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_quantity_range" CHECK ("quantity" > 0 AND "filled_quantity" BETWEEN 0 AND "quantity");
ALTER TABLE "trading_executions" ADD CONSTRAINT "trading_executions_amounts_valid" CHECK ("quantity" > 0 AND "price_millimes" > 0 AND "fee_millimes" >= 0);

-- Fictional instruments priced by the deterministic simulated provider (src/market-data).
INSERT INTO "instruments" ("id", "symbol", "name", "asset_class", "sector", "quote_currency", "status", "price_decimals", "quantity_decimals", "lot_size", "provider_id", "provider_symbol", "fictional", "metadata", "updated_at") VALUES
  (gen_random_uuid(), 'CTB', 'Carthage Bank', 'EQUITY', 'Banking', 'TND', 'ACTIVE', 3, 0, 1, 'pif-simulated-v1', 'CTB', true, '{"referencePrice": 42.5}', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MDX', 'Medina Telecom', 'EQUITY', 'Telecom', 'TND', 'ACTIVE', 3, 0, 1, 'pif-simulated-v1', 'MDX', true, '{"referencePrice": 18.2}', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OLV', 'Olivia Foods', 'EQUITY', 'Consumer staples', 'TND', 'ACTIVE', 3, 0, 1, 'pif-simulated-v1', 'OLV', true, '{"referencePrice": 9.85}', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SFX', 'Sfax Phosphates', 'EQUITY', 'Materials', 'TND', 'ACTIVE', 3, 0, 1, 'pif-simulated-v1', 'SFX', true, '{"referencePrice": 63}', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TEK', 'TunisTech', 'EQUITY', 'Technology', 'TND', 'ACTIVE', 3, 0, 1, 'pif-simulated-v1', 'TEK', true, '{"referencePrice": 27.4}', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ATL', 'Atlas Utilities', 'EQUITY', 'Utilities', 'TND', 'ACTIVE', 3, 0, 1, 'pif-simulated-v1', 'ATL', true, '{"referencePrice": 14.6}', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GOV', 'Treasury Bond Fund', 'FUND', 'Fixed income', 'TND', 'ACTIVE', 3, 0, 1, 'pif-simulated-v1', 'GOV', true, '{"referencePrice": 100}', CURRENT_TIMESTAMP)
ON CONFLICT ("symbol") DO NOTHING;
