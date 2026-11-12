# PIF scope gap analysis — PROVISIONAL

**Provisional.** The official *cahier des charges* is **not** in this repository. Requirement references remain the section summaries in [`docs/master-prompt.md`](../master-prompt.md). Re-check against the official document before planning or grading.

**Stack update (12 Nov 2026):** active code is Spring Boot (`apps/api`) + Angular (`apps/web`). Migration completeness ≠ academic completeness.

## 1. Summary

| Domain (spec ref.) | Status | Evidence |
| --- | --- | --- |
| Users, roles, authentication, admin, audit (§1–2, §4, §5) | **Implemented and tested** | Spring auth/admin; Angular settings/admin; identity journeys |
| Interactive learning: MarketQuest, FinStories, Financial Time Machine (§3.3) | **Implemented and tested** | 10 playable missions (6 IMPLEMENTED + 4 CONFIGURED); FinStories; Time Machine — see [`docs/migration/MARKETQUEST_MISSION_STATUS.md`](../migration/MARKETQUEST_MISSION_STATUS.md) |
| General virtual trading (§3.2) | **Implemented and tested** on simulated fictional data | Spring trading + Angular desk; journey 38/38 |
| Portfolio management (§3.1–3.2) | **Implemented and tested**; no benchmark or rebalancing UI productisation | Portfolios, cash, TWR/Dietz analytics; `/portfolios` |
| Risk analysis (§3.1) | **Partial**: portfolio analytics live; dedicated Risk Studio incomplete | `GET /api/portfolios/:id/analytics`; `/risk` = ModulePreview |
| Technical and fundamental analysis | **Not implemented** | Preview only |
| Backtesting | **Not implemented** | `/strategies` preview |
| AI trading recommendations (§3.4) | **Not implemented** | Rule-based mentor only (labelled) |
| Financial prediction and sentiment analysis (§3.4) | **Not implemented** | Preview only |
| Banking AI stress testing (§3.5) | **Not implemented** | Portfolio shocks ≠ bank stress; `/stress-testing` preview |
| Explainable AI (§3.6) | **Not implemented** | Blocked on models |
| Actuarial modelling (§3.7) | **Partial → strong**: pricing, Monte Carlo, reserving implemented on Spring/Angular; capital & ALM still missing | Actuarial journey 8/8; differentials 151/151 |
| Competitions and quizzes (§3.3) | **Not implemented** | `/challenges` preview |

## 2. Domain by domain

Each domain has its own financial responsibility and mathematics. **One generic trading engine cannot implement them all.** The shared core covers order execution, booking, valuation, pre-trade checks and portfolio market risk. Everything else needs its own model and its own validated data.

### 2.1 General virtual trading
- **Responsibility:** user-owned virtual accounts trading real-world (delayed or historical) instruments; order lifecycle (new, partially filled, filled, cancelled, expired); trade history.
- **Model:** order matching against a quote feed; price-time priority, if an internal book is wanted.
- **Reuses from the core:** `execution`, `ledger`, `pretrade`, `money`.
- **Missing:**
  - instrument master and a licensed market-data source (none is configured, and adding a paid provider needs approval);
  - `Portfolio`, `Order`, `Trade`, `CashMovement` tables and their migration;
  - an order service with idempotency, which can follow the learning command pattern;
  - market-hours and calendar rules;
  - the API and wiring of the existing `/trading` layout.

### 2.2 Portfolio management
- **Responsibility:** several portfolios per user, deposits and withdrawals, performance, allocation and rebalancing.
- **Model:** time-weighted return (chain-linked between cash flows), money-weighted return (IRR), benchmark-relative return, drift-based rebalancing.
- **Reuses from the core:** `valuation`, `ledger`.
- **Missing:**
  - cash-flow ledger;
  - TWR/MWR calculations;
  - benchmark series;
  - snapshot storage for history;
  - API and UI wiring.

### 2.3 Risk analysis
- **Responsibility:** portfolio risk with history long enough to be meaningful.
- **Model:**
  - historical VaR/ES, which exists in the core;
  - parametric (variance–covariance) VaR, which needs a covariance matrix;
  - beta against a benchmark;
  - marginal and component risk contributions;
  - VaR backtesting (Kupiec proportion-of-failures test).
- **Reuses from the core:** `risk`, `valuation`.
- **Missing:**
  - return history per instrument;
  - covariance estimation (sample or EWMA, with shrinkage);
  - risk contributions;
  - VaR backtesting;
  - a risk service and API.

### 2.4 Technical and fundamental analysis
- **Responsibility:** indicators over prices; ratios over company accounts.
- **Model:**
  - technical: SMA/EMA, RSI, MACD, Bollinger bands over OHLCV bars;
  - fundamental: valuation and quality ratios (P/E, P/B, ROE, debt/equity) from financial statements.
- **Reuses from the core:** nothing beyond `money`. This is a separate analytics module.
- **Missing:**
  - OHLCV and financial-statement data sources;
  - an indicator library with reference-value tests;
  - API and UI.

### 2.5 Backtesting
- **Responsibility:** replay a strategy over history without look-ahead, with realistic costs.
- **Model:**
  - event-driven simulation;
  - performance statistics: CAGR, volatility, Sharpe and Sortino ratios, maximum drawdown, turnover;
  - walk-forward or out-of-sample validation.
- **Reuses from the core:** `execution`, `ledger`, `pretrade`, `risk`. The deterministic command-log and replay pattern of the learning engine can also be reused.
- **Missing:**
  - historical data;
  - a strategy definition format and sandboxed execution;
  - look-ahead guards;
  - performance statistics;
  - persistence of runs;
  - API and UI.

### 2.6 AI trading recommendations
- **Responsibility:** model-generated suggestions with provenance, shown as advice, never executed automatically.
- **Model:** a supervised or rule-plus-ML model trained on labelled features, validated out of sample, with a model registry and versioning.
- **Reuses from the core:** `pretrade`, to check that a suggested order is feasible. No financial result may be produced by an unconstrained language model.
- **Missing:**
  - training data;
  - feature pipeline;
  - model, evaluation and monitoring;
  - provider decision (needs approval);
  - provenance storage;
  - UI labelling.

### 2.7 Financial prediction and sentiment analysis
- **Responsibility:** forecasts and news sentiment, each with measured error.
- **Model:**
  - time-series forecasting, judged by MAE/RMSE and directional accuracy against a naive baseline;
  - NLP sentiment classification, judged by precision and recall on a labelled set.
- **Reuses from the core:** nothing.
- **Missing:** data, models, evaluation datasets, provider decision, API and UI.

### 2.8 Banking AI stress testing
- **Responsibility:** the resilience of a bank's balance sheet under macro scenarios. This is not a trading portfolio shock.
- **Model:**
  - credit risk: PD, LGD and EAD, with expected loss = PD × LGD × EAD;
  - satellite models linking macro variables to PD;
  - risk-weighted assets and capital ratios such as CET1;
  - liquidity ratios (LCR, NSFR);
  - multi-period projection.
- **Reuses from the core:** only `scenarioPnl`/`stressImpact`, for the trading-book part.
- **Missing:**
  - a bank balance-sheet data model;
  - credit and capital models;
  - scenario definitions;
  - the regulatory parameterisation (to be taken from the official specification);
  - API and UI.

### 2.9 Explainable AI
- **Responsibility:** explain the outputs of the AI models in 2.6 and 2.7.
- **Model:** feature attribution (SHAP values, permutation importance), local surrogates, counterfactuals.
- **Reuses from the core:** nothing. It depends entirely on the models existing first.
- **Missing:** everything. It is blocked by 2.6 and 2.7.

### 2.10 Actuarial modelling

**Update (9 Nov 2026).** The team chose a **non-life** scope: the Actuarial Risk & Solvency Lab. Portfolio-loss insurance was explicitly rejected by the supervisor and is not built. The life and pension model originally sketched here is not planned. See [`docs/actuarial/`](../actuarial/README.md).

- **Responsibility:** the insurance liabilities of a fictional non-life insurer, and later the assets backing them.
- **Model:**
  - claim frequency (Binomial, Poisson) and severity (deterministic, gamma, lognormal);
  - aggregate loss (exact lattice, Panjer);
  - premium build-up with loadings, expenses and margin;
  - later: Monte Carlo, reserving, economic capital and ALM.
- **Reuses from the core:** `money` (rounding). The seeded generator will be reused for Monte Carlo.
- **Implemented:** Phase 1 (claims and pricing), with API, UI and reference-value tests.
- **Missing:** Phases 2–4.

## 3. Recommended order

1. **Virtual trading and portfolio management (2.1, 2.2).** These are the foundation the other market modules need. They reuse the core directly. The order and trade tables need an additive migration, behind the backup step in section 4.
2. **Risk analysis (2.3).** It extends `risk.ts` once real return history exists.
3. **Backtesting and technical analysis (2.5, 2.4).** These need a historical data decision first.
4. **AI recommendations, prediction and sentiment, then XAI (2.6, 2.7, 2.9).** These need data, a provider decision and an evaluation protocol.
5. **Banking stress testing and actuarial modelling (2.8, 2.10).** These are independent mathematical modules. They need their parameters from the official specification.

## 4. Database changes

**Update (9 Nov 2026):** the virtual-trading migration followed this procedure. Backups were taken and a restore was tested, and the migration was applied to `PIF_test`, then to `PIF` after approval (together with the actuarial migration). See [`docs/trading/database-migration.md`](../trading/database-migration.md). The text below describes the state before that phase.

No migration was applied in this phase. The repository documents no database backup or rollback procedure (`backups/` only holds a web source archive). Before the first migration for 2.1:
- take a `pg_dump -Fc` of the development database;
- test the restore into a scratch database;
- keep the migration additive;
- apply it to the `_test` database first.
