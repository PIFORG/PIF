# Documentation historique — stack remplacée

> **État actuel :** l'application active est **Angular** (pps/web) + **Spring Boot** (pps/api) + **PostgreSQL**.
> NestJS / Next.js / React / Prisma Client ne font plus partie du runtime applicatif.
> Voir README.md, docs/architecture/LEGACY_CLEANUP_AUDIT.md et docs/ui/DESIGN_SYSTEM.md.
# Actuarial Lab: progress

Last updated 9 Nov 2026.

## Phases

| Phase | Content | Status |
| --- | --- | --- |
| 0. Audit | Repository, template, financial core, database, auth; requirement sources | **Done.** The `/actuarial` page was a labelled preview with no backend; there was no actuarial code; the specification PDF is absent |
| 1. Claims & pricing vertical slice | Frequency, severity, aggregate loss, premium, sensitivities, saved scenarios, Overview and Claims & Pricing Studio, tests, docs | **Done.** See [validation.md](validation.md) |
| 2. Monte Carlo Lab | Seeded, reproducible simulation of N and X; VaR and TVaR with confidence intervals; comparison with the analytic results; estimates for portfolios too large for Panjer | **Done and tested on `PIF_test`.** See [validation.md §6](validation.md#6-phase-2-monte-carlo-lab). Its migration was applied to `PIF` with approval on 9 Nov 2026 |
| 3a. Reserving Studio | Paid and incurred triangles, development factors, chain ladder, expected loss ratio, Bornhuetter–Ferguson, case reserves, IBNR and unpaid, sensitivities, expected payments for the ALM Lab, saved runs | **Done and tested on `PIF_test`.** See [validation.md §7](validation.md#7-phase-3-claims-reserving). Its migration was applied to `PIF` with approval on 9 Nov 2026 |
| 3b. Economic Capital | Internal economic capital from the simulated loss distribution (not an SCR) | Planned |
| 4. ALM Lab (flagship) | Asset portfolio backing liabilities, cash-flow matching, duration gap, rate and market shocks, liquidity; capstone "Can your insurance company survive a financial crisis?" | Planned |
| 5. UI polish | Cross-workspace navigation, guided walkthrough, printable report | Planned |
| 6. Advanced | Negative Binomial, deductibles and limits, reinsurance, rating factors | Planned, optional |
| 7. Verification | Full re-validation, documentation review against the specification PDF when available | Planned |

## Phase 1: what exists

| Area | Implemented |
| --- | --- |
| Frequency | Binomial (period probability from the annual one) and Poisson (intensity × policy-years); moments, pmf, quantiles, \(P(N > E[N])\), probability that a policy claims, distribution chart |
| Severity | Deterministic, gamma and lognormal from arithmetic mean and CV; claim inflation; quantiles, tail ratio, density chart; lognormal μ and σ labelled as parameters of ln X |
| Aggregate | Exact moments; exact lattice (deterministic cost) or Panjer recursion with mean-preserving discretisation; VaR, TVaR, exceedance, normal approximation for comparison; histogram with markers |
| Premium | Pure, technical and gross premium; expected-value or standard-deviation loading; fixed, per-policy and variable expenses; profit margin; per policy and per policy-year; loss, expense and combined ratios; expected underwriting result; P(underwriting loss) and P(claims > premium); five one-at-a-time sensitivities; plain-English warnings |
| Scenarios | Save, list, load and delete; owner-scoped; 50 per user; unique names; results computed by the server; model version and stale flag |
| API | 10 endpoints under `/api/actuarial`, authenticated, validated, rate-limited, documented in Swagger |
| Web | `/actuarial` (Overview) and `/actuarial/pricing` (Claims & Pricing Studio) in the existing template; workspace tabs with planned workspaces disabled; responsive at 375, 768 and 1440 px; accessible form controls, tables and charts |
| Platform | Dashboard reports the actuarial module as available; sidebar marks `/actuarial` as live; module catalogue and dashboard text rewritten for the non-life scope |

## Phase 2: what exists

| Area | Implemented |
| --- | --- |
| Sampling | Exact Binomial and Poisson count samplers for any portfolio size (no normal approximation); Marsaglia–Tsang gamma; lognormal claims drawn one by one; the shared seeded generator |
| Estimates | Mean, sd, median, min, max, skewness; VaR and TVaR at 90, 95, 99 and 99.5%; P(technical underwriting loss), P(claims > premium), P(capital insufficient); expected shortfall beyond capital; a 95% interval for every estimate except the descriptive statistics |
| Comparison | Exact mean, VaR, TVaR and probabilities beside the simulated ones, with "exact in interval"; the exact method (closed form or Panjer) is named; an unavailable exact distribution is stated with its reason |
| Inputs | The pricing assumptions, 1,000–200,000 periods, a seed (or one drawn by the server), initial capital, optional premium actually charged, optional label |
| Execution | Worker threads (2 running, 6 waiting, 30-second timeout); the API stays responsive during a run; lognormal runs limited to 20 million claim draws |
| Storage | Inputs, seed, engine version, duration and summarised results per run; never the individual losses; 25 most recent runs per user; owner-scoped; stale flag on engine change |
| API | `POST`, `GET` (list and one) and `DELETE` on `/api/actuarial/simulations`; the overview lists recent runs |
| Web | `/actuarial/monte-carlo`: run settings, status, KPIs, distribution with thresholds, threshold panel, simulated-against-exact tables, exceedance and convergence charts, run list with load and delete, method notes. The Overview links each available workspace to its page |

## Phase 3: what exists

| Area | Implemented |
| --- | --- |
| Data | Cumulative paid and (optional) incurred triangles of 3 to 25 annual accident years; optional earned premiums; missing amounts kept as missing, never zero; three fictional examples (motor, long-tail liability, a small book with data issues) |
| Factors | Link ratios; volume-weighted, simple and latest-\(k\)-calendar-year averages with the range and number of pairs; selected factors; separate paid and incurred tail factors; CDFs and percentage developed; undefined factors refused, not replaced |
| Methods | Chain ladder on paid and on incurred (computed separately and compared), expected loss ratio, Bornhuetter–Ferguson on paid and on incurred |
| Reserves | Paid, incurred and case reserves; ultimate, unpaid, IBNR (including IBNER) and development by accident year and in total; a reconciliation check (unpaid = case + IBNR) |
| Sensitivity | Other factor averages, tail +0.05, loss ratio ±10%, and a 1% shock to each factor |
| Cash flows | Undiscounted expected payments by calendar year from the paid chain ladder, with the paid-tail amount shown separately: the liability input for the ALM Lab |
| Warnings | Missing cells, zero bases, single-pair factors, distant selections, missing tail, paid decreases, negative case reserves, negative unpaid, paid–incurred gap |
| Storage | Labelled runs with inputs, server-recomputed results, model version and data checksum; 25 most recent per user; owner-scoped; stale flag on model change |
| API | 6 endpoints under `/api/actuarial/reserving`; the overview reports the runs |
| Web | `/actuarial/reserving` (Reserving Studio): triangle entry by typing or pasting, assumptions, live server analysis, headline KPIs by method, data checks, triangle views (cumulative, incremental, link ratios, completed), factor selection, reserves, method comparison, paid against incurred, development curves, sensitivities, expected payments, run list, definitions and formulas. The Overview lists recent reserving runs |

## Known limitations

- **Databases without the simulation migration.** There, the simulation endpoints answer `503 DATABASE_SCHEMA_OUTDATED` and the Monte Carlo page says that runs are not enabled. A run request is computed before the storage attempt fails, so it costs CPU time without producing a result; the rate limit and the worker queue bound that cost. `PIF` and `PIF_test` both have the migration.
- **Not exercised over HTTP on `PIF`.** The migration was verified on `PIF` by row counts and schema checks. The simulation endpoints were exercised on `PIF_test`, so that no test account had to be created in the development database.
- **Exact distribution size.** The full loss distribution is limited to portfolios where \(P(S = 0) \ge e^{-700}\), roughly 700 expected claims for Poisson. Larger books get exact moments and a normal approximation. VaR, TVaR and probabilities are then `null`, with an explanation. The Monte Carlo Lab estimates them, with intervals but without an exact comparison.
- **Random number generator.** mulberry32 has a 32-bit state, so it has at most \(2^{32}\) distinct seeds and streams from different seeds can overlap. The largest run uses well under \(2^{32}\) draws, and the sampler tests pass their distribution-wide checks, but the generator is meant for teaching and reproducibility, not for research-grade simulation.
- **One-period view.** Monte Carlo covers a single cover period, with no investment income, reinsurance or claim-settlement delay. "Capital insufficient" is a one-period technical shortfall, not a solvency or regulatory measure.
- **Runs are synchronous.** `POST /simulations` answers when the run is complete (at most 30 seconds). There is no progress indicator beyond "running", and no cancellation from the page.
- **Panjer accuracy.**
  - The discretisation error is not bounded analytically.
  - Tests check it against a semi-analytic result (within \(2 \times 10^{-3}\)) and through mean preservation (within 0.2%).
  - Exceedance probabilities include the uncaptured mass, so they are conservative by at most \(10^{-7}\) in normal cases.
- **Portfolio-level premium.** The premium is an average for a homogeneous portfolio:
  - no rating factors, deductibles, limits or reinsurance;
  - no investment income;
  - no cost of capital;
  - no claim-settlement delay.
- **Frequency families.** No Negative Binomial. Over-dispersion cannot be modelled yet.
- **Data.** No observed claims data and no parameter estimation from data. All presets are fictional.
- **Unverified requirements.** The requirement classification has not been checked against the specification PDF, which is not in the repository.
- **Reserving.**
  - **Deterministic only.** No measure of reserve uncertainty (Mack standard errors, bootstrap). The sensitivities show how assumptions move the estimate; they are not confidence intervals.
  - **Annual, aggregate triangles.** No quarterly development and no claim-level data, so IBNER (development of known claims) cannot be separated from pure IBNR. Claim counts and average-cost methods are not available.
  - **No inflation or calendar-year effects.** The chain ladder assumes stable development; there is no inflation adjustment and no Berquist–Sherman correction for changes in case reserving or payment speed.
  - **Tail.** The tail factor is entered by the user; there is no curve fitting. Payments after the last development year have no timing.
  - **Money values.** Reserves and payments are undiscounted, with no risk margin and no claim-handling expenses. They are internal best estimates for learning, not regulatory technical provisions.
  - **Data.** The examples are fictional. No data import beyond typing or pasting.
  - **Migration.** On a database without the reserving migration, calculations work but runs cannot be saved (`503 DATABASE_SCHEMA_OUTDATED`). `PIF` and `PIF_test` both have it. As for the simulations, the endpoints were exercised over HTTP on `PIF_test` only, so that no test account had to be created in `PIF`.
- **Prisma tooling.** In `apps/api`, the Prisma CLI resolves to 6.19.3 while `@prisma/client` is 6.5.0. `npx prisma generate` therefore reports an error at the very end, about a missing wasm file. The client *is* generated: the `ActuarialScenario` types are present and `tsc` passes. Aligning the two versions is a separate maintenance task.

## Next highest-priority work

1. **Before the ALM Lab:**
   - Economic Capital (internal, from the Phase 2 simulated loss distribution; not an SCR);
   - a reserve uncertainty measure (Mack standard errors) so the ALM Lab can stress liabilities;
   - a payment pattern for the paid tail, and a decision on inflation and discounting (discounting belongs in the ALM Lab, with its yield curve);
   - the asset side from the shared financial core (not users' trading portfolios).
2. **Phase 4:** the ALM Lab, reading the expected payments of a stored reserving run, and the capstone scenario.
