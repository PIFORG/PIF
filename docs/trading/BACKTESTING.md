# Historical backtesting (v1)

Synchronous strategy replay on **fictional** daily closes from `SimulatedMarketProvider`. No job queue, no database writes, no Flyway changes.

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/backtests/run` | Required | Body: strategy, symbols[], start, end, params, initialCash, feeBps, slippageBps. Returns equity curve, drawdown, metrics, trades, assumptions, FICTIONAL provenance. |
| `GET` | `/api/market/instruments/{symbol}/indicators` | Same as market | Query: `range`, `kinds=SMA,EMA,RSI,MACD,BB`. Warm-up values are null. |

## Execution convention: NEXT_CLOSE

After bar `t` closes, the strategy emits a target using only data through `t`. That target fills at the **close of bar `t+1`**. No same-bar fill, no look-ahead.

## Strategies

- `BUY_AND_HOLD` - equal weight on selected symbols
- `MA_CROSSOVER` - long first symbol when SMA(short) > SMA(long); else cash (`shortPeriod`, `longPeriod`)
- `PERIODIC_REBALANCE` - equal weight every `rebalanceEvery` bars (default 21); hold between rebalances

## Costs and sizing

- Buy fill = mid * (1 + slippageBps/10000); sell fill = mid * (1 - slippageBps/10000)
- Fee = notional * feeBps / 10000 (no minimum in v1)
- Fractional shares allowed; no lot size or depth limits

## Annualization

- Total return = endEquity / initialCash - 1
- Annualized return = (1+R)^(365/nDays) - 1 where nDays is calendar span of the equity curve (min 1)
- Volatility and Sharpe scale daily sample stats by sqrt(365)
- Sharpe excess vs 0 risk-free unless `params.riskFreeAnnual` is set (daily RF = annual/365)
- Single-symbol runs also report buy-and-hold benchmark return on the same close series

## Known limitations

- Daily bars only (provider daily closes); no intraday fills
- MA crossover trades only `symbols[0]`
- No dividends, borrowing, overnight financing, or persistence of runs
- Prices are deterministic FICTIONAL series, not a real market

## Tests

```text
cd apps/api
set JAVA_HOME=..\..\.tools\jdk-25.0.5+8
mvnw.cmd -q "-Dtest=TechnicalIndicatorsTest,BacktestEngineTest" test
```

Angular: `apps/web` `npx ng test` (includes `backtesting.page.spec.ts`).
