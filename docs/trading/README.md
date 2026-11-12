# Virtual trading and portfolios

Persistent, multi-user virtual trading on the shared financial core. Every user can hold up to five virtual portfolios, trade the fictional instrument universe with market, limit and stop-loss orders, and read valuation, performance and risk. **No real money, no real market, no real prices.**

Status (9 Nov 2026): implemented and tested against `PIF_test`. The migration is applied to `PIF_test` and, after approval, to the development database `PIF`. See [database-migration.md](database-migration.md).

## 1. Where the code lives

| Layer | Path | Role |
| --- | --- | --- |
| Shared core | `apps/api/src/finance/` | Money (integer millimes), execution prices, commissions, ledger booking, pre-trade checks, valuation, VaR/ES, stress, TWR. Shared with MarketQuest; not duplicated. |
| Market data | `apps/api/src/market-data/` | `MarketDataProvider` interface, deterministic `SimulatedMarketProvider`, injectable `Clock`, the fictional universe (also used by the missions). |
| Trading engine | `apps/api/src/trading/engine.ts` | Pure order evaluation, placement, matching of resting orders, expiry. No I/O. |
| Analytics | `apps/api/src/trading/analytics.ts` | Pure valuation, reconciliation, allocation, concentration, TWR, Modified Dietz, VaR/ES, volatility, drawdown, stress. |
| Services | `apps/api/src/trading/market.service.ts`, `portfolios.service.ts` | Persistence, locking, idempotency, lazy matching. |
| API | `apps/api/src/trading/trading.controller.ts` | `/api/market/*`, `/api/portfolios/*` (Swagger tags *Markets*, *Portfolios*, *Trading*). |
| Web | `apps/web/src/components/trading/`, `apps/web/src/app/{markets,trading,portfolios}/` | Screens inside the existing workspace template. |

## 2. Market data

- **Provider:** `pif-simulated-v1`, kind `FICTIONAL`, currency TND. Every response that carries prices includes this provenance, and every screen shows "Fictional simulated prices".
- **Model:** a one-factor daily log return per instrument (shared market factor plus idiosyncratic noise, seeded by date), and a Brownian bridge for intraday prices. History starts on 1 Jan 2026 00:00 UTC.
- **Quote period:** 5 minutes, around the clock, every day. A quote (bid, ask, mid, depth at the best price) is valid for its whole period. `validUntil` is the end of the period.
- **Determinism:** the same `(provider, symbol, time)` always gives the same quote, so any past quote can be regenerated exactly. Orders and executions also store the quote they used.
- **Price observations are not persisted.** This is a deliberate decision: storing them would add an unbounded table whose content is a pure function of time. Persist observations only when a non-deterministic provider (delayed or live data) is added; the `MarketDataProvider` interface already separates the two.
- **No paid API, no live data.** A real provider can be added behind `MARKET_DATA_PROVIDER` once a licensed source is approved.
- **Change since previous close:** `changePct` is in **percent** (2.11 = +2.11 %), the same convention as the learning API. Portfolio ratios (`weight`, `unrealizedPct`, `impactPct`, returns) are **ratios** (0.0211 = +2.11 %).

## 3. Trading rules

| Rule | Value |
| --- | --- |
| Instruments | 6 equities, 1 bond fund (`GOV`), from `instruments` |
| Commission | Equities 0.25 %, funds 0.10 %, minimum 0.500 DT, charged on every fill |
| Money | Integer millimes (0.001 DT) end to end; API amounts are DT with 3 decimals |
| Portfolios per user | 5; starting cash 1,000–1,000,000 DT |
| Deposits / withdrawals | Up to 1,000,000 DT each; net contributions capped at 10,000,000 DT |
| Order size | 1–1,000,000 units, whole lots |
| Open orders | 50 per portfolio |
| Position limit | A buy may not take one instrument above the portfolio's maximum weight (default 50 % of equity) |
| Limit band | Limit prices within ±50 % of the mid |
| Resting orders | Good till cancelled, expire after 30 days |

**Order types**

- **Market:** immediate-or-cancel. It fills at the ask (buy) or bid (sell) up to the depth still available in the current quote period. Any remainder is cancelled with a written reason. It is never left working.
- **Limit:** a marketable limit fills now like a market order, capped at the limit. Otherwise it rests. A resting limit fills at the limit, or at a better quote, in the first period whose quote crosses it.
- **Stop-loss (sell only):** it triggers when the bid falls to the stop or below, then sells at the bid. A buy stop is refused.
- **Sells** are checked against units held. A stop-loss and a take-profit limit may coexist on the same position. When a position is closed, its other open sells are cancelled.
- **Cash reservation:** working buy orders reserve cash at their limit price plus the commission. `availableCash = cash − reserved`.

**Lifecycle:** `OPEN` → `PARTIALLY_FILLED` (still working) → `FILLED` | `CANCELLED` | `EXPIRED`, or `REJECTED` at submission. After a partial fill, a terminal state keeps `filledQuantity > 0`.

**Liquidity:** depth is the size at the best price in a quote period. Within a period, this portfolio's own fills consume it.

**Lazy matching:** there is no background job. Every portfolio read or write first matches working orders against every quote period since the last match, in time order. The portfolio row is locked while it does so, so the result is identical whichever request triggers it.

## 4. Safety: concurrency, idempotency, ownership

- Every portfolio operation runs in one database transaction that takes `SELECT … FOR UPDATE` on the portfolio row, filtered by owner. Another user's portfolio is indistinguishable from a missing one (`404 PORTFOLIO_NOT_FOUND`).
- **Idempotency:** `clientOrderId` is unique per portfolio. Resubmitting the same key with the same terms returns the original order with `replayed: true`. Resubmitting it with different terms returns `409 IDEMPOTENCY_KEY_REUSED`. The web ticket keeps one key per order intent, so a retried confirm can never place an order twice.
- **Stale views:** `expectedVersion` must match the portfolio version (`409 PORTFOLIO_CHANGED`), and `quoteAsOf` must be the current quote period (`409 QUOTE_CHANGED`). The ticket then re-previews automatically and asks the user to confirm again.
- **Rejections** are recorded as `REJECTED` orders (HTTP 201 with the reason) when they reach submission. The web ticket blocks confirmation when the server preview already rejects the order.
- **Database checks:** cash ≥ 0, quantities > 0, filled ≤ quantity, prices > 0, fees ≥ 0.
- **Time and order.** Three notions are kept separate:
  - **financial time:** `submittedAt` for orders, `executedAt` for fills (the quote's market time, never before submission), `occurredAt` for cash entries. Every calculation uses these;
  - **sequence:** each order, execution and cash entry has a per-portfolio `sequence` (1, 2, …). It is assigned under the portfolio row lock, unique per portfolio, and never reused. It orders events that share the same financial time, for example several fills under a frozen or coarse market clock;
  - **recording time:** `recordedAt` and `createdAt` are the database write time. They are kept for audit only and no ordering or calculation uses them.
- **History order:** every list and calculation sorts by financial time, then `sequence`. Resting orders are matched by (`submittedAt`, `sequence`), which is first-come, first-served even within one millisecond. The order is therefore fully deterministic and independent of write timing. Responses include `sequence` on orders, executions and cash entries.

## 5. Endpoints

All endpoints require a bearer access token. Rate limit: 240 requests per minute per client.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/market/status` | Provider, provenance, server time, current quote period, data start |
| GET | `/api/market/instruments?q=&assetClass=` | Instruments with current quote, previous close and change |
| GET | `/api/market/instruments/:symbol` | One instrument with quote |
| GET | `/api/market/instruments/:symbol/history?range=1D\|5D\|1M\|3M\|6M\|ALL` | Mid-price history |
| GET | `/api/market/watchlist` | The user's watchlist |
| PUT | `/api/market/watchlist/:symbol` | Add to watchlist (idempotent) |
| DELETE | `/api/market/watchlist/:symbol` | Remove from watchlist (idempotent) |
| GET | `/api/portfolios` | The user's portfolios with summaries |
| POST | `/api/portfolios` | Create (`name`, `initialCapital`, optional `maxPositionWeightPct`) |
| GET | `/api/portfolios/:id` | Summary: cash, reserved, available, positions, equity, profit, P&L, fees |
| POST | `/api/portfolios/:id/cash-flows` | Deposit or withdraw (`type`, `amount`, `expectedVersion`) |
| GET | `/api/portfolios/:id/cash-entries` | Cash ledger |
| POST | `/api/portfolios/:id/orders/preview` | Server evaluation without side effects (200) |
| POST | `/api/portfolios/:id/orders` | Submit (`clientOrderId`, `expectedVersion`, `quoteAsOf` + terms) (201) |
| GET | `/api/portfolios/:id/orders?status=open\|closed\|all&limit=` | Orders |
| GET | `/api/portfolios/:id/orders/:orderId` | One order with its executions |
| POST | `/api/portfolios/:id/orders/:orderId/cancel` | Cancel a working order (200) |
| GET | `/api/portfolios/:id/executions?limit=` | Trades |
| GET | `/api/portfolios/:id/analytics` | Valuation, reconciliation, allocation, concentration, performance, risk, stress |
| GET | `/api/portfolios/:id/history` | End-of-day equity and net contributions, plus the current point |

Errors use the platform's standard shape: `{ statusCode, message, errorCode, details? }`. Trading-specific codes: `PORTFOLIO_NOT_FOUND`, `PORTFOLIO_LIMIT`, `PORTFOLIO_NAME_TAKEN`, `PORTFOLIO_CHANGED`, `QUOTE_CHANGED`, `IDEMPOTENCY_KEY_REUSED`, `DUPLICATE_SUBMISSION`, `ORDER_NOT_FOUND`, `ORDER_NOT_OPEN`, `INSTRUMENT_NOT_FOUND`, `CONTRIBUTION_LIMIT`, `INSUFFICIENT_CASH`, `DATABASE_SCHEMA_OUTDATED`. Rejection codes inside an order: `INSTRUMENT_HALTED`, `INVALID_QUANTITY`, `PRICE_REQUIRED`, `LIMIT_OUT_OF_BAND`, `STOP_BUY_UNSUPPORTED`, `STOP_NOT_BELOW_BID`, `INSUFFICIENT_POSITION`, `INSUFFICIENT_CASH`, `POSITION_LIMIT`, `NO_LIQUIDITY`, `TOO_MANY_OPEN_ORDERS`.

## 6. Valuation, performance and risk: definitions and assumptions

A metric that cannot be computed is returned as `{ value: null, unavailableReason, requirement }` and shown as "Not available: …". It is **never shown as zero**.

| Metric | Definition | Data needed / assumption |
| --- | --- | --- |
| Equity | cash + Σ units × mid | Mid marking; spreads are not deducted |
| Liquidation value | cash + Σ (units × bid − commission) | What selling everything now would raise |
| Profit | equity − net contributions | An amount, **not** a return. Deposits are not profit |
| Reconciliation | equity − net contributions = realized + unrealized P&L, difference must be 0.000 | Buy commissions are in cost basis; sell commissions reduce proceeds. Cash must equal the ledger sum |
| Time-weighted return | Chain of sub-period returns between external flows: Π (Vᵢ / (Vᵢ₋₁ + Fᵢ₋₁)) − 1 | Valuation snapshots at creation and at every deposit or withdrawal. Since creation, not annualised |
| Money-weighted return | Modified Dietz: (V₁ − V₀ − ΣF) / (V₀ + Σ wᵢFᵢ), wᵢ = share of the period remaining after the flow | Dates and amounts of every flow. Since creation, not annualised |
| Daily equity series | Rebuilt from the cash ledger and executions, marked at each 00:00 UTC daily close | Flows are counted at the end of their day |
| Historical VaR / ES (95 %, 1 day) | Loss quantile and mean loss beyond it, from re-pricing current holdings with each of up to 250 past daily instrument returns | At least 30 daily returns; assumes current holdings are held fixed |
| Holdings volatility (daily) | Standard deviation of the simulated daily P&L of current holdings ÷ equity | Same window as VaR |
| Realized volatility | Sample standard deviation of the portfolio's own daily returns (flows removed); annualised × √365 | At least 5 complete days. The simulated market trades every day, hence 365 |
| Maximum drawdown | Largest peak-to-trough fall of the time-weighted index | At least one revaluation after creation |
| Concentration | Largest weight, invested share, HHI of invested weights, effective holdings = 1 / HHI | HHI is unavailable when nothing is invested |
| Stress tests | Instant shocks to current holdings: broad equity crash, banking shock, rate rise, technology sell-off | **Hypothetical teaching scenarios, not forecasts**; no second-order effects |

**Not implemented:** benchmark-relative return, beta, parametric VaR, risk contributions and VaR backtesting. These need a benchmark series and a covariance model that are not yet specified.

## 7. Tests

| Suite | What it proves | Result (9 Nov 2026) |
| --- | --- | --- |
| `finance/*.spec.ts` | Core maths including TWR (deposit and withdrawal examples computed by hand) | Pass |
| `market-data/simulated-provider.spec.ts` | Exact epoch quote, determinism, period holding, history ranges | 8 pass |
| `trading/engine.spec.ts` | Hand-computed buy/sell/fees/realized P&L/reconciliation, preview = fill, depth, cash reservation, band, stop, position limit, halted, stop-cancels-take-profit, resting fill, expiry | 11 pass |
| `trading/analytics.spec.ts` | Reconstruction, Modified Dietz, reconciliation, liquidation, VaR availability and value, stress | 6 pass |
| `test/trading.e2e-spec.ts` (on `PIF_test`) | Auth, market, watchlist, buy/sell with reconciliation, rejections and validation, idempotency, stale version and quote, concurrency, double click, cross-user isolation, lazy stop trigger, deposits/withdrawals/TWR/history | 9 pass |
| `web: OrderTicket.test.tsx`, `ticketDraft.test.ts` | Ticket validation; preview → confirm sends version, quote time and one order reference; rejection blocks confirm; quote change re-previews with the same reference | 10 pass |
| `scripts/e2e/trading-journey.mjs` (browser, Edge) | Full user journey at 1440/768/375 px with screenshots in `docs/trading/screenshots/` | 50/50 checks |
