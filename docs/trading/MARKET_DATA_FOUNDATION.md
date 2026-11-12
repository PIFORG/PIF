# Market data foundation (PIF)

**Status:** production-quality fictional foundation in Spring Boot; paid/live feeds not configured.  
**Provider:** `SimulatedMarketProvider` (`pif-simulated-v1`) · provenance kind **`FICTIONAL`**.  
**Never present these prices as real exchange data.**

## Capabilities

| Capability | Status |
| --- | --- |
| Historical price observations (daily closes, intraday buckets) | Implemented |
| Reliable timestamps (UTC, 5-minute quote periods) | Implemented |
| Instrument identifiers (symbol + DB UUID) | Implemented |
| Asset classes | `EQUITY`, `FUND` live. Provider also prices `TNDB`/`OILX`/`EURT`. Enum+seed migration `20261112090000_asset_classes_extension` is ready for **`PIF_test` only** until main `PIF` approval |
| Quote currency | Per instrument (`TND`) |
| Source provenance | On every quote/history/status/analytics payload |
| Data quality validation | Non-finite samples refused in risk VaR; quote periods continuous |
| Missing observations | Pre-epoch returns null; incomplete windows → metric unavailable (not zero) |
| Corporate actions | Not modelled (fictional names); documented limitation |
| Fictional vs historical vs delayed vs live | Only **FICTIONAL** simulated; no delayed/live adapters yet |

## Asset-class conventions (do not treat as identical)

| Class | Current coverage | Pricing / trading convention in the simulator |
| --- | --- | --- |
| Equities | CTB, MDX, OLV, SFX, TEK, ATL | Mid mark-to-market; bid/ask spread; equity fee schedule |
| Bonds | GOV as `FUND` fixed-income proxy | Lower vol/beta; fund fee schedule; not dirty/clean price or accrued interest |
| Commodities | Not seeded pending enum migration | Planned: continuous-return synthetic future-style mid |
| FX | Not seeded pending enum migration | Planned: quote currency pairs in TND terms; no overnight interest |

## Architecture

```
MarketController → MarketService → SimulatedMarketProvider
                                 ↘ TradingRepository (instruments master)
PortfoliosService (analytics/history) → same provider for return windows
Backtest / TA (next) → dailyCloses from provider only
```

Adapters stay behind a coherent domain model (`MarketQuote`, `PricePoint`, `Provenance`). A future live/delayed adapter must set provenance `kind` accordingly and never share the fictional seed.

## Determinism

Prices are pure functions of `(seedPrefix, symbol, period)`. Caches are memoization only. Golden fixtures in `trading-golden.json` lock bit-level parity with the former Nest provider.

## Isolation

Development and integration tests use **`PIF_test`** (see `tools/db-harness` / `docs/trading/database-migration.md`). Do not write schema changes to main `PIF` without explicit approval.
