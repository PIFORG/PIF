# Documentation historique — stack remplacée

> **État actuel :** l'application active est **Angular** (pps/web) + **Spring Boot** (pps/api) + **PostgreSQL**.
> NestJS / Next.js / React / Prisma Client ne font plus partie du runtime applicatif.
> Voir README.md, docs/architecture/LEGACY_CLEANUP_AUDIT.md et docs/ui/DESIGN_SYSTEM.md.
# Identity delivery status — Market Trading Room Simulator

This document reports only what was executed. "Unit" means Jest or Vitest with mocked I/O. "Component" means a Vitest + jsdom render of real React components with the API mocked. "E2E" means the Supertest suite against a real PostgreSQL database, **which has never been run** (blocker B1). Phase-by-phase detail lives in `IMPLEMENTATION_PROGRESS.md`.

## 1. Final status

**Legend:**
- **Complete:** implemented, and verified by an executed test at the level listed.
- **Code complete:** implemented and type-checked, but the key behaviour has not been executed against a real DB, SMTP or browser.
- **Blocked:** needs external setup.

| Requirement | Backend | Frontend | Executed tests | Status |
|---|---|---|---|---|
| Registration (generic response, Argon2 before lookup, notice cooldown) | Yes | Yes | Unit | Code complete (DB race untested) |
| Email verification / resend (single-use, transactional claim, 60 s pacing) | Yes | Yes (token stripped, button-only, countdown) | Unit + component (confirm-email-change pattern) | Code complete |
| Login, lockout without an oracle, per-account throttle | Yes | Yes | Unit + component (login page) | Code complete (real 429 untested) |
| Access JWT plus DB reload per request | Yes | In-memory token | Unit | Complete at unit level |
| Refresh rotation, reuse detection, 15 s tab grace | Yes | Single-flight + retry | Unit (api + web client) | Code complete (parallel DB race untested) |
| Logout / logout-all / revoke device / revoke others | Yes | Yes | Unit | Code complete |
| Forgot / reset / change password | Yes | Yes | Unit | Code complete |
| Email change (step-up, cooldown, confirm, notices) | Yes | Yes | Unit + component (confirm page) | Code complete |
| MFA: enrollment, login challenge, recovery codes, replay guard, disable, regenerate | Yes | Yes | Unit + component (MFA login) | Code complete |
| Profile, preferences, dashboard context | Yes | Yes | Unit (DTO validation) | Code complete |
| Deactivate / delete (step-up, typed confirmation) | Yes | Yes | Unit | Code complete |
| RBAC + admin MFA policy | Yes | Route guard + nav gate | Unit + component (ProtectedRoute) | Code complete |
| Ownership policies (404 for foreign, quota contract) | Yes (contracts) | n/a | Unit | Complete as contracts; no resource module consumes them yet |
| Admin users / status / role / audit (reason, step-up, last-admin SERIALIZABLE) | Yes | Yes (dialogs, audit page) | Unit; e2e written, not run | Code complete (real concurrency untested) |
| Audit trail + allowlisted admin view | Yes | Yes | Unit | Code complete |
| CSRF / CORS / cookie flags / Helmet / no-store | Yes | Security headers in `next.config.ts` | Unit (CSRF 8 cases, config 20 cases) | Code complete (headers not asserted over HTTP) |
| Open-redirect protection | n/a | Yes | Unit (22) + component | Complete |
| Structured logs, correlation IDs, access log | Yes | n/a | Unit | Complete at unit level |
| Retention purge (`npm run maintenance`) | Yes | n/a | Unit | Code complete (never run on a DB) |
| Admin bootstrap CLI | Yes | n/a | Not executed | Code complete |
| Accessibility (labels, focus trap, menu keyboard, live regions) | n/a | Yes | Component (dialog, menu, login) | Partially verified |
| Migrations | 2 migrations (init + additive column) | n/a | `prisma validate` only | **Blocked (B1)** |
| API e2e suite | Written (now guarded to `*_test` DBs) | n/a | Not run | **Blocked (B1)** |
| Local email (Mailpit) | Nodemailer 10 wired | n/a | Message-building smoke test only | **Blocked (no SMTP sink running)** |
| Browser E2E | n/a | n/a | Tooling not installed | **Not done** (D15) |

## 2. Commands executed (final runs, this session)

| Command | Outcome |
|---|---|
| `npm run verify` (typecheck + lint + test, both apps) | Exit 0. API Jest **172/172** (16 suites); web Vitest **67/67** (9 files: 4 unit, 5 component). ESLint 0 problems, `tsc` clean. |
| `npm run build:api` | Exit 0 |
| `npm run build:web` | Exit 0, 20 routes. Benign "Next.js plugin was not detected" warning (legacy detector; rules verified active). |
| `npx prisma migrate status` | **P1000**: authentication failed for the configured role on `localhost:5432` |
| `docker info` | **Failed**: Docker Desktop engine not running |
| `npx jest --config ./test/jest-e2e.config.ts` without `E2E_DATABASE_URL`, then with a non-`_test` URL | Refused to start both times (the new guard). No database was touched. |
| `npm audit --omit=dev` | After upgrading nodemailer 6.10 → 10.1.1, 4 advisories remain: js-yaml (moderate, pinned by `@nestjs/swagger`, used only to *write* Swagger YAML, Swagger disabled in production) and postcss (high, via `next`; the fix requires Next 16, a breaking upgrade). |
| Nodemailer 10 smoke test (stream transport) | Message built correctly. SMTP `verify` against `localhost:1025` returned `ESOCKET` (no sink running). |

## 3. Setup from a fresh checkout

1. **Install:** `npm install` at the repo root (Node 22).
2. **Environment:** copy `.env.example` to `apps/api/.env` and the `NEXT_PUBLIC_*` lines to `apps/web/.env.local`. Replace every `change-me` value with fresh random secrets: at least 32 characters each, and 64 hex characters for `MFA_ENCRYPTION_KEY`.
3. **Database:** choose one.
   - **Native PostgreSQL** (already running on port 5432 on this machine), as a superuser:
     ```powershell
     & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE ROLE mtrs LOGIN CREATEDB PASSWORD '<choose-a-password>';" -c "CREATE DATABASE mtrs OWNER mtrs;" -c "CREATE DATABASE mtrs_test OWNER mtrs;"
     ```
     Put the same password in `DATABASE_URL` and `E2E_DATABASE_URL`.
   - **Docker:** start Docker Desktop, change the compose Postgres host port (5432 is taken by the native service), then run `docker compose up -d postgres mailpit`.
4. **Migrations** (non-destructive): `cd apps/api; npx prisma migrate deploy`. For the test database:
   ```powershell
   $env:DATABASE_URL=$env:E2E_DATABASE_URL; npx prisma migrate deploy
   ```
5. **Local SMTP:** run Mailpit, via Docker or the standalone `mailpit` binary. It listens for SMTP on `1025` with a web UI on `http://localhost:8025`, matching the `.env.example` defaults. Without a sink, emails are not delivered; the API logs the failure with the recipient masked and never pretends otherwise.
6. **Optional first admin:** set `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`, then run `npm run seed:admin`. It refuses to elevate an existing account that is not active and verified. Enrol MFA right after the first sign-in; with `AUTH_ADMIN_MFA_REQUIRED=true`, admin routes stay closed until you do.
7. **Run:** `npm run dev:api` and `npm run dev:web`, then open `http://localhost:3000`.
8. **E2E:** `$env:E2E_DATABASE_URL='postgresql://mtrs:<password>@localhost:5432/mtrs_test?schema=public'; npm run test:e2e`. The suite wipes that database between tests.
9. **Maintenance:** `npm run maintenance -w @mtrs/api` (dry run) or `npm run maintenance -w @mtrs/api -- --apply`.

## 4. Unverified features (must be executed before calling the system done)

**Needs a database (B1):**
1. `prisma migrate deploy`, including the additive `mfa_pending_created_at` migration.
2. The whole API e2e suite: register → verify → login → refresh → reuse → admin flows.
3. Real concurrency:
   - parallel refresh (exactly one winner);
   - parallel single-use token consumption;
   - recovery-code races;
   - duplicate-email registration races;
   - the SERIALIZABLE last-admin check (409 path).
4. The HTTP 429 paths of the IP and per-account throttlers.
5. The maintenance script and the admin seed against real data.

**Needs SMTP:**

6. Actual email delivery and rendering in Mailpit.

**Needs HTTP or browser checks:**

7. Response headers over HTTP: `no-store`, Helmet, `Referrer-Policy` on token pages, and cookie attributes per environment.
8. Browser E2E for the brief's frontend flows: register → verify → login → dashboard → profile → logout; forgot → reset; MFA enrollment → MFA login → sessions; non-admin blocked from `/admin`; reload keeps the session; cross-tab logout.
9. Page-level behaviour without component tests: the security, sessions, profile, dashboard and admin pages compile and build, but only the login, email-change confirmation, route guard, dialog and menu are exercised by tests.
10. Mobile layout and screen-reader behaviour. These were not tested on devices or with assistive technology.

## 5. Remaining risks

- **Throttling** is in-memory per instance (D4). Multiple API instances multiply the limits.
- **Refresh grace window:** a replay within 15 s of a legitimate rotation is not treated as theft (it still receives no token).
- **Dependencies:** postcss (via Next 15) and js-yaml (via `@nestjs/swagger`) advisories remain until those upstream packages are upgraded.
- **Product decisions pending:** retention periods, final deletion/erasure, additional business roles and email delivery guarantees are client decisions (see the clarification register in `identity-security-decisions.md`).
- **No git repository:** there is no history or rollback for any change. Every modified file is listed in `IMPLEMENTATION_PROGRESS.md`.
