# PIF Actuarial Risk & Solvency Lab

A non-life actuarial workspace inside the Market Trading Room Simulator. It follows the actuarial chain for a **fictional insurer**:

1. model insurance risk;
2. estimate claims;
3. calculate premiums;
4. estimate reserves;
5. simulate losses;
6. assess capital;
7. manage assets and liabilities;
8. test financial resilience.

**No real insurer, no real policyholder data, no regulatory figures.** Every number is a model estimate from fictional assumptions and is labelled as such.

Status (9 Nov 2026):

- **Phase 1 is implemented and tested.** It covers claim frequency, claim severity, the aggregate loss distribution, premium pricing, saved scenarios and the Claims & Pricing Studio.
- **Phase 2, the Monte Carlo Lab, is implemented and tested on `PIF_test`**; its migration is applied to `PIF`. It provides seeded, reproducible simulation of the same model, with confidence intervals, threshold probabilities and a comparison with the exact results. Runs are stored per user.
- **Phase 3, the Reserving Studio, is implemented and tested on `PIF_test`.** It covers paid and incurred triangles, development factors, chain ladder, the expected loss ratio method, Bornhuetter–Ferguson, case reserves, IBNR, unpaid, sensitivities and the expected payments that the ALM Lab will use. Its migration (saved runs) was applied to `PIF` with approval on 9 Nov 2026, after a restore-tested backup.
- Economic Capital and ALM are **planned**. The Lab shows them as planned, never as working.

**Database migrations:**

| Migration | `PIF_test` | `PIF` (development) |
| --- | --- | --- |
| `20261111090000_actuarial_scenarios` (saved scenarios) | Applied | Applied, with approval |
| `20261112090000_actuarial_simulation_runs` (stored simulation runs) | Applied | **Applied on 9 Nov 2026 at 18:52, with approval**, after a restore-tested backup. An earlier unapproved apply had been rolled back; see the [incident log](architecture.md#7-incident-unapproved-apply-to-pif-and-rollback) |
| `20261114090000_actuarial_reserving_runs` (stored reserving runs) | Applied | **Applied on 9 Nov 2026 at about 23:05, with approval**, after a restore-tested backup |

On a database without a migration:

- pricing and reserve calculations still work, because the models need no database;
- the overview says that saved scenarios, the simulation history or saved reserving runs are not enabled;
- the corresponding endpoints answer `503 DATABASE_SCHEMA_OUTDATED`, and the web pages say so in plain English.

## 1. Scope decisions

### What this module is

The insurer collects premiums for a portfolio of non-life policies, pays claims, holds reserves and invests assets to back those obligations. The Lab answers:

- how many claims to expect;
- how much they cost;
- what premium covers them with expenses and a margin;
- how likely the premium is to be insufficient.

Later phases add:

- what reserves to hold;
- how much capital the insurer needs;
- whether its assets can meet its liabilities in a financial crisis.

### Why portfolio-loss insurance was rejected

The supervising professor rejected an earlier idea: an "insurance" that refunds traders' ordinary market losses. It is not built, and it must not be. Its flaws:

- **No insurable risk.** A market loss is an investment outcome the investor chose, not an accidental event.
- **Moral hazard.** A policy that refunds losses rewards risky trading.
- **Wrong classification.** It confuses insurance with hedging. Protective puts and similar strategies belong to the trading and risk modules.

This Lab never treats an investment loss as a claim. It never computes an indemnity from a trader's P&L.

Financial markets appear in this Lab only on the **insurer's asset side**, in the planned ALM Lab: the insurer invests premiums and reserves, and its assets are stress-tested against its insurance liabilities.

## 2. Requirements and their sources

The official specification PDF (`docs/requirements/PIF_Cahier_des_Charges_2026-2027.pdf`) is **not in the repository**. The five actuarial requirements below come from the team's own statement of the official requirements, in the actuarial master prompt. They have **not been verified against the PDF**.

| # | Requirement | Classification | Status |
| --- | --- | --- | --- |
| A1 | Predictive modelling of insurance premiums | Official (quoted, unverified) | **Implemented.** Pure, technical and gross premium from frequency and severity models; sensitivities |
| A2 | Premium margins and product profitability | Official (quoted, unverified) | **Implemented.** Explicit risk loading and profit margin; loss, expense and combined ratios; expected underwriting result; probability of an underwriting loss |
| A3 | Probability and conditions of claims | Official (quoted, unverified) | **Implemented.** Binomial and Poisson claim counts; P(N = k), P(N > E[N]); probability that a policy claims |
| A4 | Claim compensation amounts | Official (quoted, unverified) | **Implemented.** Deterministic, gamma and lognormal claim costs; quantiles, tail ratio, limited expected values; claim inflation |
| A5 | Claims reserving and financial obligations | Official (quoted, unverified) | **Implemented (Phase 3), deterministic.** Paid and incurred chain ladder, expected loss ratio, Bornhuetter–Ferguson; case reserves, IBNR, unpaid; sensitivities; expected payments by calendar year (the future obligations). No reserve uncertainty measure yet |
| — | Aggregate loss distribution, VaR, TVaR | Necessary technical (needed for A2, the profitability risk) | **Implemented.** Exact lattice or Panjer recursion |
| — | Saved, owner-scoped scenarios with model version | Necessary technical | **Implemented** |
| — | Seeded Monte Carlo simulation | Necessary technical (to validate the analytic results; required for capital) | **Implemented (Phase 2).** Exact samplers, VaR, TVaR and threshold probabilities with 95% intervals, comparison with the exact results, stored runs |
| — | Economic capital (internal measure, not a regulatory SCR) | Proposed innovation | Planned, Phase 3b |
| — | Asset-Liability Management Lab and "Can your insurance company survive a financial crisis?" | Proposed innovation (flagship) | Planned, Phase 4 |
| — | Negative Binomial frequency | Optional extension | Not implemented. Poisson and Binomial cover the reference cases; overdispersion will be added only with a use case |
| — | Real claims data | Unverified assumption | **None used.** All presets and reserving examples are fictional |

The P17 row of the [platform traceability matrix](../requirements/traceability-matrix.md) points here.

## 3. Where the code lives

| Layer | Path |
| --- | --- |
| Special functions | `apps/api/src/actuarial/math/special.ts` |
| Models (pure, no I/O) | `apps/api/src/actuarial/models/` — `frequency.ts`, `severity.ts`, `aggregate.ts`, `pricing.ts`, `presets.ts`, `sampling.ts`, `simulation.ts`, `reserving.ts`, `reserving-examples.ts` |
| Simulation execution | `apps/api/src/actuarial/simulation.runner.ts` (worker pool, queue, timeout), `simulation.worker.ts` |
| Response views | `apps/api/src/actuarial/actuarial.view.ts` |
| API | `apps/api/src/actuarial/actuarial.controller.ts`, `actuarial.service.ts`, `dto/actuarial.dto.ts`; reserving: `reserving.controller.ts`, `reserving.service.ts`, `dto/reserving.dto.ts` |
| Database | `ActuarialScenario`, `ActuarialSimulationRun` and `ActuarialReservingRun` in `apps/api/prisma/schema.prisma`; migrations `20261111090000_actuarial_scenarios`, `20261112090000_actuarial_simulation_runs` and `20261114090000_actuarial_reserving_runs` |
| Web client | `apps/web/src/lib/api/actuarial.ts` |
| Web screens | `apps/web/src/components/actuarial/`, `apps/web/src/app/actuarial/` |

## 4. Documents

| Document | Content |
| --- | --- |
| [architecture.md](architecture.md) | Layers, data flow, persistence, security, the migration with its backup and rollback |
| [mathematical-models.md](mathematical-models.md) | Every formula used, with parameter conventions and numerical methods |
| [api.md](api.md) | Endpoints, request fields and bounds, response shapes, error codes |
| [validation.md](validation.md) | Hand-computed reference values, tests and their results, browser verification |
| [progress.md](progress.md) | What is done, what is not, known limitations, next phases |

## 5. Running it

1. Start the API and the web app as usual.
2. Sign in and open **Actuarial Lab** in the sidebar (Insurance group).
3. **Overview** shows the reference portfolio. **Claims & Pricing Studio** recalculates on the server as you change assumptions. **Monte Carlo Lab** runs a seeded simulation of the same assumptions and compares it with the exact results. **Reserving Studio** estimates reserves from a fictional example or a triangle you paste, recalculating on the server as you change factors and assumptions.

Tests:

```powershell
# API unit tests (models, maths, views)
cd apps/api; npx jest src/actuarial
# API e2e (needs the disposable test database; never the development database)
$env:E2E_DATABASE_URL = '<PIF_test connection string>'; npx jest --config ./test/jest-e2e.config.ts test/actuarial
# Web unit tests
cd apps/web; npx vitest run src/components/actuarial
# Browser journey (API on 3001 and web on 3000 already running)
npm run test:e2e:actuarial
```
