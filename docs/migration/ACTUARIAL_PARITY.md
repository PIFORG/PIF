# Actuarial parity (Actuarial Lab)

**Status: Not started.** No actuarial endpoint or screen has been migrated. This document lists what the Spring port must reproduce, taken from `apps/api/src/actuarial`.

Scope reminder: portfolio-loss insurance must **not** be reintroduced. The Actuarial Lab covers frequency, severity, aggregate loss, pricing, Monte Carlo simulation and reserving only.

## Components to port

| NestJS module | Content | Spring status |
| --- | --- | --- |
| `models/frequency.ts`, `models/severity.ts`, `models/aggregate.ts` | Frequency and severity distributions, aggregate-loss analysis | Not started |
| `models/pricing.ts`, `models/presets.ts` | Premium calculation and presets | Not started |
| `math/special.ts` | Special functions (gamma, incomplete gamma, normal quantiles, …) | Not started |
| `models/sampling.ts`, `models/simulation.ts`, `simulation.runner.ts`, `simulation.worker.ts` | Monte Carlo engine `pif-actuarial-mc-1.0.0`: **mulberry32 (32-bit state) with Box–Muller normals**, empirical quantiles, TVaR and confidence intervals, risk levels 0.90 / 0.95 / 0.99 / 0.995, run on a worker thread | Not started |
| `models/reserving.ts`, `models/reserving-examples.ts`, `reserving.service.ts` | Chain ladder (paid and incurred), expected loss ratio, Bornhuetter–Ferguson, sensitivity, cash-flow projection; persisted runs | Not started |
| `actuarial.service.ts`, `actuarial.view.ts`, controllers and DTOs | Scenarios, simulation runs, response shaping and validation | Not started |

## Reproducibility contract

| Rule | Plan | Status |
| --- | --- | --- |
| Same seed ⇒ same simulated losses | Port mulberry32 with 32-bit integer semantics (`int`, `>>>`, `Math.imul` equivalent via `int` multiplication) and Box–Muller in the same call order. Verify the first N uniforms and normals for recorded seeds, then whole-run outputs | Pending |
| Stored data remains readable | Spring reads the existing `actuarial_scenarios`, `actuarial_simulation_runs` and `actuarial_reserving_runs` rows written by NestJS without conversion; the engine version is stored with each run | Pending |
| Numeric results | Closed-form results equal within a documented relative tolerance (floating point, no money columns). Simulated statistics are compared exactly when the RNG stream is identical | Pending |
| Long runs | Off the request thread (NestJS uses a worker). The Spring equivalent is a bounded executor with the same limits (`SIMULATION_LIMITS`) | Pending |

## Verification plan (not executed yet)

1. Golden fixtures from the TypeScript models (`models.spec.ts`, `simulation.spec.ts`, `reserving.spec.ts`, `special.spec.ts`) exported as JSON and replayed in JUnit.
2. Differential HTTP test NestJS vs Spring for the 20 actuarial and reserving endpoints on `PIF_spring_test`.
3. Browser journey equivalent to `scripts/e2e/actuarial-journey.mjs` against Angular + Spring, with screenshot comparison of `/actuarial/*`.
