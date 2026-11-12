# PIF technology migration: Next.js + NestJS → Angular + Spring Boot

The migration is incremental, side by side and reversible:

| Layer | Existing (still the production path) | New (parallel, not serving users) |
| --- | --- | --- |
| Web | `apps/web` — Next.js 15 / React 19 | `apps/web-angular` — Angular 22.2 (standalone, zoneless, signals) |
| API | `apps/api` — NestJS 11 / Prisma 6 | `apps/api-spring` — Spring Boot 4.1.2 / Java 25 / plain JDBC |
| Database | PostgreSQL, schema owned by Prisma migrations | **Unchanged.** Same tables, same Prisma migration history |

Nothing in `apps/web` or `apps/api` was removed or rewritten for the migration. URL paths (`/login`, `/settings/profile`, `/api/auth/...`) are preserved one-to-one so either implementation can serve a path.

## Current checkpoint (2026-11-10)

**First vertical slice complete and tested:** sign-in (password + MFA), session refresh and sign-out, current user, profile and preferences, health, the workspace shell (sidebar, top bar, breadcrumb, profile menu, mobile drawer and bottom navigation) and the Settings › Profile screen.

- Backend: 11 of the 94 NestJS endpoints are implemented in Spring and **contract-verified** against NestJS (58/58 differential checks).
- Frontend: `/login` and `/settings/profile` plus the shell are **visually verified** against Next.js (22 pixel comparisons at 375/768/1440 px, light and dark) and **functionally verified** in a browser journey (23/23 checks).
- Everything else is **not started**. In the Angular app, unmigrated routes show an explicit "not migrated yet" notice inside the real shell. Nothing fakes their content.

See [PROGRESS.md](PROGRESS.md) for exactly what is done and what remains.

## Documents

| Document | Content |
| --- | --- |
| [PROGRESS.md](PROGRESS.md) | Checkpoint, done / remaining, next slices |
| [FEATURE_PARITY_MATRIX.md](FEATURE_PARITY_MATRIX.md) | Every screen of `apps/web` and its migration status |
| [API_PARITY_MATRIX.md](API_PARITY_MATRIX.md) | All 94 NestJS endpoints and their Spring status |
| [DATABASE_COMPATIBILITY.md](DATABASE_COMPATIBILITY.md) | Schema ownership, guards, type mapping, test databases |
| [SECURITY_PARITY.md](SECURITY_PARITY.md) | Password hashing, JWT, refresh cookie, MFA, CSRF, throttling, audit |
| [FINANCIAL_PARITY.md](FINANCIAL_PARITY.md) | Money arithmetic contract for trading/portfolios (not started) |
| [ACTUARIAL_PARITY.md](ACTUARIAL_PARITY.md) | Actuarial models and RNG contract (not started) |
| [UI_VISUAL_PARITY.md](UI_VISUAL_PARITY.md) | Design-system port and pixel comparison results |
| [TEST_REPORT.md](TEST_REPORT.md) | Every test run, command and result |
| [CUTOVER_AND_ROLLBACK.md](CUTOVER_AND_ROLLBACK.md) | Routing plan, gates, rollback (nothing executed) |

Status vocabulary used everywhere: *Not started*, *Under migration*, *Migrated but unverified*, *Contract verified*, *Functionally verified*, *Visually verified*, *Fully accepted*, *Blocked*. No item is *Fully accepted* yet: that needs the remaining gates and your sign-off.

## Running the slice locally

Both APIs must point at a database whose name ends with `_test`. The Spring service refuses to start otherwise unless `PIF_SPRING_ALLOWED_DATABASE` names the database explicitly, and nothing in this migration has been pointed at `PIF`.

1. NestJS reference API on 3001 (`apps/api`, `npm run start:dev`) with `DATABASE_URL` set to the test database.
2. Spring API on 3002 — see [apps/api-spring/README.md](../../apps/api-spring/README.md).
3. Next.js on 3000 with `NEXT_PUBLIC_API_URL=http://localhost:3001/api`.
4. Angular on 4200 (`cd apps/web-angular && npm start`) — uses `http://localhost:3002/api` in development.
5. `CORS_ORIGINS=http://localhost:3000,http://localhost:4200` for both APIs.

Verification tools (all refuse non-`_test` databases and send no e-mail):

| Command (repository root) | What it checks |
| --- | --- |
| `node apps/api-spring/contract/differential-auth.mjs` | Same requests to NestJS and Spring; compares status, body, headers, cookies, database side effects |
| `node apps/api-spring/contract/visual-account.mjs create` | Creates the two disposable accounts used by the browser checks |
| `node scripts/migration/visual-parity.mjs` | Pixel comparison of Next.js vs Angular screens in headless Edge |
| `node scripts/migration/angular-auth-journey.mjs` | Functional browser journey on Angular + Spring, with cross-app session continuity |

`DATABASE_URL` must be set in the shell for the scripts that touch the database. Screenshots and reports are written to [screenshots/](screenshots/).
