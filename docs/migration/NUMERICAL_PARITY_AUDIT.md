# Numerical parity audit (actuarial)

**Date:** 2026-11-12  
**Suite:** `apps/api-spring/contract/differential-actuarial.mjs` (151 checks)  
**Comparator:** `apps/api-spring/contract/numerical-parity.mjs` (domain-aware; **no** blanket `toPrecision(12)`)  
**Database:** `PIF_spring_test` only (production `PIF` untouched)  
**Result:** **151/151 passed** after policy correction

## 1. Original 21 mismatches (pre-audit)

Before any float normalization, the expanded harness reported **130/151**. The **21 failures** were **not** live pricing disagreements. Both NestJS and Spring Boot returned the **same live doubles**. Failures appeared on **read-backs of saved scenarios, simulations, and reserving runs** (list/get/overview/database state).

### Mechanism

1. Live computation produces IEEE-754 `number` / `double` values.
2. Nest persists JSON documents through **Prisma → PostgreSQL JSONB**.
3. On read-back, some values appear as a **neighbor double** (1–3 ULPs).
4. Spring JDBC stores and returns the **live** value unchanged.
5. Exact `===` comparison therefore failed on persisted payloads only.

### Canonical example

| Stage | `underwriting.probabilityOfLoss` (reference binomial book) |
| --- | --- |
| Live Nest | `0.13891894630935067` |
| Live Spring | `0.13891894630935067` (bit-identical) |
| Nest row after Prisma JSONB | `0.1389189463093507` (≈ **1 ULP**) |
| Spring row | live value |

JSON `stringify`/`parse` alone does **not** create this rewrite; the Nest→Prisma→JSONB→Prisma path does.

Additional live-path noise (2–4 ULPs, absolute error ≪ 1e-12) appears on:

- Monte Carlo empirical exceedance frequencies (`k/N`)
- Chain-ladder link ratios and undeveloped totals (`estimated`, `volumeWeighted`, `cashFlows.total`, `relativeDifference`)

These are **binary representation / association differences** between JS `Number` and Java `double` for the same algorithm—not reserve or premium defects. Closed-form invariants remain exact within millime policy (see §3).

## 2. Why blanket `toPrecision(12)` was removed

A global 12-significant-digit snap made the suite green but:

- Hid whether a field should be **exact** (ids, enums, integer counts, millime money).
- Applied the same mask to probabilities, VaR, and ledger-like amounts.
- Was not a scientific acceptance rule for financial software.

It is replaced by **field-class policies** in `numerical-parity.mjs`. Stored JSONB values are **not** rewritten to force tests green. Spring actuarial outputs were **not** changed for this audit.

## 3. Domain-aware comparison policies

| Class | Fields / paths | Rule | Rationale |
| --- | --- | --- | --- |
| Exact | ids, UUIDs, enums, booleans, strings, checksums, seeds, integer counts (`policies`, `simulations`, …) | Bit / value identity | Contractual identity and ledger metadata |
| Money | `mean`, `sd`, premiums, VaR/TVaR, reserves reported via `money()` / millimes | \|Δ\| ≤ **0.0005** (half millime) or ≤1 ULP | Shared fixed-point money (×1000) |
| Probability | `probability*`, `capturedMass`, densities | ≤1 ULP or \|Δ\| ≤ 1e-15 | Unit interval; double noise only |
| Statistics / link ratios | variance, CV, chain-ladder factors, `cashFlows` undeveloped totals, `relativeDifference` | ≤4 ULPs or rel ≤ 1e-12 or abs ≤ 1e-12 | Double accumulation; not millime-rounded |
| MC frequencies | `exceedanceCurve.*.exact` / empirical | ≤4 ULPs or abs ≤ 1e-15 | Empirical `k/N` binary forms |
| Persisted DB state (`db.*`) | JSON documents read via Prisma vs Spring | ≤3 ULPs on floats; non-floats exact | Documented Prisma JSONB rewrite |
| Wall clock | `durationMs` | Normalized to `"<ms>"` | Non-deterministic |

Headers, HTTP status, and structural keys remain exact (existing harness rules).

## 4. Independent mathematical invariants (reference book)

Assumptions: 1,000 policies, claim probability 5%, deterministic severity 1,200 TND.

| Quantity | Expected | Check |
| --- | --- | --- |
| E[S] | 60,000 | Exact after `money()` |
| sd(S) | √(1,200² × 1,000 × 0.05 × 0.95) ≈ 8,270.428646… → **8,270.429** millime | Half-millime |
| Gross premium | 60,000 × 1.15 + 20,000 = **89,000** | Exact |
| P(S > claims budget) | ≈ **0.138919** (5 d.p., Nest e2e convention) | Probability policy |
| Hand-triangle paid CL unpaid | **107** | Exact within FP noise policy |
| Taylor–Ashe paid CL unpaid | rounds to **18,680,856** | Integer round |

Cash / premium reconciliation fields that are millime money use the money policy; distributional moments use the statistics policy.

## 5. Raw mismatch capture

Command (from `apps/api-spring`, `DATABASE_URL=…/PIF_spring_test`):

```text
node contract/differential-actuarial.mjs
```

Artifact: `apps/api-spring/target/numerical-parity-raw.json` — every live/db numeric pair that is not `Object.is`-equal, with ULP distance and whether the domain policy accepts it.

## 6. Final outcome

| Metric | Value |
| --- | --- |
| Checks | **151 / 151** |
| Blanket snap | **Removed** |
| Spring math changed for tests | **No** |
| Stored JSONB mutated for tests | **No** |
| Production `PIF` DB | **Not accessed** |

## 7. Finance accounting reference

Separate Spring golden masters remain authoritative for trading money:

- `FinanceGoldenMasterTest`
- `TradingGoldenMasterTest`

Those suites use contractual millime equality and were not weakened by this actuarial comparator change.
