# Final migration checkpoint

Updated **2026-11-12** after Gate M (canonical rename + legacy removal) and numerical parity audit.

## Source state

| Area | Total | Active implementation | Verified |
| --- | --- | --- | --- |
| API endpoints | **94** | Spring Boot `apps/api` | Differentials (pre-cutover) + post-rename journeys |
| Frontend routes | **37** | Angular `apps/web` | Journeys + unit/lint/build |

Legacy Nest/Next source is **outside** the active tree (see `docs/migration/recovery/README.md`).

## Work packages

| # | Package | Status |
| --- | --- | --- |
| 0–6 | Identity, trading, learning, actuarial, Angular UI, differentials/journeys/visual | **done** |
| 7 | Standalone Spring+Angular verification | **done** (Nest/Next stopped) |
| 8 | Gate M: recovery + canonical `apps/api` / `apps/web` + legacy removal | **done** |
| 9 | Numerical parity audit (domain-aware; no blanket snap) | **done** — 151/151 |

## Tests (post–Gate M)

- Spring `mvnw -B -P database-tests test`: **3,828** / 0 failures.
- Angular: **281** tests, lint clean, typecheck clean, production build OK.
- Journeys with Nest/Next **down**: learning **12/12**, actuarial **8/8**, trading **38/38**.
- Actuarial differential (domain-aware): **151/151** (see `NUMERICAL_PARITY_AUDIT.md`).

## Database

All harness writes: **`PIF_spring_test`**. Production **`PIF`** untouched.

## Honest verdict

**COMPLETE — ALL MIGRATION ACCEPTANCE GATES PASSED.**

Detail: `docs/migration/FINAL_ACCEPTANCE_REPORT.md`.
