# Documentation historique — stack remplacée

> **État actuel :** l'application active est **Angular** (pps/web) + **Spring Boot** (pps/api) + **PostgreSQL**.
> NestJS / Next.js / React / Prisma Client ne font plus partie du runtime applicatif.
> Voir README.md, docs/architecture/LEGACY_CLEANUP_AUDIT.md et docs/ui/DESIGN_SYSTEM.md.
# API parity matrix

Inventory: every route decorator in `apps/api/src/**/*.controller.ts` (94 endpoints, 10 controllers, global prefix `/api`). Spring routes keep the same paths, methods, status codes, JSON shapes, error codes, headers and cookie. Spring's OpenAPI document (`/api/docs-json`) lists the same 37 operations.

**Summary: 37 / 94 implemented in Spring (the whole identity domain: auth 27, users 3, admin 6, health 1). All 37 are contract-verified, and 33 are also exercised in a real browser. 57 are not started (market, portfolios and trading, learning, FinStories, actuarial, reserving).**

How the statuses were established:
- **Contract verified:** the differential scripts send the same requests to NestJS (3001) and Spring (3002) on `PIF_spring_test`. They compare the status code and the normalized body, where only UUIDs, dates, JWTs, 64-hex tokens, correlation IDs and the disposable test address are replaced by placeholders and everything else must be equal. They also compare security, CORS and rate-limit headers, the media type, normalized `Set-Cookie`, the e-mails produced (template, recipient, subject, text and HTML), and database side effects (user columns, sessions, tokens and audit rows).
  - `apps/api-spring/contract/differential-auth.mjs` (Phase 1 endpoints): **58/58 PASS**.
  - `apps/api-spring/contract/differential-identity.mjs` (Phase 2 endpoints): **216/216 PASS** (2026-11-11). The report is in `apps/api-spring/target/differential-identity-report.json`.
- **Functionally verified:** also exercised by a real browser through the Angular app. The Phase 1 auth journey passed 23/23 and the identity journeys passed 61/61; see [TEST_REPORT.md](TEST_REPORT.md).

Both APIs ran with the e-mail preview transport (`MAIL_TRANSPORT=preview`), so the tests wrote every message to a local folder and none was delivered.

## Implemented in Spring (37)

### Phase 1 (11)

| Method | Path | Spring status | Evidence |
| --- | --- | --- | --- |
| GET | `/api/health` | Functionally verified | differential; Angular top-bar health chip |
| POST | `/api/auth/login` | Functionally verified | differential (validation, unknown/wrong password, unverified, suspended, deactivated, CSRF origin and `Sec-Fetch-Site`, success, MFA challenge, throttling headers, lockout with one notice); browser journeys |
| POST | `/api/auth/mfa/verify-login` | Functionally verified | differential (validation, unknown/superseded/consumed challenge, recovery code, wrong code, TOTP replay across APIs, success, lockout counting); browser journeys (wrong code, valid TOTP, recovery code single use) |
| POST | `/api/auth/refresh` | Functionally verified | differential (missing/unknown cookie, rotation across APIs, `REFRESH_SUPERSEDED`, `REFRESH_REUSE_DETECTED`); browser journeys (reload, concurrent reload in two tabs, Next.js ↔ Angular rotation) |
| POST | `/api/auth/logout` | Functionally verified | differential; browser journeys (session revoked in PostgreSQL, other tab and other app signed out) |
| GET | `/api/auth/me` | Functionally verified | differential (no token, garbage token, own token, token issued by the other API, revoked session) |
| PATCH | `/api/auth/me` | Functionally verified | differential; browser journey |
| GET | `/api/auth/me/preferences` | Contract verified | differential |
| PATCH | `/api/auth/me/preferences` | Functionally verified | differential; browser journey |
| GET | `/api/users/me/preferences` | Contract verified | differential |
| PATCH | `/api/users/me/preferences` | Contract verified | differential |

### Phase 2 (26)

Each of the 20 protected Phase 2 routes was also called without a token, and four admin routes plus `PATCH …/status` were called with an investor token (403, nothing changed). The evidence column lists the scenarios as named in the report. Every scenario compares status, normalized body, headers, media type and `Set-Cookie`, and the `db:`, `mail:` and `audit:` checks compare the side effects.

| Method | Path | Spring status | Contract evidence (differential) | Browser evidence |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | Functionally verified | validation, confirmation mismatch, weak password, CSRF foreign origin; new account (pending row, default preferences, one link, token stored only as a hash); same pending address inside the cooldown (same answer, no mail); verified address (same answer, `account-exists` notice without a link); sign-in before verification | J1 |
| POST | `/api/auth/verify-email` | Functionally verified | short and unknown token; link issued by the other API (account activated, `welcome` mail); link reuse → `TOKEN_INVALID`; audit | J1 (token stripped from the URL, nothing verified on page load, link single use) |
| POST | `/api/auth/resend-verification` | Contract verified | invalid and unknown address; pending account (fresh link); inside the cooldown (no mail) | Unit tests and visual capture only |
| POST | `/api/auth/forgot-password` | Functionally verified | invalid and unknown address; active account (one reset link); inside the cooldown | J3 |
| POST | `/api/auth/reset-password` | Functionally verified | validation, unknown token, confirmation mismatch; weak password with a valid link; link issued by the other API (password and security version changed, every session revoked, `password-changed` notice); reuse → `TOKEN_INVALID`; new password signs in on both APIs; audit | J3 |
| POST | `/api/auth/change-password` | Contract verified | validation, same as current, wrong current password → 403; success (new session cookie, `no-store`, only the new session kept, notice, old token rejected); the new refresh cookie works on the other API | Unit tests and visual capture only |
| POST | `/api/auth/change-email/request` | Contract verified | same address, wrong password; address owned by someone else (same answer, no link sent there, only the current address told); success (both addresses mailed); second request inside the cooldown → 429 | Unit tests only |
| POST | `/api/auth/change-email/confirm` | Contract verified | short and unknown token; link issued by the other API (ownership moved, every session revoked, old and new address notices); reuse | Unit tests only |
| GET | `/api/auth/sessions` | Functionally verified | list with `current` flag, order and fields | J6, MT1 |
| DELETE | `/api/auth/sessions/:id` | Functionally verified | invalid ID → 400, unknown ID → 404, another user's session → 404; own session (exactly one revoked with `USER_REVOKE`) | J6 (its token is then denied by Spring and NestJS) |
| DELETE | `/api/auth/sessions` | Contract verified | wrong password → 403; success (only the current session remains, the revoked token gets `SESSION_REVOKED`, `sessions-revoked` notice); audit | Visual capture of the dialog |
| POST | `/api/auth/logout-all` | Contract verified | cookie cleared, every session revoked, no usable refresh token, notice, audit | Unit tests |
| POST | `/api/auth/mfa/setup` | Functionally verified | wrong password → 403; secret and otpauth URI; pending secret stored only encrypted (v1 envelope) | J5 |
| POST | `/api/auth/mfa/enable` | Functionally verified | no setup in progress, invalid code; success (recovery codes returned once, stored as Argon2id hashes only, `mfa-enabled` notice); a recovery code issued by one API signs in on the other | J5 |
| POST | `/api/auth/mfa/disable` | Contract verified | not enabled; success with a recovery code (secrets cleared, this session kept, others revoked, notice) | Unit tests |
| POST | `/api/auth/mfa/recovery-codes/regenerate` | Contract verified | missing code → `MFA_REQUIRED`; new codes; notice, with codes never e-mailed | Unit tests |
| GET | `/api/auth/mfa/status` | Functionally verified | disabled and enabled | J5 (Security page) |
| POST | `/api/auth/me/deactivate` | Contract verified | wrong confirmation word; success (cookie cleared, status, every session revoked, notice); sign-in afterwards; audit | Visual capture of the dialog |
| DELETE | `/api/auth/me` | Contract verified | success (`PENDING_DELETION`, `account-deletion-scheduled` notice); audit | Visual capture of the dialog |
| GET | `/api/users/me/dashboard-context` | Functionally verified | investor and administrator | J5 (loaded by the Security page) |
| GET | `/api/admin/overview` | Functionally verified | investor → 403; administrator; admin token issued by the other API; revoked admin session → 401 | J9 |
| GET | `/api/admin/users` | Functionally verified | investor → 403; 20 query variants: search (case-insensitive, `%` and `_` taken literally, over-long), role, status and verification filters, pagination, out-of-range, malformed and repeated parameters, unknown parameter | J9 |
| GET | `/api/admin/users/:id` | Functionally verified | investor → 403; invalid and unknown ID; detail | J9 |
| PATCH | `/api/admin/users/:id/status` | Functionally verified | investor → 403 (no change); validation, unsupported transition, own status → 403, invalid ID; suspend (security version bumped, every session revoked, notice, token rejected); same status → `STATUS_UNCHANGED`; reactivate (notice); audit | J9 (the token stops working immediately) |
| PATCH | `/api/admin/users/:id/role` | Functionally verified | own role → 403, validation, wrong password → 403; promote; same role → `ROLE_UNCHANGED`; demote (security version bumped twice); audit | J9 |
| GET | `/api/admin/audit-events` | Functionally verified | investor → 403; 15 query variants: subject, actor, event type and outcome filters, invalid values, impossible and reversed dates, partial ISO dates, pagination; plus the 2 documented divergences below | J9 |

Cross-cutting behaviour:
- Verified by the Phase 1 suite: 404 for unknown routes and wrong methods, and CORS preflight.
- Compared on every request of both suites: the helmet security header set, `Cache-Control`, `Pragma`, CORS response headers, rate-limit headers (reset values within 2 s), the presence of a correlation ID, and refresh cookie attributes.
- Compared by the identity suite: the e-mails each scenario produces, covering all 18 templates. Template order, recipient, subject, text and HTML must be equal; only the recipient's address and the token value are masked, so links must match apart from the token.

### Known differences on implemented endpoints

| Area | Difference | Impact | Status |
| --- | --- | --- | --- |
| Audit date filters in an ISO 8601 form that JavaScript's `Date` cannot parse (`?to=2026-W01`, `?from=20260101`) | NestJS passes class-validator's ISO check, then fails in `new Date()` and answers **500** `INTERNAL_ERROR`. Spring answers **400** `VALIDATION_ERROR` with the same validation message NestJS uses for other invalid dates | Admin-only endpoint; a server error becomes a validation error | **Intentional fix of a pre-existing NestJS defect.** The differential suite asserts both sides exactly ("divergence (documented)" checks), so it is not normalized away |
| Malformed JSON body | Both return 400 `VALIDATION_ERROR`. Spring's message is "Request body is not valid JSON"; NestJS returns the Node parser's text | Message text only | Accepted, documented |
| `Content-Type` | NestJS sends `application/json; charset=utf-8`, Spring sends `application/json`. The differential suites compare the media type only | None for browsers: JSON is UTF-8 by definition (RFC 8259) | Accepted, documented |
| `ETag` | Express adds weak ETags (for example on `GET /api/health`); Spring does not | The web apps do not send conditional requests | Accepted, documented |
| Rate-limit counters | Kept in memory per process in both implementations (same algorithm as `@nestjs/throttler` 6) | Running both behind one hostname would double the effective limit | Cutover note: route each path to exactly one backend |
| Links in e-mails | Both APIs build links from `APP_FRONTEND_URL`, which points at the Next.js app in development | After cutover, links must open the Angular app | Cutover configuration item; the browser journeys re-point captured links to Angular |
| Client IP format | Spring formats IPv4 as `::ffff:a.b.c.d` like Node on a dual-stack listener, so IP digests and per-IP keys match | Holds for the default dual-stack setup; must be re-checked behind a proxy (`TRUST_PROXY`) | Verified locally only |
| API documentation | Both expose OpenAPI JSON at `/api/docs-json` and Swagger UI under the same on/off rule. NestJS serves the UI at `/api/docs`; Spring redirects to `/api/swagger-ui/index.html` | Developer tooling only | Accepted, documented |
| E-mail syntax check | Spring reimplements validator.js `isEmail` with class-validator defaults; unit-tested on the cases NestJS uses, not exhaustively | Exotic addresses could be classified differently | Accepted, unit-tested |

The Phase 1 lockout-notice blocker is closed: Spring now sends the `account-locked` e-mail. The differential suite checks that exactly one notice is sent per lock and that the response is identical to the one for an unknown address.

## Not started (57)

| Area | Endpoints | Status |
| --- | --- | --- |
| Market data | `GET /api/market/status`, `/instruments`, `/instruments/:symbol`, `/instruments/:symbol/history`, `GET/PUT/DELETE /api/market/watchlist[/:symbol]` (7) | Not started |
| Portfolios and trading | `GET/POST /api/portfolios`, `GET /api/portfolios/:id`, `POST …/cash-flows`, `GET …/cash-entries`, `POST …/orders/preview`, `POST/GET …/orders`, `GET …/orders/:orderId`, `POST …/orders/:orderId/cancel`, `GET …/executions`, `GET …/analytics`, `GET …/history` (13) | Not started. The Java financial core they need is ported and verified; see [FINANCIAL_PARITY.md](FINANCIAL_PARITY.md) |
| Learning (MarketQuest, Time Machine) | `GET /api/learning/missions`, `/missions/:slug`, `POST /missions/:slug/sessions`, `GET /profile`, `GET /sessions`, `GET /sessions/:id`, `POST …/commands`, `POST …/orders/preview`, `POST …/abandon`, `GET …/assessment`, `POST …/mentor`, `GET …/timeline`, `POST …/branches`, `GET …/compare/:otherId` (14) | Not started |
| FinStories | `GET /api/learning/stories`, `GET /api/learning/stories/:slug`, `PUT /api/learning/stories/:slug/progress` (3) | Not started |
| Actuarial | overview, presets, frequency/severity/aggregate analysis, pricing, scenarios (list/create/get/delete), simulations (create/list/get/delete) (14) | Not started. See [ACTUARIAL_PARITY.md](ACTUARIAL_PARITY.md) |
| Reserving | `GET /api/actuarial/reserving/examples`, `POST …/analyze`, `POST/GET …/runs`, `GET/DELETE …/runs/:id` (6) | Not started |
