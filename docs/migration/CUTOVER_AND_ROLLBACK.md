# Cutover and rollback

**Nothing in this document has been executed.** Production traffic is served only by `apps/web` and `apps/api`. Every step below needs your explicit approval when its time comes.

## Strategy: route by path, one backend per path

Both stacks keep identical URL paths, so a reverse proxy (or the hosting platform's routing) can send each path to exactly one implementation:

```
/api/health, /api/auth/login, /api/auth/mfa/verify-login, /api/auth/refresh, /api/auth/logout,
/api/auth/me, /api/auth/me/preferences, /api/users/me/preferences   →  Spring   (when approved)
every other /api/*                                                  →  NestJS
/login, /settings/profile                                           →  Angular  (when approved)
every other page                                                    →  Next.js
```

Rules:
- **Never** route the same path to both backends (no load balancing between NestJS and Spring). Rate limits are counted per process, and financial commands must be processed exactly once.
- **No dual writes.** Each request is handled by one implementation against the one shared database.
- Sessions, access tokens, refresh cookies, password hashes and MFA secrets are compatible both ways (verified, see [SECURITY_PARITY.md](SECURITY_PARITY.md)). Moving a path between implementations therefore signs nobody out.
- Angular and Next.js pages must be served from the **same origin**, so the refresh cookie (`Path=/api/auth`) and the in-memory token flow work unchanged. A user moving between an Angular page and a Next.js page keeps their session. This was verified locally across ports on `localhost`.

## Preconditions for routing any path to Spring or Angular

| # | Precondition | Status |
| --- | --- | --- |
| 1 | All gates in [TEST_REPORT.md](TEST_REPORT.md) pass for the slice | Done for the auth/profile slice |
| 2 | Spring sends the `account-locked` e-mail (e-mail module migrated) or the login path stays on NestJS | Done in phase 2 (all 18 templates, exactly one lockout notice, verified by the differential suite) |
| 3 | Spring started with `PIF_SPRING_ALLOWED_DATABASE` set to the target database, the same `NODE_ENV`, `AUTH_COOKIE_*`, `CORS_ORIGINS` and `APP_API_URL` values as the NestJS deployment (Swagger is off when `NODE_ENV=production`), and the same secrets from the deployment's secret store | Not done (requires approval) |
| 4 | Client IP handling re-verified behind the production proxy (`TRUST_PROXY`), so IP digests and per-IP limits match NestJS | Not done |
| 5 | Angular production host serves the same security headers as `next.config.ts`, including `no-referrer` / `no-store` on token pages, and falls back to `index.html` for client routes | Done locally in phase 3 (`apps/web-angular/server/host.mjs`, `angular-host-check.mjs` 37/37). **Re-run the check through the real reverse proxy**, which must pass the headers through and must not cache the token paths |
| 6 | Production build of the Angular app (`environment.production.ts`, `apiUrl: '/api'`) checked in a browser against the production-like proxy | Checked in Edge against the local host (same origin, `/api` forwarded); not yet against the production proxy |
| 7 | E-mail links: `APP_FRONTEND_URL` points at the public origin; `MIGRATION_FRONTEND_URL` is **unset** (Spring refuses it when `NODE_ENV=production`). Real users are never sent to an unfinished Angular page | Next.js stays the link target until cutover; the Angular override is used only on `PIF_spring_test` |
| 8 | `AUTH_ADMIN_MFA_REQUIRED` behaves as in NestJS | Verified in a browser journey with the policy on (phase 3, 11/11) |
| 9 | Database backup taken and restore-tested before the first switch | Not done |
| 10 | Your explicit go-ahead | — |

## Suggested order

1. Read-only endpoints first (`/api/health`, `GET /api/auth/me`, `GET …/preferences`) to Spring, observing error rates and latency.
2. Preference and profile writes (`PATCH`).
3. Refresh and logout.
4. Login and MFA verification, once the e-mail blocker is closed.
5. The Angular `/settings/profile`, then `/login`.
6. Later slices in the order of [PROGRESS.md](PROGRESS.md), each with its own gates.

## Rollback

Rollback is a routing change only. No schema change, data migration or key change is involved, so it is immediate and loses no data:

1. Point the affected paths back to NestJS / Next.js in the proxy configuration.
2. Nothing needs to be undone in PostgreSQL: both implementations write the same rows with the same semantics. Sessions created by Spring keep working on NestJS, as verified by the differential and browser tests.
3. Users stay signed in: refresh cookies issued by either backend are accepted by the other.

What rollback cannot undo: e-mails not sent while Spring handled a path without the e-mail module. That is why precondition 2 blocks login.

## Final decommissioning (not planned yet)

Removing `apps/web` or `apps/api` is out of scope until every feature is *Fully accepted* and you decide it. The old applications must not be deleted automatically.
