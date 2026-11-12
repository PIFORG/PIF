# Test report

Every result below comes from a command that was actually run on the development machine (Windows, Node 22.23.1, JDK 25.0.5, local PostgreSQL), on 2026-11-11 unless stated otherwise.
- Database: `PIF_spring_test` for every migration check. `PIF` was not used, read or written.
- E-mail: both APIs ran with `MAIL_TRANSPORT=preview` and a temporary `MAIL_PREVIEW_DIR`, so every message was written to a local folder and none was delivered. The SMTP tests use an in-process GreenMail server.
- Accounts: disposable test accounts only (`@spring-contract.test`, `@spring-journey.test`, `@spring-account.test`, `@spring-db-test.test`, `@spring-visual.test`).

## Phase 3, step 1: gaps carried over from phase 2

| Gap | Result | Command |
| --- | --- | --- |
| A. Finance corrections | **Pass**: `FinanceCorrectionsTest` 6/6 (independent fixtures); `FinanceGoldenMasterTest` 3,020/3,020, with exactly 2 VaR cases reclassified as invalid data. Policy in [FINANCIAL_PARITY.md](FINANCIAL_PARITY.md) | part of the Spring suite |
| B. Security headers | **Pass**: production host check 37/37 (token-page `no-referrer` and `no-store` on 200, `HEAD`, 308, 404 and 405; cacheable fingerprinted assets; traversal; API forwarding; 502; redacted access log; token removed from the URL, the history entry and `Referer` in Edge). CVE-2026-22732: not applicable (no `spring-security-web`; checked with `mvnw dependency:tree`) | `node scripts/migration/angular-host-check.mjs` |
| C. E-mail links | **Pass**: `MIGRATION_FRONTEND_URL` validation in `MailTransportTest`; journeys A1 and A3 open the e-mailed links on the Angular origin | Spring suite; account journey |
| D. Angular lint | **Pass**: "All files pass linting." The first run reported `array-type` (3 uses of `Array<…>`, rewritten), an unused destructured variable (rewritten), `no-control-regex` on the `returnTo` sanitizer (intended: it rejects control characters; disabled on that line with the reason) and `component-selector` on the two `svg[mtr…]` attribute components (needed so parent styles reach the `<svg>`; disabled on those lines with the reason). No rule is turned off globally | `npm run lint` in `apps/web-angular` (`ng lint`, angular-eslint 22.6.0) |
| E. OpenAPI | **Pass**: 37 shared operations, 0 differences (1 documented accepted difference); info, security scheme and `ErrorResponse` identical; `OpenApiConfigTest` 4/4 | `node scripts/migration/openapi-compare.mjs` |
| F. Browser journeys | **Pass**: account journey 44/44 (A1 resend, A2 password change, A3 e-mail change, A4 recovery-code regeneration, A5 MFA disable, A6 deactivation, A7 deletion, S1 artifact secret scan); admin MFA policy 11/11 with `AUTH_ADMIN_MFA_REQUIRED=true` | `node scripts/migration/angular-account-journey.mjs` and `… admin-mfa` |

Suites re-run after step 1: Spring `mvnw -B -P database-tests test` **3,127 run, 0 failures, 0 errors, 0 skipped** (3,114 before, plus `FinanceCorrectionsTest` 6, `OpenApiConfigTest` 4, 1 golden-master reclassification check and 2 `MIGRATION_FRONTEND_URL` mail tests); Angular `ng test` **151/151** in 15 files.

## Checkpoint 2: identity, security, sessions, administration, financial core

| Gate | Result | Command |
| --- | --- | --- |
| 1. Compile | **Pass**: Spring `package`; Angular production build (initial bundle 430.94 kB, 105.71 kB transferred); Angular typecheck of app and specs | `mvnw -B -DskipTests package`; `npx ng build`; `npm run typecheck` in `apps/web-angular` |
| 2. Unit and integration | **Pass**: Spring 3,114/3,114, 0 skipped; Angular 151/151 in 15 files | `mvnw -B -P database-tests test`; `npx ng test --watch=false` |
| 3. API contract | **Pass**: identity suite 216/216; Phase 1 suite 58/58 | `node apps/api-spring/contract/differential-identity.mjs`; `node apps/api-spring/contract/differential-auth.mjs` |
| 4. Data compatibility | **Pass**: 22 PostgreSQL integration tests; every differential scenario compares database side effects; rows written by one API are used by the other | as above |
| 5. Security | **Pass**, with the open items listed in [SECURITY_PARITY.md](SECURITY_PARITY.md) | covered by gates 2–4 and 6 |
| 6. Functional E2E | **Pass**: identity journeys 61/61 (J1–J10 and MT1–MT9); Phase 1 auth journey 23/23 | `node scripts/migration/angular-identity-journey.mjs`; `node scripts/migration/angular-auth-journey.mjs` |
| 7. Financial parity | **Pass for the shared core**: 3,013 golden cases bit-identical, plus 28 ported spec tests. No financial endpoint migrated | part of gate 2; see [FINANCIAL_PARITY.md](FINANCIAL_PARITY.md) |
| 8. Visual parity | **97 comparisons, 0 failures, 0 page errors.** 65 have no pixel beyond tolerance; 32 have at most 0.113%, explained as live session times crossing a minute and sub-pixel glyph positioning. Page sizes are identical in all 97 pairs, nothing overflows horizontally, and 0 replay status mismatches occurred. Details in [UI_VISUAL_PARITY.md](UI_VISUAL_PARITY.md) | `node scripts/migration/visual-parity.mjs` (`DATABASE_URL` on `PIF_spring_test`) |
| 9. Regression (existing apps) | **Pass**: NestJS 585/585 (37 suites); Next.js 148/148 (27 files); typecheck and lint of both apps clean | `npm run typecheck`, `npm run test`, `npm run lint` at the repository root |
| 10. Documentation | **Done**: `API_PARITY_MATRIX`, `FEATURE_PARITY_MATRIX`, `SECURITY_PARITY`, `UI_VISUAL_PARITY`, `FINANCIAL_PARITY`, `PROGRESS` and this report | — |

### Required browser journeys

| # | Journey (phase brief) | Covered by | Result |
| --- | --- | --- | --- |
| 1 | Registration → verification → login | identity J1 (10 checks) | Pass |
| 2 | Login → MFA → dashboard | auth journey step 9 (wrong code, valid TOTP, lands on the default workspace page); identity J5 (recovery-code sign-in) | Pass. `/dashboard` itself is still a "not migrated" page |
| 3 | Password recovery → reset → login | identity J3 (8 checks) | Pass |
| 4 | Profile update → persistence | auth journey step 4 (saved through Spring, checked in PostgreSQL, visible in Next.js) | Pass |
| 5 | MFA setup → validation → recovery code | identity J5 (8 checks) | Pass |
| 6 | Session management → revoke → denied access | identity J6 (4 checks) | Pass |
| 7 | Multi-tab logout → synchronization | identity MT1–MT9 (12 checks) | Pass |
| 8 | Non-admin → forbidden administration | identity J8 (4 checks, including a direct API call refused by Spring) | Pass |
| 9 | Administrator → authorized operations | identity J9 (9 checks: suspend, reactivate, promote with step-up, audit, demotion) | Pass |
| 10 | Cross-backend login → refresh → logout | identity J10 (5 checks); auth journey steps 7–8 | Pass |

A final check confirms that no request was rate-limited during the journeys.

### Spring (`apps/api-spring`, JUnit 5)

`mvnw -B -P database-tests test` with `DATABASE_URL` pointing at `PIF_spring_test`: **3,114 run, 0 failures, 0 errors, 0 skipped.**

| Class | Tests | Covers |
| --- | --- | --- |
| `FinanceGoldenMasterTest` | 3,019 | 3,013 golden cases for 37 functions (bit-for-bit), fixture coverage, constants, the 4 classified divergences |
| `FinanceSpecTest` (9 nested classes) | 28 | ported `finance.spec.ts` / `orders.spec.ts` cases |
| `IdentityDatabaseTest` (tag `database`) | 12 | registration, reset, e-mail change, change-password, MFA lifecycle, sessions, lockout with exactly one notice (including concurrent failures), a failed notice never undoing the lock, admin status and role changes, last-administrator protection |
| `AuthDatabaseTest` (tag `database`) | 10 | Phase 1 database behaviour |
| `MailTransportTest` | 14 | preview and SMTP transports (GreenMail), retries, failure states, full queue, masked logs |
| `EmailTemplatesParityTest` | 2 | the 18 templates against the NestJS-rendered fixtures, byte for byte |
| `RolesInterceptorTest` | 5 | admin role boundary, `ADMIN_MFA_REQUIRED` on, off and the production default, missing principal |
| `NestCryptoCompatibilityTest` | 9 | Argon2id, digests, MFA envelope, TOTP, JWT, address formatting |
| `ConfigAndGuardTest` | 8 | configuration, `_test` target guard, secrets never printed |
| `RequestContractTest` | 7 | validation messages, e-mail syntax, throttling, invalid JSON |

The "Email delivery failed" lines in the Maven output are logged by the tests that simulate a relay outage and a full queue. Recipients appear masked.

**Fix during verification:** `theLastActiveAdministratorCannotBeRestricted` was skipped while another administrator existed in the shared test database; its assumption required zero other administrators. It now runs inside a transaction that is always rolled back. In that transaction, the other administrators are suspended only as seen from inside it. It passes, and a check afterwards showed the visual administrator account still `ACTIVE`.

**Added during verification:** `RolesInterceptorTest`, a port of `roles.guard.spec.ts`. No Spring test covered the administrator-MFA policy before.

### Differential contract tests

- `differential-identity.mjs`: **216/216 PASS**. The report is `apps/api-spring/target/differential-identity-report.json`. Scenario list: [API_PARITY_MATRIX.md](API_PARITY_MATRIX.md).
- `differential-auth.mjs`: **58/58 PASS**.

Two checks assert a documented divergence instead of hiding it: audit date filters in ISO week or basic format return 500 on NestJS and 400 on Spring.

### Angular (`apps/web-angular`, Vitest via `ng test`)

**151/151 PASS in 15 files.** They cover components, reactive forms, routing, guards (`guards.spec.ts`), the HTTP client and refresh handling, the Settings pages (Security, Sessions), the admin pages, the e-mail link and request pages, registration, dialogs, device formatting and validators.

**Fix during verification:** the first version of `adminGuard` blocked navigation until the session was known. That broke the app-level "Checking session…" gate, so the guard now defers while the session loads, and the gate decides. The suite went back to 151/151, and the identity journey was re-run afterwards: 61/61.

### Browser journeys

- `scripts/migration/angular-identity-journey.mjs`: **61/61 PASS**. It uses headless Edge with Angular 4200 + Spring 3002, plus Next.js 3000 + NestJS 3001 for the cross-backend steps. Results and screenshots are in `docs/migration/screenshots/identity-journey/`. A review of the captures found that `J5-recovery-codes.png` showed the disposable account's recovery codes in clear text. The script now masks MFA secrets and recovery codes for each capture, including failure captures, and restores them afterwards, so later checks still see the real page. The journey was re-run after this change: **61/61** (2026-11-11, finished 17:56 local time); the new capture shows only masked codes. Four stale `*-aborted.png` captures from earlier interrupted runs were removed.
- `scripts/migration/angular-auth-journey.mjs` (Phase 1): **23/23 PASS**.

### Regression of the existing applications

At the repository root:
- `npm run typecheck`: pass (API and web).
- `npm run test`: NestJS 37 suites / 585 tests pass; Next.js 27 files / 148 tests pass.
- `npm run lint`: pass, 0 warnings.

No file under `apps/api/src`, `apps/api/prisma`, `apps/api/test`, `apps/web/src` or `apps/web/e2e`, nor either app's `package.json` or `next.config.ts`, changed during this phase (checked by modification time).

### Test-environment incidents (not product defects)

| What happened | Cause | Resolution |
| --- | --- | --- |
| A visual run timed out on every scenario that signs in the visual investor account, in both apps, from the middle of the run onwards | Two visual runs back to back signed that account in about 19 times per API within 15 minutes. The per-account sign-in throttle (20 per 15 minutes per address, per API process) then refused it. The audit trail shows the successes stopping at that point, and the account was neither locked nor changed | Waited out the window; one run stays at about 14 sign-ins per API. Leave 15 minutes between full visual runs |
| `mobile-drawer` failed in Angular during that same run | The first sign-in refused by the throttle | Same |

## Not run

- NestJS e2e suites (`npm run test:e2e`): their setup deletes data with `deleteMany`, and no NestJS source changed.
- Browsers other than Edge/Chromium.
- Load and performance tests.

(Angular lint and the `AUTH_ADMIN_MFA_REQUIRED=true` run, listed here at checkpoint 2, were added in phase 3 step 1.)

## Checkpoint 1 (2026-11-10), for reference

First vertical slice: Spring 34/34, Angular 55/55, differential 58/58, browser journey 23/23, 22 pixel comparisons, and regression 585 + 148. The details are superseded by the results above, which include all of those checks.

## Gate M final (2026-11-12) � standalone after canonical rename

Database: `PIF_spring_test` only. Nest `:3001` and Next `:3000` were **stopped**.

| Suite | Result |
| --- | --- |
| Domain-aware actuarial differential | **151/151** (see NUMERICAL_PARITY_AUDIT.md) |
| Spring `mvnw -B -P database-tests test` from `apps/api` | **3828** run, 0 failures � BUILD SUCCESS |
| Angular unit / lint / typecheck / production build from `apps/web` | **281/281**, lint clean, typecheck clean, build OK |
| `angular-learning-journey.mjs` | **12/12** |
| `angular-actuarial-journey.mjs` | **8/8** |
| `angular-trading-journey.mjs` | **38/38** |

Canonical paths: `apps/api` (Spring), `apps/web` (Angular). Legacy Nest/Next recovered outside the repo.
