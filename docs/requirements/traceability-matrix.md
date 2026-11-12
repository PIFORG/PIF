# PIF requirements traceability matrix — PROVISIONAL

**The official source is missing.** `docs/requirements/PIF_Cahier_des_Charges_2026-2027.pdf` is not in the repository (checked on 9 Nov 2026). The only requirement text available is the set of section summaries quoted in [`docs/master-prompt.md`](../master-prompt.md) (§1–§5, with page numbers). Those are summaries, **not** the official wording.

Every row below therefore traces back to a summary. Before this matrix is used for planning or grading:

- re-check each row against the PDF;
- correct any classification the PDF contradicts;
- add any requirement the summaries omit.

No mathematical model is listed as mandatory unless a summary names it.

**Classification:**

| Label | Meaning |
| --- | --- |
| MANDATORY | Stated in the specification summaries |
| OPTIONAL | Mentioned as a capability, without a requirement on how |
| ILLUSTRATIVE | An example of what a feature could contain |
| TEAM INNOVATION | Our design decision; not requested |

**Status:**

| Label | Meaning |
| --- | --- |
| IMPLEMENTED | Code, API and UI exist and are tested |
| PARTIAL | Some of it is implemented and tested; the gap is named |
| MISSING | Not implemented |

Evidence is checked in source and tests, not inferred from routes or pages.

## 1. Whole platform (PIF)

| # | Source (summary) | Requirement | Class | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P1 | §1–2 p.1 | Users from novices to professionals | MANDATORY | IMPLEMENTED | Registration with experience level, roles; `docs/identity-requirements-matrix.md` |
| P2 | §1–2 p.1; §3.1 pp.1–2 | Private virtual portfolios | MANDATORY | IMPLEMENTED | `trading/` module, `/portfolios`; [trading README](../trading/README.md) |
| P3 | §3.1 pp.1–2 | User-friendly interface, personal dashboard | MANDATORY | IMPLEMENTED | Workspace template, `/dashboard`; responsive at 375/768/1440 px (browser journeys) |
| P4 | §3.1 pp.1–2 | User-specific portfolios, positions, performance | MANDATORY | IMPLEMENTED | `GET /api/portfolios/:id`, `/analytics`, `/history`; `/portfolios` page |
| P5 | §3.1 pp.1–2 | Indicators | MANDATORY (the kind of indicator is not stated) | PARTIAL | Portfolio indicators exist: TWR, MWR, VaR/ES, volatility, drawdown, concentration. **No technical indicators** (SMA, RSI…); no market-data decision for them yet |
| P6 | §3.1 pp.1–2 | Simulation outputs | MANDATORY | IMPLEMENTED | Simulated market data with provenance; trading engine; stress tests; MarketQuest sessions |
| P7 | §3.1 pp.1–2 | AI outputs | MANDATORY | MISSING | No model. The learning mentor is rule-based and labelled as such |
| P8 | §3.2 p.2 | Portfolios owned and secured per user | MANDATORY | IMPLEMENTED | Owner-filtered row lock on every portfolio call; cross-user 404 tested in `trading.e2e-spec.ts` |
| P9 | §3.2 p.2 | Orders owned and secured per user | MANDATORY | IMPLEMENTED | Orders reachable only through an owned portfolio; tested |
| P10 | §3.2 p.2 | Transactions and histories per user | MANDATORY | IMPLEMENTED | Executions, cash ledger, order history, equity history endpoints and UI |
| P11 | §3.3 p.2 | Learning and progress per identified learner | MANDATORY | IMPLEMENTED | MarketQuest, Time Machine, FinStories; `docs/learning/` |
| P12 | §3.3 p.2 | Competitions | MANDATORY (format not stated) | MISSING | `/challenges` is a labelled preview |
| P13 | §3.3 p.2 | Quizzes | MANDATORY (format not stated) | MISSING | No quiz engine. Mission assessment is not a quiz |
| P14 | §3.4–3.7 pp.3–5 | AI analysis and trading agents | MANDATORY | MISSING | Needs data, model and provider decisions |
| P15 | §3.4–3.7 pp.3–5 | Bank stress testing | MANDATORY | MISSING | Portfolio stress tests are **not** bank stress tests (no balance sheet, PD/LGD, capital ratios) |
| P16 | §3.4–3.7 pp.3–5 | Explainable AI | MANDATORY | MISSING | Blocked by P14 |
| P17 | §3.4–3.7 pp.3–5 | Actuarial tools | MANDATORY | PARTIAL | Claims & Pricing Studio implemented and tested: frequency, severity, aggregate loss, premiums, margins, saved scenarios. Monte Carlo Lab implemented and tested on `PIF_test`: seeded simulation, VaR, TVaR and threshold probabilities with confidence intervals, comparison with the exact results, stored runs (migration applied to `PIF` with approval). Reserving Studio implemented and tested on `PIF_test`: paid and incurred chain ladder, expected loss ratio, Bornhuetter–Ferguson, case reserves, IBNR, unpaid, sensitivities, expected payments, stored runs (migration applied to `PIF` with approval). Economic capital and ALM are not implemented yet. Breakdown in [actuarial README §2](../actuarial/README.md#2-requirements-and-their-sources) |
| P18 | §3.4–3.7 pp.3–5 | Controlled access and auditable provenance for AI, stress, XAI, actuarial | MANDATORY | PARTIAL | Access control and audit log exist; market-data provenance is on every quote; every actuarial result carries `ESTIMATED`, `SIMULATED` or `MODEL_ESTIMATE` provenance and a model or engine version, simulations record their seed, reserving runs record a data checksum, and saved scenarios, simulation runs and reserving runs are owner-scoped. Nothing to trace yet for AI, stress and XAI |
| P19 | §1 (business context) | Historical strategies / backtesting | MANDATORY per the context paragraph | MISSING | `/strategies`, `/backtesting` previews; needs historical data |
| P20 | §4 p.5 | Secure authentication, roles, authorizations | MANDATORY | IMPLEMENTED | `docs/identity-*.md`; identity e2e |
| P21 | §4 p.5 | Protected user and financial data, access restrictions | MANDATORY | IMPLEMENTED | Guards on every trading endpoint; ownership checks; HttpOnly refresh cookie; no secrets in the client |
| P22 | §4 p.5 | Traceability of important actions | MANDATORY | PARTIAL | Audit log for identity and admin actions. Trading keeps a complete order, execution and cash ledger, but trading actions are not yet written to `audit_events` |
| P23 | §5 pp.5–6 | Administrators manage accounts, permissions, platform entities | MANDATORY | PARTIAL | Users and audit administration exist. **No admin screen for instruments** (halt or resume trading) |
| P24 | §5 pp.5–6 | Aggregate statistics and system health | MANDATORY | PARTIAL | Platform page with user statistics; no trading statistics yet |

## 2. Virtual trading and portfolios (this phase)

| # | Requirement | Class | Status | Evidence |
| --- | --- | --- | --- | --- |
| T1 | Instrument master | Necessary for P2/P9 | IMPLEMENTED | `instruments` table (7 fictional instruments), `GET /api/market/instruments` |
| T2 | Market data with provenance; no invented "live" prices | TEAM INNOVATION (provenance labelling) | IMPLEMENTED | `pif-simulated-v1`, `FICTIONAL`; shown on every trading screen |
| T3 | Licensed historical, delayed or live data | OPTIONAL | MISSING | Adapter interface exists; a provider needs approval and a licence |
| T4 | Buy and sell; market and limit orders | Necessary for P9 | IMPLEMENTED | Engine and e2e tests; browser journey |
| T5 | Stop-loss | ILLUSTRATIVE (common order type) | IMPLEMENTED | Sell stops; a buy stop is refused with a reason |
| T6 | Take-profit | ILLUSTRATIVE | IMPLEMENTED as a resting sell limit | Coexists with a stop; the other is cancelled when the position closes |
| T7 | Preview before placement; the preview matches the execution | TEAM INNOVATION | IMPLEMENTED | `preview` endpoint; engine test "preview = fill"; browser check on price and fee |
| T8 | Fees, rejected orders, statuses, partial fills | Necessary | IMPLEMENTED | Fee schedule; 11 rejection codes; lifecycle documented |
| T9 | Protection against duplicates, stale requests, concurrency, insufficient balance | Necessary for P8/P21 | IMPLEMENTED | Idempotency key, version, quote time, row lock, CHECK constraints; e2e tests |
| T10 | Deposits and withdrawals; profit vs. performance | Necessary for P4 | IMPLEMENTED | Cash flows; TWR and Modified Dietz; profit shown as an amount |
| T11 | Valuation, allocation, concentration, exposure | Necessary for P4 | IMPLEMENTED | `/analytics` |
| T12 | VaR, ES, volatility, drawdown | ILLUSTRATIVE of "risk evaluation" (business context) | IMPLEMENTED | Historical simulation with availability rules; never shown as zero when unavailable |
| T13 | Stress scenarios on portfolios | TEAM INNOVATION | IMPLEMENTED | Four hypothetical scenarios, labelled as such |
| T14 | Benchmark-relative return, beta, risk contributions, VaR backtesting | OPTIONAL | MISSING | Needs a benchmark and a covariance model |
| T15 | Market hours and holiday calendar | OPTIONAL | MISSING (design decision) | The simulated market trades 24/7; documented |
| T16 | Watchlist | ILLUSTRATIVE | IMPLEMENTED | `/api/market/watchlist`; Markets page and desk |
| T17 | Responsive UI inside the existing template | Necessary for P3 | IMPLEMENTED | Browser journeys at 1440/768/375 px with no horizontal overflow |
| T18 | Learning subsystem stays independent of user portfolios | TEAM INNOVATION | IMPLEMENTED | Missions keep their own sandbox on the shared core; 77-check learning journey still passes |

## 3. Learning subsystem (kept separate)

The learning subsystem covers MarketQuest, the Financial Time Machine, the Socratic Mentor and FinStories. It answers §3.3 ("learning … progress") and is documented in [`docs/learning/`](../learning/README.md).

Its 10 missions, assessment weights, calibration rules and story format are **team innovations**: the summaries do not prescribe them. It shares the financial core (`finance/`) and the fictional instrument universe with virtual trading. It does not share portfolios: a mission session never creates or changes a user's virtual portfolio.
