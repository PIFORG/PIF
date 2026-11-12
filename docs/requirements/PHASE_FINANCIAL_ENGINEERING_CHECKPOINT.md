# Checkpoint — Financial engineering phase (2026-11-12)

**Git HEAD (rollback reference):** `a5332c9b17daef8359f29a20a9de80d240ee0584` (`docs/requirements/ROLLBACK_CHECKPOINT.txt`)  
**Commit policy:** no automatic commit (working tree still contains the Spring/Angular migration + this phase).  
**Main `PIF` DB:** not altered. Asset-class enum extension lives in `tools/db-harness/.../20261112090000_asset_classes_extension` for **`PIF_test` / approval only**.

## Delivered this phase

### 1. Official requirements baseline
- `REQUIREMENTS_SUMMARY.md`
- `REQUIREMENTS_TRACEABILITY_MATRIX.md` (cahier PDF as source of truth)

### 2. Market-data foundation
- Documented in `docs/trading/MARKET_DATA_FOUNDATION.md`
- `GET /market/status` enriched with quality, data kinds, asset-class conventions
- Provider symbols for BOND/COMMODITY/FX proxies (`TNDB`, `OILX`, `EURT`) in `FictionalUniverse` (DB seed pending approval)

### 3. Risk Analytics Studio (vertical slice)
- Live `/risk` (not ModulePreview)
- Server enrichment: methodology, risk contributions, diversification (without breaking analytics golden masters)
- `POST /portfolios/{id}/risk/pretrade` — current vs proposed exposure/cash/weights/limits
- Angular: allocation, contributions, stress, drawdown chart, pre-trade form, methodology from API
- Unit: `RiskStudioTest` green

### 4. Backtesting + technical indicators (first slice)
- `POST /backtests/run` — buy & hold, MA crossover, periodic rebalance; next-open convention; fees/slippage
- `GET /market/instruments/{symbol}/indicators` — SMA, EMA, RSI, MACD, Bollinger
- Angular `/backtesting` LIVE; nav updated; removed from preview routes
- Docs: `BACKTESTING.md`, `TECHNICAL_ANALYSIS.md`
- Unit: `TechnicalIndicatorsTest`, `BacktestEngineTest`, `RiskStudioTest` green

## Verified tests (local)
```
apps/api: mvnw -Dtest=RiskStudioTest,TechnicalIndicatorsTest,BacktestEngineTest  → PASS
apps/api: FinanceGoldenMasterTest included in earlier run → PASS (when bundled)
```

## Remaining / next high-impact
1. Apply asset-class migration on **`PIF_test`** only; seek approval for `PIF`.
2. Overlay TA series on Markets chart UI.
3. Browser e2e + screenshots for `/risk` and `/backtesting`.
4. Full regression journeys (trading, MarketQuest, FinStories, actuarial).
5. Roadmap domains (no fake AI): Financial AI, XAI, Banking stress, Actuarial capital/ALM.

## Limitations
- Quotes remain **FICTIONAL** simulated.
- Pre-trade risk does not recompute historical VaR for the proposed book.
- Backtest v1 is synchronous, non-persisted.
- Covariance parametric VaR not implemented (historical component ES only).
