# Implementation progress — Market Trading Room Simulator identity system

- **Source of truth:** [`docs/master-prompt.md`](docs/master-prompt.md), a verbatim copy of the original brief. Section numbers below (§) refer to it.
- **Resume procedure:** read this file top-to-bottom, then continue with the first phase whose status is not `DONE`.
- **Workspace caveat:** this directory is **not a git repository**, so there is no version history or rollback. Keep changes incremental and log every modified file below.

## Verification gate (run after every phase)

| Step | Command (repo root) |
|---|---|
| Type check (api + web, includes e2e specs) | `npm run typecheck` |
| Lint (zero warnings allowed) | `npm run lint` |
| Unit tests (api Jest + web Vitest) | `npm run test` |
| All three | `npm run verify` |
| API build | `npm run build:api` |
| Web production build | `npm run build:web` |
| DB-backed e2e (needs Postgres) | `RUN_E2E=1 npm run test:e2e` |

A phase is `DONE` only if every applicable gate passed in that phase's final run.

## Phase plan

| # | Phase | Depends on | Status |
|---|---|---|---|
| 0 | Repository inspection, requirement checklist, this file | — | DONE (checklist refined from the audits, see below) |
| 1 | Verification toolchain: ESLint (api + web), typecheck scripts, web unit-test runner, remove lint bypass | 0 | DONE |
| 2 | Backend core auth gaps (§4, §5.1–5.8, startup config validation) | 1 | DONE (also pulled in L6 emails) |
| 3 | Backend lifecycle gaps (§5.9–5.13, sessions, MFA, emails) | 2 | DONE |
| 4 | Authorization / admin / ownership / maintenance (§6, §7, §11) | 3 | DONE |
| 5 | Frontend gaps (§8 client, §9 routes / a11y / UX, frontend tests) | 2–4 | DONE (browser E2E not available, see F15) |
| 6 | DB-backed verification: migrate, e2e, concurrency tests (§12 Slice G, §13) | DB access | **BLOCKED**, see Blockers |
| 7 | Docs refresh, requirements coverage report, unverified-feature list (§15) | all | DONE (see `docs/identity-delivery-status.md`) |

## Repository inspection (Phase 0)

- **Monorepo:** npm workspaces with `apps/api` (`@mtrs/api`) and `apps/web` (`@mtrs/web`); `packages/*` is declared but empty. Node 22.23.1, npm 10.9.8.
- **API (`@mtrs/api`):**
  - Stack: NestJS 11, Prisma 6.5 on PostgreSQL with `citext`, global prefix `/api`, Swagger (non-production only).
  - Modules: `auth`, `users`, `admin`, `audit`, `email` (nodemailer), `prisma`, `config`.
  - Migration: `prisma/migrations/20261015190000_init_identity`.
  - Tests: Jest unit tests in `src/**/*.spec.ts`; Supertest e2e in `test/auth.e2e-spec.ts`, gated by `RUN_E2E=1`.
- **Web (`@mtrs/web`):**
  - Stack: Next.js 15.5 App Router, React 19, React Hook Form + Zod, CSS Modules plus `globals.css`.
  - 16 routes in total.
- **Infrastructure:** `docker-compose.yml` defines Postgres 16, Mailpit and Redis (profile-only). Root `.env.example` has placeholder values only.
- **Environment findings:**
  - The Docker CLI is installed, but the Docker Desktop engine is not running.
  - A native **PostgreSQL 18 Windows service is running on port 5432**, so the compose `postgres` service would collide on that port.
  - The project role `mtrs` does not exist on that server: `prisma migrate status` returns P1000 (authentication failed).

## Phase 1 — Verification toolchain (DONE)

**Problems found**
- `apps/api` had a `lint` script but no ESLint config, so it could never run.
- `apps/web` used legacy `.eslintrc.json` with ESLint 9. `eslint-config-next` failed to load its babel parser because `next` is not hoisted, and the build hid this with `eslint.ignoreDuringBuilds: true`.
- There was no frontend test runner.

**Changes**
- `apps/api/eslint.config.mjs` (new): flat config with `@typescript-eslint` recommended rules plus `no-floating-promises`, `no-misused-promises`, `no-explicit-any` and `no-console`.
- `apps/web/eslint.config.mjs` (new, replaces the deleted `.eslintrc.json`): flat config from `@next/eslint-plugin-next` core-web-vitals, react, react-hooks, jsx-a11y and `@typescript-eslint`.
- `apps/web/next.config.ts`: removed `ignoreDuringBuilds`, so the build lints `src` again.
- `apps/api/src/main.ts`: `bootstrap()` rejection is now handled. This fixes the only lint finding: a floating promise, which meant a silent start failure.
- Scripts:
  - api: added `typecheck`;
  - web: `lint` now runs the ESLint CLI; added `typecheck` and `test` (Vitest);
  - root: added `typecheck`, `test:web`, `verify`; `test` now runs both apps.
- `apps/web/vitest.config.mts` (new). `vitest@3.2.7` is the only newly installed package.
- New web tests:
  - `src/lib/auth/returnTo.test.ts`: 17 open-redirect cases;
  - `src/lib/api/client.test.ts`: single-flight refresh, credentials, `REFRESH_SUPERSEDED` retry, retry-once, error codes;
  - `src/lib/validation/schemas.test.ts`: password policy alignment.
- `apps/api/src/common/filters/http-exception.filter.spec.ts`: silences an intentional error log.

**Gate results (final Phase 1 run)**
- `npm run verify` exited 0:
  - api `tsc` OK, web `tsc` OK;
  - api ESLint 0 problems; web ESLint 0 problems (44 files);
  - api Jest **30/30** (7 suites); web Vitest **29/29** (3 files).
- `npm run build:web` exited 0: 16 routes.
- Known benign warning: `next build` prints "Next.js plugin was not detected". This is the deprecated `next lint` detector, which only understands the old config format. The plugin's rules are verified active via `eslint --print-config` (`@next/next/no-html-link-for-pages` and others).

## Phase 2 — Backend core auth (DONE)

**Changes**
- **Login lockout:**
  - the lock is checked *before* the password, and a locked account never has its password evaluated (a dummy hash keeps timing comparable);
  - the response is always 401 `INVALID_CREDENTIALS`, and the old 403 `ACCOUNT_LOCKED` oracle is gone;
  - the failure counter is an SQL increment, and the lock is applied by a conditional `updateMany`, so exactly one request sends the new lockout alert email;
  - a lock pauses new sign-ins only: `JwtStrategy` and `refresh()` no longer reject locked users, so failed attempts cannot sign the real owner out.
- **Email verification:**
  - one transaction claims the token and applies its effect;
  - verification only moves `PENDING_VERIFICATION` to `ACTIVE` and never lifts SUSPENDED or DEACTIVATED;
  - accounts that are deleted or pending deletion are rejected;
  - verification links are only issued to accounts still pending verification.
- **Credential-sensitive tokens:**
  - password reset/change revoke `PASSWORD_RESET`, `EMAIL_CHANGE`, `MFA_LOGIN_CHALLENGE` and `REFRESH_TOKEN`;
  - reset first does a read-only token check (so bogus tokens cost no Argon2 work), then claims the token inside the effect transaction.
- **Registration:**
  - Argon2 runs before the lookup, so timing does not reveal account existence;
  - the account-exists notice is limited to one per 15 minutes (audit-based cooldown);
  - the policy check uses identity context.
- **Per-account throttle:** a new `account` named throttler keyed on the normalized body email (`common/throttling/account-throttle.ts`). Limits: login 20, and register / resend-verification / forgot-password 3, per 15 minutes.
- **Logout:** a cookie and/or a valid Bearer token (HS256, issuer and audience pinned) revokes the matching session, scoped to its owner.
- **Refresh reuse:** reuse revocation is now transactional.
- **MFA login:** re-checks status, verification, deletion and lock before issuing a session.
- **Status codes:**
  - step-up failures are 403 (`assertStepUp`, change-password, admin role change);
  - an invalid code at MFA enrollment is 400.
- **Response hygiene:** change-password no longer returns `sessionId`, and `securityVersion` is removed from the public user.
- **Password policy:** NIST-style screening covering blocklist, repetition, sequences and keyboard walks, service words, leet de-substitution and owner identity. *Superseded:* at the product owner's request the policy is now 8–128 characters with a letter, a number and a symbol; the blocklist was removed (see `docs/identity-security-decisions.md`).
- **Startup config validation:** `assertSafeConfiguration` (C8). `TRUST_PROXY` is wired to Express `trust proxy` and documented in `.env.example`.
- **Email (L6 pulled forward):**
  - the templates were rewritten: expiry and single-use statements, first-name greetings, security notices that never say "ignore";
  - a support line appears only when `EMAIL_SUPPORT_URL` is set, and the delivery-failure log masks the recipient;
  - new notices: account locked, MFA enabled/disabled, deletion scheduled, plus templates for later phases (email changed, suspended, reactivated);
  - fixed `sendSessionsRevoked`, which was passing a sentence as the first name.

**Gate results (final Phase 2 run)**
- `npm run verify` exited 0:
  - api and web `tsc` OK;
  - ESLint 0 problems in both apps;
  - api Jest **116/116** (12 suites; final run after adding the C11/C13 tests); web Vitest **29/29**.
- `npm run build:api` exited 0. `npm run build:web` exited 0 (17 routes).
- New specs:
  - `auth/auth.service.spec.ts`: lockout, verify, reset, change, register, logout, MFA login, refresh, serializer;
  - `auth/strategies/jwt.strategy.spec.ts`;
  - `common/throttling/account-throttle.spec.ts`;
  - `email/email.templates.spec.ts`;
  - `config/env.validation.spec.ts`;
  - extended `password.util.spec.ts` and `token.util.spec.ts`.
- These are mocked-Prisma unit tests. The same flows against a real database (atomicity under concurrency, the actual HTTP 429) remain **unverified** until Phase 6.

## Phase 3 — Backend lifecycle (DONE)

**Changes**
- **Email change (§5.10):**
  - *Request:*
    - a cooldown keyed on the audit trail, so a taken target address cannot be detected;
    - only free targets receive a link, and any earlier pending change is cancelled either way;
    - the old address is always notified; the audit records the target masked.
  - *Confirm:*
    - one transaction claims the token, re-checks that the account is ACTIVE, and checks the target is still unclaimed;
    - then it updates the address, revokes all sessions plus credential-sensitive and verification tokens, and notifies both addresses;
    - a P2002 race rolls everything back, including the token claim.
- **Sessions (§5.11):**
  - session-cap eviction is oldest-first with an `id` tie-break, audited as `SESSION_LIMIT_REVOKED`;
  - single-session revoke is audited (`SESSION_REVOKED`);
  - new `POST /api/auth/logout-all` revokes every session including the caller's, clears the cookie and sends a notice.
- **MFA (§5.12):**
  - pending enrollment expires after 10 minutes (new nullable column `mfa_pending_created_at`, additive migration `20261016090000_mfa_pending_created_at`);
  - setup is audited;
  - disable accepts password plus TOTP **or** a recovery code (lost-device path), returns 400 when MFA is not enabled, and revokes other sessions and MFA challenges;
  - MFA enabled/disabled emails;
  - the global `Cache-Control: no-store` covers setup, enable and regenerate.
- **Admin MFA policy (§5.12, RECOMMENDED):**
  - `AUTH_ADMIN_MFA_REQUIRED`, default `true` in production only;
  - `RolesGuard` returns 403 `ADMIN_MFA_REQUIRED` for admins without MFA;
  - `/auth/mfa/*` is not role-gated, so a bootstrapped first admin can enroll;
  - the dashboard context reports `requiredActions: ['ENROLL_MFA_FOR_ADMIN']`.
- **Step-up:**
  - change-password requires TOTP for MFA users (DESIGN DECISION, see D6);
  - wrong step-up passwords count toward the sign-in lockout (D7).
- **Preferences (§3.1, §5.9):**
  - currency and time zone are checked against the runtime ICU lists (plus `UTC`);
  - closed sets for chart theme and training difficulty (DESIGN DECISION);
  - strict booleans, so the string `"false"` is rejected instead of coerced to `true`;
  - explicit field mapping (no DTO spread into Prisma).
- **Dashboard context (§5.9):**
  - each module now reports `permitted` and `available` separately;
  - capabilities are true only when both hold;
  - adds an experience-level notice that the level is not a suitability assessment.
- **Caching (§8):** `NoStoreMiddleware` sends `Cache-Control: no-store` and `Pragma: no-cache` on every API response, including e2e apps.

**Frontend follow-ups created by Phase 3 (for Phase 5):**
- a TOTP field for change-password when MFA is on;
- a recovery-code option on MFA disable;
- a "Sign out everywhere" action (`POST /auth/logout-all`);
- handling for `ADMIN_MFA_REQUIRED`, `EMAIL_CHANGE_COOLDOWN` (429) and `MFA_SETUP_EXPIRED`;
- consuming the new dashboard-context shape;
- select inputs for chart theme and difficulty, and alignment of currency/time-zone validation.

**Gate results (final Phase 3 run)**
- `npm run verify` exited 0: api Jest **141/141** (14 suites), web Vitest **29/29**, lint and typecheck clean.
- `npm run build:api` and `npm run build:web` exited 0.
- `prisma validate` OK; Prisma client regenerated.
- The new migration was generated with `prisma migrate diff` (schema-to-schema, no DB). It is **not yet applied** to any database (Phase 6).

## Phase 4 — Authorization, admin, operations (DONE)

**Changes**
- **Ownership policy (§6, §4.15):**
  - owner-only read/modify, so admins get no implicit access to private resources;
  - new `canExecuteSimulation` (owner plus per-user concurrency quota), `canManageLearningContent` and `canManageStressScenarios`;
  - `ownedBy()` query scoping;
  - the `assert*` helpers throw 404 `RESOURCE_NOT_FOUND` for both missing and foreign resources (403 `SIMULATION_QUOTA_EXCEEDED` only for the owner).
  - No resource module (portfolio, order, …) exists yet, so these are contracts for future modules.
- **Admin users (§7):**
  - `emailVerified` filter and stable `createdAt, id` sort;
  - limited detail view: no preferences, a security summary (locked, active sessions), and audit summary without context or actor IDs.
- **Admin status changes (§7):**
  - reason required (3–200 chars, trimmed);
  - no-op transitions rejected (400 `STATUS_UNCHANGED`);
  - reactivating an unverified account returns it to `PENDING_VERIFICATION`;
  - suspend/deactivate bumps `securityVersion` and revokes every session and every outstanding single-use token;
  - suspended / deactivated (by an administrator) / reactivated emails;
  - audit `from/to/reason` plus correlation ID.
- **Admin role changes (§7):**
  - step-up reuses `AuthService.assertStepUp` (password, plus TOTP when the admin has MFA; failures count toward lockout);
  - no-op changes rejected (400 `ROLE_UNCHANGED`);
  - audit `from/to`.
- **Last-admin invariant:** status and role changes run in a SERIALIZABLE transaction that counts the *other* active admins. A serialization failure (P2034) becomes 409 `CONCURRENT_UPDATE`. Demoting an already-suspended admin is no longer blocked by mistake.
- **Admin audit API:**
  - filters: `eventType`, `outcome`, `actorUserId`, `subjectUserId`, `from`/`to` (ISO 8601, validated order);
  - stable sort;
  - `context` reduced to an allowlist (no masked addresses, IP digests or session IDs).
  - The overview adds deactivated/MFA counts and 7-day per-event totals, and drops subject IDs from recent events.
- **Maintenance (§11):**
  - `MaintenanceService` plus `npm run maintenance -w @mtrs/api` (dry run by default, `-- --apply` deletes);
  - purges sessions and tokens expired or revoked beyond `AUTH_TOKEN_RETENTION_DAYS`, non-refresh tokens used beyond it, used recovery codes, and audit events beyond `AUTH_AUDIT_RETENTION_DAYS`;
  - used refresh tokens are kept until they expire so replays are still detected as reuse;
  - anonymised accounts are only counted, never hard-deleted;
  - an applied run is audited (`MAINTENANCE_PURGE`).
- **Observability (§11):**
  - an `AsyncLocalStorage` request context;
  - inbound correlation IDs must match `^[A-Za-z0-9._:-]{1,64}$` (otherwise a UUID is generated);
  - audit events pick up the correlation ID automatically;
  - `JsonLogger` (`LOG_FORMAT`, default `json` in production);
  - access log (method, path without query string, status, duration; no IP, headers or bodies);
  - the exception filter no longer logs query strings.
- **CSRF (§8):** fixed order:
  1. a present `Origin` must be allowlisted (including `null`);
  2. `Sec-Fetch-Site` `same-origin`/`none` passes and `cross-site` fails, while `same-site` alone is no longer trusted;
  3. the `Referer` origin must be allowlisted;
  4. no signal at all is allowed only outside production.
  The Bearer-only bypass is unchanged.
- **Dead code removed:** `mfa-encryption.util.ts`, `cookie.util.ts`, `jwt.util.ts` (+ its spec), `ip-hash.util.ts`, `skip-csrf.decorator.ts`, `types/authenticated-user.ts`, and the deprecated serializer aliases. `mfa-encryption.util.spec.ts` (which tested `mfa-crypto.util`) was renamed to `mfa-crypto.util.spec.ts`, with a tamper case added.
- **Web integration kept working:**
  - the admin user page requires a reason, offers an authenticator-code field for role changes, and shows the security summary and the pending-verification outcome;
  - admin API types and the client gained the `emailVerified` filter.
  - The e2e admin test now sends a reason and asserts suspension (access token rejected, filtered audit context).

**Gate results (final Phase 4 run)**
- `npm run verify` exited 0: api Jest **172/172** (16 suites), web Vitest **29/29**, lint and typecheck clean (including e2e specs).
- `npm run build:api` and `npm run build:web` exited 0.
- Not verified until Phase 6 (needs a DB): SERIALIZABLE behaviour under real concurrency, the maintenance script against a real DB, and the updated e2e admin assertions.

## Phase 5 — Frontend (DONE)

**Changes**
- **Security fixes:**
  - `sanitizeReturnTo` rejects whitespace, control characters, backslashes and `@` in both the raw and the decoded value, so `/%09/evil.com` no longer turns into `//evil.com` (F2);
  - `next.config.ts` sends global security headers, plus `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on `/verify-email`, `/reset-password` and `/confirm-email-change` (F6);
  - token pages remove the token from the address bar and consume it only when the user presses the button.
- **New routes:**
  - `/confirm-email-change` (F1);
  - `/admin/audit`, with filters for event type, outcome, account ID and date range;
  - `/settings`, which redirects to the profile page;
  - `not-found.tsx`, `error.tsx` and `global-error.tsx` (F7).
- **Step-up and dialogs (F3, F4):**
  - `ConfirmDialog` renders its fields *inside* the panel, with a focus trap, focus restored on close, initial focus on the first field or on Cancel (never on the destructive button), Enter to submit, and an inline error;
  - `StepUpFields` / `useStepUp` add the password plus an authenticator code when MFA is on (and a recovery-code option on MFA disable) to:
    - change password and change email;
    - MFA disable and recovery-code regeneration;
    - revoke other sessions;
    - deactivate and delete (delete also requires typing `DELETE`).
- **MFA:**
  - login allows one attempt per challenge, then returns to the password step with an explanation (F5);
  - the enrollment card shows status, remaining recovery codes with a low-codes warning, setup expiry, `MFA_SETUP_EXPIRED` handling and regeneration (F8).
- **Auth state (F10):**
  - a refresh now pushes the returned user into the provider, so role and status changes show up;
  - `refreshUser` signs out only on 401, not on network errors;
  - logins and logouts are broadcast across tabs, and each broadcast closes its channel;
  - the protected-route redirect keeps the query string.
- **Errors (F12):** `describeApiError` maps backend codes to English messages and appends server validation `details`. A network `TypeError` becomes a connectivity message.
- **Pages:**
  - the dashboard uses `/users/me/dashboard-context`: modules, the experience notice and the admin-MFA banner (F9);
  - the profile page shows an account card (verified badge, member since, last sign-in, MFA) (F13);
  - profile currency and time-zone selects are populated from `Intl`, and there are selects for chart theme and difficulty. The notification toggles state truthfully that they are stored but not yet used;
  - `/settings/security` has a session summary card (F14);
  - `/settings/sessions` has "Sign out everywhere" (`POST /auth/logout-all`).
- **Admin (F11):**
  - status and role changes use confirmation dialogs, and role changes include step-up;
  - controls targeting your own account are disabled, as are options that would leave the value unchanged;
  - the user detail page has a loading state;
  - the user list has a debounced search (350 ms), an email-verified filter and accessible pagination;
  - the overview shows deactivated and MFA counts plus 7-day event totals.
- **Polish (F16):**
  - account menu: arrow keys, Home, End and Escape navigation, focus returned to the trigger, and router navigation after sign-out;
  - disabled navigation items are announced as "not available yet";
  - landing and login pages no longer flash their forms for signed-in users;
  - a 60-second "Send again" countdown on resend-verification and forgot-password;
  - `reduceMotion` / `highContrast` preferences are applied to `<html>`;
  - every page uses `describeApiError`.
- **Bug found by the new component tests:** after a password sign-in, the MFA code field came up pre-filled with the email address. React reused the email `<input>` DOM node when the password form was swapped for the MFA form. Each step's form now has its own `key`.
- **Dependency fix:** the web workspace had `react@19.0.0` installed alongside `react-dom@19.3.1`, a mismatch React DOM rejects at runtime outside Next's bundled copy. Both are now `^19.1.0`, resolving to 19.3.1.
- **Test tooling (D15):** added dev-only `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` and `jsdom`. Vitest now runs two projects: `unit` (node, `*.test.ts`) and `dom` (jsdom, `*.test.tsx`).

**New web tests** (29 → 67)
- `components/ui/ConfirmDialog.test.tsx`: initial focus, Escape and focus restore, Tab trap, Enter submits, busy state.
- `app/login/page.test.tsx`:
  - safe and unsafe `returnTo`;
  - generic error and password cleared;
  - resend link for unverified accounts;
  - MFA success;
  - MFA failure returns to the password step;
  - no form shown to a signed-in user.
- `components/auth/ProtectedRoute.test.tsx`: loading, anonymous redirect with query string, allowed user, wrong role, blocked status, email verification required.
- `app/confirm-email-change/page.test.tsx`: token stripped without being consumed, consumed on click, invalid link, missing token.
- `components/layout/ProfileDropdown.test.tsx`: keyboard navigation, admin-only entry, sign-out.
- Unit tests: `lib/api/errors.test.ts`, plus extended `returnTo.test.ts` and `client.test.ts`.

**Gate results (final Phase 5 run)**
- `npm run verify` exited 0: api Jest **172/172** (16 suites), web Vitest **67/67** (9 files), lint and typecheck clean in both apps.
- `npm run build:api` and `npm run build:web` exited 0 (20 routes). The known benign "Next.js plugin was not detected" warning is unchanged.
- Not verified:
  - the security, sessions, profile, dashboard and admin pages compile and build, but have no component tests;
  - response headers from `next.config.ts` are not asserted over HTTP;
  - there is no browser E2E (Playwright/Cypress is not installed), and a full register → verify → login flow against the real API needs B1.

## Phase 7 — Docs, coverage report, hardening found while documenting (DONE)

**Docs rewritten from the source** (the previous versions described behaviour from before Phases 2–5):
- `docs/identity-api-contract.md`: route table, bodies, response shapes, error codes.
- `docs/identity-security-decisions.md`: every §14 question, the mechanisms, an access/policy matrix and a clarification register.
- `docs/identity-delivery-status.md`: the final status table (§15.8), commands and outcomes, fresh-setup steps including local SMTP, **the unverified-feature list**, and remaining risks.

**Defects found and fixed while checking the docs against the code:**
- **Destructive e2e default:** `test/auth.e2e-spec.ts` deletes every row between tests but used `DATABASE_URL`, i.e. the development database. The new `test/e2e-database-guard.ts` (jest `setupFiles`) requires `E2E_DATABASE_URL` with a database name ending in `_test`, then swaps it in. Both refusal paths were executed (D19).
- **Admin seed takeover path:** `seed-admin.ts` elevated *any* existing account for the bootstrap email to ACTIVE, verified ADMIN, keeping its password. Someone who pre-registered that address (unverified) would have become admin, and the seed also reactivated suspended or deactivated accounts. It now elevates only active, verified, non-deleted accounts, bumps `securityVersion`, and audits `ADMIN_ROLE_CHANGE` / `ADMIN_BOOTSTRAPPED` with `via: bootstrap` (D20).
- **Dependencies:**
  - `nodemailer` 6.10.1 had 15 high-severity advisories, including delivery to attacker-controlled domains through address parsing. It was upgraded to 10.1.1, which ships its own types, so `@types/nodemailer` was removed. The same `createTransport` / `sendMail` calls were smoke-tested.
  - Two advisories remain and are documented: js-yaml (pinned by `@nestjs/swagger`) and postcss (via Next 15; the fix needs Next 16).

**Gate results (final run)**
- `npm run verify` exited 0: api **172/172**, web **67/67**, lint and typecheck clean.
- `npm run build:api` and `npm run build:web` exited 0 (20 routes), both re-run after the dependency changes.
- `prisma migrate status` still fails with P1000 and Docker is still stopped, so Phase 6 remains **BLOCKED (B1)**.

## Emergency recovery — Swagger and degraded startup (DONE)

**Root cause:** `PrismaService.onModuleInit` awaited `$connect()`. With PostgreSQL rejecting the `mtrs` credentials (P1000), Nest aborted bootstrap after mapping routes, so nothing listened on 3001 and `/api/docs` was unreachable.

**Fixes:**
- **Prisma connection:** outside production, a failed startup connect is logged as a warning and the API starts anyway. Production still fails fast. `PrismaService.isReachable()` runs `SELECT 1`.
- **Exception filter:** Prisma connection errors (initialization error, P1000/P1001/P1002/P1008/P1017/P2024) map to `503 DATABASE_UNAVAILABLE` with a generic message. Other Prisma errors are unchanged (P2002 is still 500).
- **Health endpoint:** public `GET /api/health` reports database up/down (200/503) in the new `HealthModule`.
- **Swagger:**
  - built only when `app.swaggerEnabled` is set (`SWAGGER_ENABLED`, defaulting to true outside production and false in production);
  - title "Market Trading Room Simulator API", version 1.0.0, HTTP bearer JWT scheme, tags auth/users/admin/health;
  - the `@nestjs/swagger` CLI plugin in `nest-cli.json` adds DTO properties, enums, lengths and query params;
  - `common/swagger/openapi.ts` adds a shared `ErrorResponse` schema with 400/401/403/429/503 responses;
  - JSON is served at `/api/docs-json`.
- **CSRF guard:** also trusts the API's own origin, so Swagger "Try it out" works. Look-alike hosts and scheme changes are still rejected (unit-tested).
- **Middleware routes:** `forRoutes({ path: '{*splat}' })` removes the path-to-regexp v8 legacy-route warnings.
- **Helmet:** CSP stays enabled; `upgrade-insecure-requests` is dropped only outside production, so Swagger loads over plain-HTTP localhost.

**Verified:**
- `npm run verify` exited 0: api **178/178**, web **67/67**.
- `npm run build:api` and `npm run build:web` exited 0.
- HTTP checks with the DB down:
  - `/api/docs` and the Swagger assets return 200;
  - `/api/docs-json` is OpenAPI 3.0.0 (32 paths, 20 schemas);
  - `/api/health` returns 503 degraded;
  - login returns 503 `DATABASE_UNAVAILABLE`, from both Swagger and the web login page;
  - `/api/admin/users` without a token returns 401.

## Transactional email (DONE; real inbox delivery BLOCKED)

Details: `docs/transactional-email-flows.md`, `docs/transactional-email-setup.md`, `docs/transactional-email-test-report.md`.

- [x] Phase 0 audit: endpoint → service → token transaction → mail → page → POST map and gap checklist
- [x] `MailTransport` adapter: `preview` (RFC 5322 `.eml` to git-ignored `apps/api/.mail-preview/`) and `smtp` (Nodemailer, TLS 1.2+, STARTTLS required in production, timeouts, 2 bounded retries on transient errors)
- [x] Loopback-only preview inbox (`npm run mail:inbox`, 127.0.0.1:3025, Host check, sandboxed rendering, refuses production)
- [x] Boot-time `transporter.verify()` and operator `npm run mail:verify [-- --to …]`; log lines distinguish CAPTURED / SMTP-ACCEPTED / failed
- [x] Production env guards (no preview, no loopback relay, no reserved sender domain, no plaintext SMTP, user needs password); `apps/api/.env.example` created
- [x] Dark MTRS template system with preheaders for all 19 messages (including the new welcome email and recovery-codes-regenerated notice); copy checked against the services
- [x] Frontend token pages: scanner-safe (POST on click), token stripped from URL, `no-referrer` + `no-store` (verified in a browser)
- [x] Tests: template/transport/service/env units, DB e2e on `PIF_test`, Edge browser E2E 49/49, manual acceptance with a throwaway account
- [ ] Real SMTP acceptance and inbox delivery: BLOCKED—SMTP CREDENTIALS / VERIFIED SENDER NEEDED

## Requirement checklist (mapped to the master prompt)

Status legend: DONE (implemented and verified by an executed test), IMPL (implemented, not verified by an executed test), PARTIAL, MISSING, BLOCKED.

Built from two read-only audits run in Phase 0: the backend audit (agent `ecba39f6`) and the frontend audit (agent `2c6b1e5c`). Every P0 item was re-checked against the source before work started. The tables list only open gaps; requirements both audits found correctly implemented are summarized at the end of this section. A status of **IMPL** means the code exists but no executed test covers it yet, usually because DB e2e is blocked.

### Phase 2 — Backend core auth (§4, §5.1–5.8, §4.16)

| ID | § | Requirement / defect | Prio | Status |
|---|---|---|---|---|
| C1 | 5.4 | Lockout checked **after** password verification, so a locked account still reveals whether the password was correct | P0 | DONE (unit) |
| C2 | 5.2 | `verifyEmail` sets ACTIVE unconditionally; register-duplicate sends verification to suspended/deactivated unverified accounts (suspension bypass) | P0 | DONE (unit) |
| C3 | 5.8 | Reset/change-password leave EMAIL_CHANGE and MFA challenge tokens valid (takeover persists after recovery) | P0 | DONE (unit: reset; change shares the helper) |
| C4 | 4.8/4.14 | Lockout blocks existing sessions (JwtStrategy and refresh), so an attacker can force-logout any user | P1 | DONE (unit: strategy + refresh) |
| C5 | 4.14 | Failed-login counter is non-atomic read-modify-write | P1 | DONE (unit) |
| C6 | 4.14 | No rate limit by normalized account identifier; account-exists email has no cooldown | P1 | DONE (unit: tracker/skip + notice cooldown); real 429 path IMPL |
| C7 | 4.13 | Register duplicate path skips Argon2 (timing oracle) | P1 | DONE (unit) |
| C8 | 4.16 | Startup validation missing: TTL format, CORS wildcard/https, SameSite=None + Secure, frontend URL https, MFA key strength, previous JWT secret, strict booleans | P1 | DONE (unit, 20 cases) |
| C9 | 5.7 | Logout's Bearer branch is dead (route is public), so Bearer-only logout revokes nothing | P2 | DONE (unit) |
| C10 | 4.9 | Single-use token consumed outside the effect transaction; reuse revocation not transactional | P2 | DONE (unit, mocked tx) |
| C11 | 5.5 | `verifyMfaLogin` does not re-check status/lock before issuing a session | P2 | DONE (unit) |
| C12 | — | Step-up failures return 401, so the web client misreads them as expired access and refreshes | P2 | DONE (unit, backend) |
| C13 | 2/4.5 | Change-password response leaks `sessionId`; public user exposes `securityVersion` | P2 | DONE (serializer unit; controller strip IMPL) |
| C14 | 3.2 | IP digest uses spoofable raw `X-Forwarded-For`; no `trust proxy` setting | P2 | IMPL (validator unit-tested; runtime req.ip unverified) |
| C15 | 4.3 | Common-password blocklist has about 45 entries, which is not a curated list | P1 | WITHDRAWN (blocklist removed for the simplified demo policy) |

### Phase 3 — Backend lifecycle (§5.9–5.13, emails)

| ID | § | Requirement / defect | Prio | Status |
|---|---|---|---|---|
| L1 | 5.10 | No old/new notifications on email-change confirm; confirm does not revoke PASSWORD_RESET; no request cooldown | P1 | DONE (unit) |
| L2 | 5.11 | Session-cap and single-session revocations not audited; `sendSessionsRevoked` passes the wrong argument as first name | P1 | DONE (unit: cap eviction audit; single-revoke audit IMPL) |
| L3 | 4.12 | No logout-all (including the current session) mechanism | P1 | DONE (unit; route IMPL) |
| L4 | 5.12 | Pending MFA setup never expires; MFA-disable notification missing; setup/enable/regenerate lack `Cache-Control: no-store` | P1 | DONE (unit: expiry, recovery-code disable, notices); no-store IMPL |
| L5 | 5.12 | Admin MFA mandatory in production (RECOMMENDED) plus a safe first-admin enrollment path | P1 | DONE (unit: guard + context) |
| L6 | 9 | Emails: no expiry statements; invented "contact support"; no lockout alert; greetings never use the first name; security notices end with "you can ignore" | P1 | DONE in Phase 2 (unit) |
| L7 | 3.1 | Preference DTO: booleans not `@IsBoolean`, timezone not checked against IANA, free-form theme/difficulty strings | P1 | DONE (unit, 10 cases) |
| L8 | 5.9 | Dashboard-context `capabilities` contradict `modules[].available` | P2 | DONE (unit) |
| L9 | 11 | `no-store` missing on `/me`, sessions, preferences and admin responses | P1 | IMPL (global middleware; header not yet asserted over HTTP) |

### Phase 4 — Authorization, admin, operations (§6, §7, §11)

| ID | § | Requirement / defect | Prio | Status |
|---|---|---|---|---|
| A1 | 6 | `canReadOwnResource` lets admins read others' private resources (spec: admins do not by default) | P1 | DONE (unit) |
| A2 | 6 | Missing `canExecuteSimulation`, `canManageLearningContent`, `canManageStressScenarios`, and a per-user quota guard contract | P1 | DONE (unit; no resource module consumes it yet) |
| A3 | 4.15 | `assert*` helpers throw plain `Error` (becomes 500); must be 404 `RESOURCE_NOT_FOUND` | P1 | DONE (unit) |
| A4 | 7 | Admin list: no `emailVerified` filter, no stable tie-break sort | P1 | DONE (unit) |
| A5 | 7 | Status change: reason optional; suspension does not revoke single-use tokens | P1 | DONE (unit; e2e assertion written, BLOCKED by B1) |
| A6 | 7 | Role change: no MFA step-up; last-admin check-then-act race | P1 | DONE (unit, mocked SERIALIZABLE tx); real-DB concurrency unverified |
| A7 | 7 | Audit events: only an `eventType` filter; raw `context` returned (PII minimization); admin audits lack correlation id | P1 | DONE (unit) |
| A8 | 11 | No maintenance cleanup job for expired tokens/sessions with forensic retention; retention variables unused | P1 | DONE (unit); script not run against a DB |
| A9 | 11 | No structured logs; correlation id accepted without a charset check | P2 | DONE (unit) |
| A10 | 8 | CSRF guard trusts `same-site` blindly and checks Fetch Metadata before the Origin allowlist | P2 | DONE (unit, 8 cases) |
| A11 | — | Dead/duplicate code: `mfa-encryption.util.ts`, `cookie.util.ts`, `jwt.util.ts`, `ip-hash.util.ts`, `skip-csrf.decorator.ts`, `authenticated-user.ts`, unused helpers | P2 | DONE |

### Phase 5 — Frontend (§8 client, §9, §13 frontend)

| ID | § | Requirement / defect | Prio | Status |
|---|---|---|---|---|
| F1 | 5.10/9 | No `/confirm-email-change` page; email-change links 404 | P0 | DONE (component test) |
| F2 | 8 | Open redirect: `/%09/evil.com` passes `sanitizeReturnTo` | P0 | DONE (unit + login component test) |
| F3 | 9 | Step-up password inputs sit behind the ConfirmDialog overlay (deactivate, delete, revoke others) | P0 | DONE (ConfirmDialog component test); page wiring IMPL |
| F4 | 5.10–5.13 | MFA users cannot change email, revoke others, deactivate or delete (no `totpCode` input) | P0 | IMPL (typecheck/build; no page-level test) |
| F5 | 5.5 | MFA login retry reuses a consumed challenge | P1 | DONE (component test) |
| F6 | 8 | `Referrer-Policy: no-referrer` missing on email-token pages | P1 | IMPL (headers configured; not asserted over HTTP) |
| F7 | 9 | No `not-found.tsx`, `error.tsx`, `global-error.tsx` | P1 | IMPL (present in build output) |
| F8 | 5.12 | No recovery-code regeneration UI; MFA status/remaining codes not shown | P1 | IMPL |
| F9 | 5.9/9 | Dashboard ignores `/users/me/dashboard-context` | P1 | IMPL |
| F10 | 8 | Refreshed user discarded, so role/status changes are not reflected; logins not broadcast across tabs; BroadcastChannel leak | P1 | DONE (unit: session listener); cross-tab broadcast IMPL |
| F11 | 7/9 | Admin status/role forms lack confirmation; reason optional; no loading state; self-targeted controls not disabled | P1 | IMPL (audit-log page added) |
| F12 | 9 | Server validation `details` dropped by the client | P1 | DONE (unit) |
| F13 | 9 | Profile lacks verified indicator and account activity | P1 | IMPL |
| F14 | 9 | No session overview on `/settings/security` | P1 | IMPL |
| F15 | 13 | Frontend flow tests (register→verify→login→dashboard→logout, etc.) and browser E2E | P1 | PARTIAL (jsdom component tests for login/MFA, route guard, email-change confirm, dialog, menu; no browser E2E tooling; the full real-API flow needs B1) |
| F16 | 9 | Polish: resend cooldown UX, landing/login flash, `returnTo` drops the query string, `refreshUser` signs out on network errors, admin search debounce, dialog focus trap, menu keyboard, disabled-nav announcement, `/settings` index, delete copy, `<Link>` usage, reduceMotion/highContrast applied | P2 | DONE for focus trap, menu keyboard, returnTo query string and login flash (component tests); the rest IMPL |

### Phase 6 — DB-backed verification (§12 Slice G, §13)

| ID | Requirement | Status |
|---|---|---|
| V1 | `prisma migrate deploy` against a real DB | WORKING (`PIF` and `PIF_test`) |
| V2 | API e2e suite (register/verify/login/refresh/reuse/concurrency/admin) on an isolated `_test` DB | WORKING (`PIF_test`, 14/14 incl. email flows) |
| V3 | Concurrency tests: parallel token consumption, parallel refresh, recovery-code race | PARTIAL (parallel verify-email and parallel refresh tested on `PIF_test`; recovery-code race not tested) |
| V4 | Local email capture | WORKING without Docker (`MAIL_TRANSPORT=preview` + `npm run mail:inbox`); real inbox delivery BLOCKED (SMTP credentials / verified sender) |

### Already implemented (confirmed by the audits)

- **Data and email:** citext unique email with P2002 race handling; email normalization in every flow.
- **Passwords and tokens:** Argon2id (19 MiB / t=2 / p=1); HMAC-peppered 32-byte opaque tokens; atomic single-use consumption.
- **Sessions and refresh:**
  - stable `AuthSession` `sid`;
  - per-request DB reload of user, role, session and `securityVersion`;
  - refresh rotation in one transaction, with reuse detection and a 15-second concurrent-tab grace window;
  - session cap; HttpOnly `mtrs_refresh` cookie scoped to `/api/auth`.
- **MFA:** AES-256-GCM-encrypted secrets; TOTP replay guard; Argon2 recovery codes.
- **Request protection:** CSRF Origin / Fetch-Metadata guard; global JWT guard with `@Public` opt-out; Helmet; CORS allowlist; Swagger disabled in production.
- **Admin:** last-admin / self-demotion protection; admin overview with real counts; opt-in admin seed.
- **Frontend:** in-memory access token; single-flight refresh; every API path, method and field name matches the backend DTOs.

## Files modified (cumulative, this session)

| Phase | File | Change |
|---|---|---|
| 0 | `docs/master-prompt.md` | New: verbatim brief |
| 0 | `IMPLEMENTATION_PROGRESS.md` | New: this file |
| 1 | `apps/api/eslint.config.mjs` | New |
| 1 | `apps/web/eslint.config.mjs` | New |
| 1 | `apps/web/.eslintrc.json` | Deleted (legacy format, unusable with ESLint 9) |
| 1 | `apps/web/next.config.ts` | Lint bypass removed |
| 1 | `apps/api/src/main.ts` | Handles bootstrap failure |
| 1 | `package.json`, `apps/api/package.json`, `apps/web/package.json` | Scripts and dev dependency declarations |
| 1 | `apps/web/vitest.config.mts` | New |
| 1 | `apps/web/src/lib/**/*.test.ts` (3 files) | New tests |
| 1 | `apps/api/src/common/filters/http-exception.filter.spec.ts` | Log silenced |
| 2 | `apps/api/src/auth/auth.service.ts` | Lockout order + atomic counter, verify/reset/change/register/logout/refresh/MFA-login fixes, step-up 403, email call sites |
| 2 | `apps/api/src/auth/auth.controller.ts` | Bearer-aware logout, `AccountThrottle` on 4 routes, `sessionId` stripped |
| 2 | `apps/api/src/auth/strategies/jwt.strategy.ts` | Lock no longer blocks existing sessions |
| 2 | `apps/api/src/admin/admin.service.ts` | Role-change reauth failure → 403 |
| 2 | `apps/api/src/common/throttling/account-throttle.ts` (+ spec) | New per-account throttler |
| 2 | `apps/api/src/app.module.ts` | Registers named `default` + `account` throttlers |
| 2 | `apps/api/src/common/crypto/password-blocklist.ts`, `password.util.ts`, `token.util.ts` (+ specs) | Policy screening, `parseDurationMs`, removed unused `tokensEqual` |
| 2 | `apps/api/src/config/env.validation.ts`, `configuration.ts` (+ new spec), `main.ts` | `assertSafeConfiguration`, strict booleans, `TRUST_PROXY` |
| 2 | `apps/api/src/common/serializers/user.serializer.ts` | `securityVersion` no longer public |
| 2 | `apps/api/src/email/email.templates.ts`, `email.service.ts` (+ new spec) | Rewritten templates and service API |
| 2 | `apps/api/src/auth/auth.service.spec.ts`, `strategies/jwt.strategy.spec.ts` | New unit tests |
| 2 | `.env.example` | `TRUST_PROXY`, CORS and `EMAIL_SUPPORT_URL` guidance |
| 3 | `apps/api/src/auth/auth.service.ts`, `auth.controller.ts` | Email change, sessions, logout-all, MFA lifecycle, step-up options, dashboard context, preferences mapping |
| 3 | `apps/api/src/auth/dto/auth.dto.ts` (+ new `preferences.dto.spec.ts`) | Preference validation, `totpCode` on change-password, `recoveryCode` on MFA disable |
| 3 | `apps/api/src/auth/guards/roles.guard.ts` (+ new spec) | Admin MFA policy |
| 3 | `apps/api/src/common/middleware/no-store.middleware.ts`, `app.module.ts` | Global no-store |
| 3 | `apps/api/prisma/schema.prisma`, `prisma/migrations/20261016090000_mfa_pending_created_at/` | Additive nullable column |
| 3 | `apps/api/src/config/configuration.ts`, `env.validation.ts`, `.env.example` | `AUTH_ADMIN_MFA_REQUIRED` |
| 3 | `apps/api/src/email/*` | Session-notice scopes |
| 4 | `apps/api/src/common/policies/ownership.policy.ts` (+ spec rewritten) | Owner-only policies, simulation quota, 404 assertions, `ownedBy` |
| 4 | `apps/api/src/admin/admin.service.ts`, `admin.controller.ts`, `admin.module.ts` (+ spec rewritten) | Filters, sort, limited views, reason/step-up, SERIALIZABLE last-admin, audit allowlist, emails |
| 4 | `apps/api/src/auth/auth.service.ts` | `assertStepUp` public; email-change audit keys renamed (`previousAddress`/`newAddress`) |
| 4 | `apps/api/src/auth/guards/csrf.guard.ts` (+ new spec) | Origin-first verification order |
| 4 | `apps/api/src/maintenance/*` (new, + spec), `src/scripts/maintenance.ts` (new), `apps/api/package.json` | Retention purge and `maintenance` script |
| 4 | `apps/api/src/common/request-context.ts`, `common/logging/json-logger.ts`, `common/middleware/access-log.middleware.ts` (new, + `observability.spec.ts`) | Correlation context, JSON logs, access log |
| 4 | `apps/api/src/common/middleware/correlation-id.middleware.ts`, `audit/audit.service.ts`, `common/filters/http-exception.filter.ts`, `main.ts`, `app.module.ts`, `config/*` | Charset check, automatic audit correlation, no query strings in logs, `LOG_FORMAT` |
| 4 | Deleted: `common/crypto/{mfa-encryption.util,cookie.util,jwt.util,jwt.util.spec,ip-hash.util}.ts`, `common/decorators/skip-csrf.decorator.ts`, `common/types/authenticated-user.ts` | Dead code; `mfa-encryption.util.spec.ts` renamed to `mfa-crypto.util.spec.ts` |
| 4 | `apps/api/src/common/serializers/user.serializer.ts` | Deprecated aliases removed |
| 4 | `apps/api/test/auth.e2e-spec.ts` | Admin status change with reason, suspension and audit-filter assertions |
| 4 | `apps/web/src/app/admin/users/[id]/page.tsx`, `lib/api/admin.ts`, `lib/api/types.ts` | Required reason, TOTP field, security summary, new response types |
| 4 | `.env.example` | `LOG_FORMAT`, maintenance usage |
| 5 | `apps/web/src/lib/auth/returnTo.ts`, `lib/auth/AuthProvider.tsx`, `lib/api/{client,auth,users,mfa,sessions,admin,types}.ts`, `lib/api/errors.ts` (new), `lib/hooks/useCooldown.ts` (new), `lib/validation/schemas.ts` | Open-redirect fix, user sync and cross-tab events, error mapping, new endpoints, cooldown hook |
| 5 | `apps/web/src/components/ui/ConfirmDialog.tsx`, `components/auth/{StepUpFields (new),MfaEnrollment,ProtectedRoute}.tsx`, `components/layout/{ProfileDropdown,AppShell}.tsx` | Dialog fields and focus trap, step-up, MFA lifecycle, menu keyboard, disabled-nav announcement |
| 5 | `apps/web/src/app/{login,register,verify-email,reset-password,forgot-password,resend-verification,dashboard,page}.tsx` and `app/settings/{profile,security,sessions}/page.tsx` | MFA single attempt + form keys, error mapping, cooldowns, dashboard context, step-up dialogs, account card |
| 5 | New: `app/confirm-email-change/page.tsx`, `app/admin/audit/page.tsx`, `app/settings/page.tsx`, `app/{not-found,error,global-error}.tsx` | New routes |
| 5 | `apps/web/src/app/admin/{page,layout,users/page,users/[id]/page}.tsx` | Confirmations, debounce, filters, audit link |
| 5 | `apps/web/next.config.ts`, `app/globals.css` | Security headers; definition lists, reduce-motion, high-contrast |
| 5 | `apps/web/vitest.config.mts`, `apps/web/package.json`, `package-lock.json` | `unit` + `dom` projects; testing-library + jsdom dev deps; React aligned with React DOM |
| 5 | New tests: `ConfirmDialog.test.tsx`, `login/page.test.tsx`, `ProtectedRoute.test.tsx`, `confirm-email-change/page.test.tsx`, `ProfileDropdown.test.tsx`, `lib/api/errors.test.ts` | Component and unit tests |
| 7 | `docs/identity-api-contract.md`, `docs/identity-security-decisions.md`, `docs/identity-delivery-status.md` | Rewritten from source |
| 7 | `apps/api/test/e2e-database-guard.ts` (new), `apps/api/test/jest-e2e.config.ts`, `.env.example` | e2e restricted to `*_test` databases via `E2E_DATABASE_URL` |
| 7 | `apps/api/src/scripts/seed-admin.ts` | Elevation restricted to active, verified accounts; audited |
| 7 | `apps/api/package.json`, `package-lock.json` | nodemailer ^10.1.1, `@types/nodemailer` removed |

## Blockers and decisions

| ID | Type | Description | Needed from user |
|---|---|---|---|
| B1 | BLOCKER | No reachable database for the project. Docker engine is stopped, and the native PostgreSQL 18 service has no `mtrs` role/database (re-checked at the end of Phase 7: still P1000). Blocks `prisma migrate`, e2e, concurrency tests and Mailpit email checks. | Either start Docker Desktop (and remap the compose port, since 5432 is taken by the native service), **or** create the role and the `mtrs` / `mtrs_test` databases on the native server (commands in `docs/identity-delivery-status.md` §3). Then Phase 6 can run. |
| D1 | DESIGN DECISION | Web lint uses individual plugins instead of the `eslint-config-next` wrapper (parser resolution issue under workspace hoisting). | — |
| D2 | DESIGN DECISION | Vitest added for web unit tests (minimal new tooling, §13 allows it). Browser E2E (Playwright) is not installed yet (see D15). | — |
| D3 | DESIGN DECISION | Lockout = 401 `INVALID_CREDENTIALS` (indistinguishable from a wrong password), pauses new sign-ins only, emails the owner once per lock. Account-status errors (suspended/unverified) are still disclosed, but only after a correct password. | — |
| D4 | DESIGN DECISION | Per-account throttle limits: login 20 / 15 min; register, resend-verification and forgot-password 3 / 15 min. These are in-memory, per instance; multi-instance deployments need a shared throttler store (RECOMMENDED EXTENSION). | — |
| D5 | DESIGN DECISION | Step-up (reauthentication) failures return 403, so 401 always means "access token unusable" to the client. | — |
| D6 | DESIGN DECISION | Change-password requires a TOTP code when MFA is enabled (§5.8 says "consider step-up MFA"). | — |
| D7 | DESIGN DECISION | Wrong passwords on step-up endpoints count toward the sign-in lockout (a hijacked access token cannot brute-force the password). | — |
| D8 | DESIGN DECISION | Pending MFA enrollment TTL is 10 minutes; preference enums: chart theme `trading_desk/light/dark`, difficulty `adaptive/beginner/intermediate/advanced`. | — |
| D9 | RECOMMENDED | Admin MFA is mandatory in production by default (`AUTH_ADMIN_MFA_REQUIRED`). This is a recommended policy, not a client requirement. | — |
| D10 | DESIGN DECISION | Admin status reason: 3–200 characters, stored in the audit trail and visible to admins. An admin-reactivated account that never verified its email returns to `PENDING_VERIFICATION` instead of `ACTIVE`. | — |
| D11 | DESIGN DECISION | Last-admin protection uses SERIALIZABLE isolation and surfaces conflicts as 409 `CONCURRENT_UPDATE` (the client retries), not automatic retries. | — |
| D12 | DESIGN DECISION | The admin audit view exposes only allowlisted context keys; masked addresses, IP digests and session IDs stay database-only. | — |
| D13 | NEEDS APPROVAL | Retention windows (30-day tokens, 365-day audit) are defaults only. Hard deletion of anonymised accounts is deliberately not implemented: the maintenance job only reports them. | Legal/product approval of retention periods |
| D14 | DESIGN DECISION | Maintenance runs as a CLI for an external scheduler (cron / CronJob) instead of an in-process timer, so multi-instance deployments do not run it concurrently. | — |
| D15 | DESIGN DECISION | Frontend component tests use Testing Library + jsdom under Vitest (minimal tooling, §13). Browser E2E (Playwright) is still not installed: it needs browser binaries and a running API + DB (B1). | Approve adding Playwright if browser E2E is wanted |
| D16 | DESIGN DECISION | Each MFA login challenge allows exactly one attempt (the backend consumes it). The UI returns to the password step on failure instead of offering a retry that is bound to fail. | — |
| D17 | DESIGN DECISION | `notifyEmailSecurity` / `notifyMarketDigest` are stored but not consulted: security emails are always sent, and there is no market digest. The profile UI says so. | — |
| D18 | DESIGN DECISION | Resend-verification and forgot-password pace the button with a 60-second client countdown. This is UX only; the API throttles are authoritative. | — |
| D19 | DESIGN DECISION | The e2e suite only runs against `E2E_DATABASE_URL` with a database name ending in `_test`, never the development `DATABASE_URL`. | Create `mtrs_test` (see B1) |
| D20 | DESIGN DECISION | `seed:admin` never elevates an unverified, suspended, deactivated or deleted account; those must be resolved through normal flows first. | — |
