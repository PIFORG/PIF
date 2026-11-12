# Official requirements traceability matrix

**Document:** `PIF_Cahier_des_Charges_2026-2027.pdf` (Équipe PIF, 2026–2027)  
**Extracted:** 2026-11-12 from full PDF text (7 pages).  
**Stack:** Spring Boot `apps/api` · Angular `apps/web` · PostgreSQL  

**Class:** MANDATORY = “devra / permettre / intégrer” as a required capability · ILLUSTRATIVE = “exemple” · OPTIONAL = “pourra” / recommended annex · TEAM = our enhancement (not mandated)

**Status:** IMPLEMENTED · PARTIAL · PREVIEW · MISSING · BLOCKED_DATA · BLOCKED_DEP

| ID | § | Requirement (intent) | Class | Status | Backend | Frontend | DB | Tests | Missing / next | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O1 | 1 | Trading-room simulator for novices and professionals | MANDATORY | PARTIAL | Spring API | Angular workspace | PIF schema | Journeys | AI/bank modules incomplete | — |
| O2 | 1 | Simulate financial ops; analyse markets; virtual portfolios; evaluate investment risk | MANDATORY | PARTIAL | trading, market, analytics | desk, portfolios, markets | instruments, portfolios… | 38/38 trading | Dedicated Risk Studio (in progress) | P1 |
| O3 | 1 | Integrate AI for analysis, prediction, decision support | MANDATORY | MISSING | — | `/ai` preview | — | — | Models + data | Later |
| O4 | 2 | Interactive pedagogical experience | MANDATORY | IMPLEMENTED | learning | MarketQuest, stories | learning_* | 12/12 | Contests/quizzes still missing | — |
| O5 | 2 | Practice equities, bonds, commodities, FX | MANDATORY | PARTIAL | fictional universe by asset class | desk | instruments | trading | Real/delayed feeds need approval | P1 |
| O6 | 2 | Real-time market info: quotes, charts, news | MANDATORY | PARTIAL | quotes + history | markets/charts | instruments | trading | News feed missing; quotes are **fictional simulated** (labelled) | P1 |
| O7 | 2 | Build and manage virtual portfolio | MANDATORY | IMPLEMENTED | portfolios API | `/portfolios` | trading_* | 38/38 | Benchmarks optional | — |
| O8 | 2 | Technical and fundamental analysis tools | MANDATORY | PREVIEW | history API | charts only | — | — | TA indicators; FA data absent | P2 |
| O9 | 2 | Risk evaluation before and after transactions | MANDATORY | PARTIAL | analytics + `POST …/risk/pretrade` + order preview | `/risk` Studio + desk preview | — | RiskStudioTest + page specs | After-trade VaR recompute still optional | P0 |
| O10 | 2 | AI analyses, predictions, recommendations | MANDATORY | MISSING | — | preview | — | — | No fake AI | Later |
| O11 | 2 | AI bank stress testing | MANDATORY | MISSING | — | `/stress-testing` preview | — | — | Bank BS model | Later |
| O12 | 2 | Stress both conventional and non-conventional banks | MANDATORY | MISSING | — | preview | — | — | Same | Later |
| O13 | 2 | XAI for AI interpretability | MANDATORY | MISSING | — | `/explainability` preview | — | — | Needs O10/O11 | Later |
| O14 | 3.1 | Friendly UI; personal dashboard; portfolio tracking; open/closed positions; performance; real-time economic info; charts; risk/performance indicators; AI results area | MANDATORY | PARTIAL | many | dashboard, desk, portfolios | — | journeys | News; AI results area; Risk Studio | P0–P1 |
| O15 | 3.2 Ops | Buy/sell; order execution simulation; positions; portfolio; trade history | MANDATORY | IMPLEMENTED | trading | desk/portfolios | trading_* | 38/38 | — | — |
| O16 | 3.2 Risk | Risk logic before each trade; risk indicators for position/portfolio; portfolio risk mgmt (e.g. stop-loss, take-profit, exposure, diversification) | MANDATORY | PARTIAL | Engine + Risk.java + analytics + RiskStudio; stops/limits | `/risk` LIVE + desk | — | FinanceGolden + RiskStudioTest | Contests/bank stress still later; Risk Studio vertical slice live | P0 |
| O17 | 3.2 Analysis | Technical & fundamental tools | MANDATORY | PARTIAL | `GET …/indicators` (SMA/EMA/RSI/MACD/BB) | markets charts; overlay UI pending | — | TechnicalIndicatorsTest | FA statements absent (by design) | P2 |
| O18 | 3.2 Analysis | Historical data for retrospective analysis / backtesting | MANDATORY | PARTIAL | simulated daily/intraday + backtest ingest | markets + `/backtesting` | provider | BacktestEngineTest | Persistible OHLC store optional | P1 |
| O19 | 3.2 Analysis | Test investment strategies; compare strategy performance | MANDATORY | PARTIAL | `POST /backtests/run` (3 baselines + benchmark) | `/backtesting` LIVE | — | BacktestEngineTest | Strategy lab `/strategies` still preview; OOS workflow UX | P1 |
| O20 | 3.3 | Interactive training modules; asset explanations; practical exercises; advanced strategy sims; market scenarios; contests; progress indicators; quizzes | MANDATORY | PARTIAL | 10 missions + stories + Time Machine | learn/stories | learning_* | 12/12 | Contests & quizzes | Later |
| O21 | 3.4.1 | Market prediction; auto recommendations; trend/anomaly detection; ML on asset risk/performance | MANDATORY | MISSING | — | preview | — | — | No fake AI | Later |
| O22 | 3.4.2 | Intelligent trading agent; analyse history/market; propose strategies; user can review decisions | MANDATORY | MISSING | — | preview | — | — | — | Later |
| O23 | 3.4.3 | Sentiment analysis from financial news into prediction/decision | MANDATORY | MISSING | — | preview | — | — | News corpus | Later |
| O24 | 3.5 | Define/generate adverse scenarios (rates, markets, unemployment, recession, defaults, AQR, income shocks, multi-factor) | MANDATORY | MISSING | Portfolio stress ≠ bank stress | preview | — | — | Bank module | Later |
| O25 | 3.5.2 | Conventional vs non-conventional banks comparative stress | MANDATORY | MISSING | — | — | — | — | — | Later |
| O26 | 3.5.3 | ML/DL for indicators, drivers, losses, vulnerability, resilience, scenario compare | OPTIONAL (“pourra”) | MISSING | — | — | — | — | — | Later |
| O27 | 3.5.4 | Present stress results: dashboards, charts, risk indicators, before/after, scenario & bank compares | MANDATORY | MISSING | — | preview | — | — | — | Later |
| O28 | 3.6 | Identify drivers of predictions/risk; local/global explanations; stress explanations; visualise importance | MANDATORY | MISSING | — | preview | — | — | Depends on AI | Later |
| O29 | 3.7 | Predictive premium models by insured/risk features | MANDATORY | PARTIAL | pricing studio | actuarial pricing | actuarial_* | 8/8 actuarial | Insured-feature ML models | Later |
| O30 | 3.7 | Premium margins (premiums vs expected claims) | MANDATORY | IMPLEMENTED | pricing | pricing UI | — | actuarial | — | — |
| O31 | 3.7 | Claim occurrence probability models | MANDATORY | IMPLEMENTED | frequency models | actuarial | — | actuarial | — | — |
| O32 | 3.7 | Claim severity / reserving (indemnities / provisions) | MANDATORY | IMPLEMENTED | severity + reserving studio | reserving UI | — | actuarial | Economic capital / ALM = TEAM enhancement | Later |
| O33 | 4 | Secure auth; roles; encrypt sensitive data; protect financial & user data; secure feature access; trace important ops | MANDATORY | IMPLEMENTED | auth, MFA, audit | settings/admin | users, audit | 19/19 auth | Trading→audit_events optional | — |
| O34 | 5 | Admin: users/permissions; market & news data; training content; AI data; stress scenarios; sim params; AI models; sim results; user performance; market scenarios; platform stats & supervision | MANDATORY | PARTIAL | admin users/audit | admin UI | — | admin journeys | Market/news/AI/stress admin | Later |
| A1 | Annex | Study listed online simulators | OPTIONAL | — | — | — | — | — | Guidance only | — |

## Provenance rules (engineering policy, aligns with O6/O18)

Fictional/simulated series must be labelled (`FICTIONAL` / provider id). Never present as live exchange data. Paid providers require approval.
