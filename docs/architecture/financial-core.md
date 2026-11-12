# Shared financial core

`apps/api/src/finance/` holds the financial calculations that more than one PIF module needs: order execution, transaction validation, booking, valuation, P&L and portfolio risk. It is plain TypeScript with no NestJS, Prisma, clock, randomness or mission concepts, so any service can call it and every function can be tested with hand-computed values.

Status: **first vertical slice, in production use by the learning engine.** No other module uses it yet, because no other financial module has a backend yet (see [`pif-scope-gap-analysis.md`](./pif-scope-gap-analysis.md)).

## 1. Modules and responsibilities

| Module | Responsibility | Main functions |
| --- | --- | --- |
| `money.ts` | Integer amounts in thousandths of the currency unit (millimes for TND), half-away-from-zero rounding, ratio, commission `max(minFee, notional × bps / 10,000)` | `toAmount`, `fromAmount`, `notional`, `divRound`, `commission`, `ratio` |
| `execution.ts` | Price at which an order executes against a top-of-book quote, and when resting orders trigger | `executionPrice` (buy at ask, sell at bid), `limitCrosses`, `limitIsMarketable`, `sellStopTriggered`, `remainingDepth`, `spreadCost` |
| `ledger.ts` | Booking executions with average cost. A buy adds value and fee to the cost basis. A sell removes the proportional cost basis and realises proceeds − fee − cost removed. Throws `LedgerError` on a non-positive quantity or price, insufficient cash or an insufficient position, so a ledger can never go negative | `bookExecution`, `heldQuantity` |
| `valuation.ts` | Market value per position, total, equity, largest weight, gross exposure, Herfindahl index and effective number of assets, unrealised P&L | `marketValues`, `totalValue`, `equityOf`, `maxWeight`, `exposure`, `concentration`, `unrealizedPnl` |
| `risk.ts` | Maximum drawdown, sample standard deviation, simple returns, historical VaR and expected shortfall (only from 30 observations; volatility from 5 returns), scenario P&L and stress impact per position | `maxDrawdown`, `sampleStdDev`, `simpleReturns`, `historicalVaR`, `scenarioPnl`, `stressImpact` |
| `pretrade.ts` | Estimate of an order's cash effect, and the checks run before booking: position held for sells; cash net of open buy reservations for buys; post-trade weight at mid, including pending buys, against a position limit | `estimateOrder`, `checkOrder`, `reservedCash` |

**Accounting identity.** With these rules, at every point `equity − initial equity = realised P&L + unrealised P&L`. The learning playthrough tests assert this exactly (to the millime) at every step of all ten playable missions.

## 2. What the learning engine delegates

`apps/api/src/learning/engine/` keeps everything that is specific to teaching: the seeded market path, scripted events, missions, objectives, the assessment and the mentor. It calls the core for the rest:
- **Execution:** `simulator.execute` uses `remainingDepth`, `executionPrice`, `commission` and `bookExecution`. `advance` uses `sellStopTriggered` and `limitCrosses`.
- **Validation:** `checkPlaceOrder` uses `checkOrder` and `reservedCash` for both placing and previewing an order, so the two cannot disagree.
- **Valuation:** `snapshot` uses `maxWeight` and `exposure`.
- **Risk:** `computeMetrics` uses `totalValue`, `scenarioPnl`, `concentration` and `unrealizedPnl`, plus the core drawdown, volatility and VaR functions. `runStressTest` uses `stressImpact`.
- **Names:** `engine/money.ts` re-exports the core under the learning names (`Millimes`, `toMillimes`), so mission code did not change.

The web order ticket no longer computes fees, cash or limits itself. It validates the form only (`ticket.ts`) and asks `POST /api/learning/sessions/:id/orders/preview` for the estimate, the refusal reason and the warnings. Responses for an outdated session state or order are discarded.

## 3. How behaviour was preserved

1. **Golden master.** Before the extraction, `engine/golden.spec.ts` recorded a SHA-256 digest of the full state, metrics, objectives and refused commands for three scripted strategies on each of the 10 missions. The strategies cover market, limit, stop and marketable orders, partial fills, cancellation, a stress test, a hint, rejections (cash, position, limit, unknown symbol, buy stop) and an early finish. All 30 snapshots still match after the refactor.
2. **Hand-computed core tests.** `finance/finance.spec.ts` checks the core against arithmetic done by hand (18 tests): commission rounding, average cost across two buys and a partial sell, invariant errors, HHI, drawdown, VaR/ES, stress breakdown, the exact cash boundary of a buy, and the position-limit weight.
3. **Preview parity.** `engine/preview.spec.ts` generates more than 100 orders across all missions and checks that the preview returns the same acceptance, code and message as placing the order, without changing the state.

## 4. Reuse rules for new modules

- Put a calculation in `finance/` only if it is market-agnostic and needed by more than one module. Domain models stay in their module. Examples: the instrument master, order lifecycle, strategy logic, credit models and life tables.
- Amounts stay integer thousandths at the core boundary. Convert at the API edge with `fromAmount`.
- Functions are pure, or mutate only the ledger they are given (`bookExecution`). No I/O, clock or randomness. Callers own persistence and time.
- Every new function needs a hand-computed test. A refactor of a caller needs a golden master first.

## 5. Not in the core (deliberately)

The core does not cover the following:
- market impact beyond displayed depth, or intraday order books;
- short selling, margin, dividends, corporate actions or taxes;
- FX conversion (one currency per ledger);
- covariance-based or parametric VaR, and Monte Carlo;
- performance attribution, time-weighted or money-weighted returns;
- credit, liquidity or actuarial mathematics.

These belong to the modules listed in the gap analysis, and will be added when a module with a real data source needs them.
