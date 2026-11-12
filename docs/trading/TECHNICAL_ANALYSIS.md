# Technical analysis indicators (v1)

Implemented in `com.pif.api.backtest.TechnicalIndicators` and exposed via:

`GET /api/market/instruments/{symbol}/indicators?range=3M&kinds=SMA,EMA,RSI,MACD,BB`

Values before warm-up are **null**. Index `i` uses only closes `0..i` (no look-ahead). Series align with the same mid points as history.

## Defaults on the overlay endpoint

| Kind | Default |
| --- | --- |
| SMA | period 20 |
| EMA | period 20, seeded with SMA of the first window, alpha = 2/(period+1) |
| RSI | Wilder period 14 |
| MACD | 12 / 26 / 9 |
| BB | period 20, k = 2, sample std-dev (n-1) |

## Notes

- Fundamental analysis (statements, ratios) is **not** implemented.
- Backtests call the same indicator helpers for MA crossover signals.
- Provenance on the response is always FICTIONAL for the simulated provider.
