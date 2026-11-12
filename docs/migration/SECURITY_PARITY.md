# Documentation historique — stack remplacée

> **État actuel :** l'application active est **Angular** (pps/web) + **Spring Boot** (pps/api) + **PostgreSQL**.
> NestJS / Next.js / React / Prisma Client ne font plus partie du runtime applicatif.
> Voir README.md, docs/architecture/LEGACY_CLEANUP_AUDIT.md et docs/ui/DESIGN_SYSTEM.md.
# Security parity

Goal: every security property of the NestJS API and the Next.js client holds unchanged in Spring and Angular. Tokens, password hashes and MFA secrets must keep working across both implementations, with no forced logout, no password reset and no MFA re-enrolment. Nothing was weakened to make tokens compatible. No key was regenerated or rotated.

## Shared secrets and configuration

Spring reads the same variables as NestJS, by default from `apps/api/.env` (`PIF_ENV_FILE` overrides the path). Real environment variables take precedence. Required secrets (`JWT_ACCESS_SECRET`, `AUTH_TOKEN_PEPPER`, `AUTH_IP_HASH_PEPPER`, `MFA_ENCRYPTION_KEY`) stop the service at startup when missing. No value is logged, and the configuration object prints as `PifProperties[secrets redacted]`. Unit-tested in `ConfigAndGuardTest.requiredSecretsAreEnforcedAndNeverPrinted`.

## Backend (NestJS → Spring)

### Authentication core (Phase 1)

| Property | NestJS | Spring | Status | Evidence |
| --- | --- | --- | --- | --- |
| Password hashing | `argon2` Argon2id, m=19456 KiB, t=2, p=1, PHC string | Bouncy Castle Argon2id via `spring-security-crypto`, same parameters and PHC format | Contract verified | `NestCryptoCompatibilityTest` verifies hashes made by node-argon2 and checks Spring's hashes in the same format; passwords set by one API sign in on the other (differential "reset: new password signs in on both APIs") |
| Timing-safe unknown-user path | dummy hash verified for unknown accounts | same dummy-hash approach | Contract verified | `dummyHashIsWellFormedAndNeverMatches`; differential "unknown account" response identical |
| Access token | HS256 JWT `{sub, sid, sv, iat, exp, iss, aud}`, no clock tolerance | same claims, algorithm pinned to HS256, same secret, issuer, audience and lifetime | Contract verified | `jwtCompatibility`; differential "token issued by the other API" accepted both ways, including an admin token on admin routes |
| `JWT_ACCESS_SECRET_PREVIOUS` | Read into configuration but not used for verification | Not read | Parity (both ignore it) | source inspection of `apps/api/src` |
| Session binding | token rejected when the session is revoked or `security_version` changed | same checks on every authenticated request | Contract verified | differential `SESSION_REVOKED` after reuse detection, logout, session revocation, password change, suspension; journeys J6, J9, MT5 |
| Refresh token | opaque random value, SHA-256 + pepper stored, HttpOnly cookie `mtrs_refresh`, `Path=/api/auth`, `SameSite=Lax`, rotation with reuse detection and a 15 s `REFRESH_SUPERSEDED` grace | same | Contract verified | `refreshCookieSerializationMatchesExpress`, `opaqueTokenHashesIpDigestsAndUserAgentsMatch`; differential rotation across APIs; journey MT6 (two tabs reloading at the same time stay signed in) |
| MFA secret at rest | AES-256-GCM envelope with key version | same envelope; decrypts NestJS ciphertext and writes the same format | Contract verified | `decryptsMfaSecretsEncryptedByNestAndEncryptsInTheSameEnvelope`; differential "pending secret stored only encrypted (v1 envelope)"; journey J5 |
| TOTP | otplib authenticator (SHA-1, 6 digits, 30 s, ±1 step) with replay protection | same algorithm; replay claim stored in the database | Contract verified | `totpCodesMatchOtplibAuthenticator`, `rfc6238ReferenceVector`, `totpStepClaimsAreStrictlyMonotonic`; differential cross-API replay rejected |
| Recovery codes | 10 codes, Argon2id-hashed, single use, case and space-insensitive, shown once | same | Contract verified | differential "recovery codes stored as Argon2id hashes only", "recovery code issued by the other API signs in", "recovery codes never appear in e-mail"; journey J5 (code consumed, second use refused) |
| Login lockout | 8 failures → 15-minute lock; MFA failures count | same thresholds and counters | Contract verified | `failedLoginsLockTheAccountOnlyAtTheThreshold`; differential "account locked after the threshold" |
| CSRF | Origin/Referer allowlist (`CORS_ORIGINS` + API origin); rejects `Sec-Fetch-Site: cross-site` | same rules, applied before the handler | Contract verified | differential foreign Origin (login, register) and cross-site cases |
| CORS | allowlist with credentials | same | Contract verified | differential preflight and response headers |
| Security headers | helmet defaults | the same header set and values | Contract verified | both differential suites compare the 12 helmet headers (plus `Cache-Control`, `Pragma`, CORS and rate-limit headers) on every request |
| Rate limiting | `@nestjs/throttler` 6, per IP and per account, with `X-RateLimit-*` and `Retry-After` | same algorithm and headers, in memory per process | Contract verified | `throttleCountsLikeNestThrottler`; differential header comparison (±2 s on reset values); account cooldowns (change-email 429) |
| Audit log | allowlisted context keys, sensitive keys dropped, correlation ID | same | Contract verified | `auditStoresJsonNullForAMissingContextAndDropsSensitiveKeys`; 9 differential audit-row comparisons |
| IP and user-agent digests | HMAC with `AUTH_IP_HASH_PEPPER` of Node's address string | same, with Node's `::ffff:` IPv4 formatting | Contract verified (local dual-stack only) | `nodeStyleAddresses`; must be re-verified behind a proxy with `TRUST_PROXY` |
| API docs exposure | Swagger on when `SWAGGER_ENABLED=true`, or when it is unset and `NODE_ENV` is not `production` | same rule; guards apply only to the application's own controllers | Unit-tested; checked over HTTP | `apiDocsFollowSwaggerEnabledThenNodeEnvLikeNest` |
| Database target | — | refuses databases not ending in `_test` unless `PIF_SPRING_ALLOWED_DATABASE` names them | Implemented, unit-tested | `startupGuardOnlyAllowsTestDatabasesUnlessExplicitlyNamed` |

### E-mail and account workflows (Phase 2)

| Property | NestJS | Spring | Status | Evidence |
| --- | --- | --- | --- | --- |
| Transports | `MAIL_TRANSPORT=preview` (files in `MAIL_PREVIEW_DIR`) or SMTP; preview refused in production | same two transports and rules (`PreviewMailTransport`, `SmtpMailTransport` on Angus Mail) | Unit-tested; preview used by every run | `MailTransportTest` (14 tests, SMTP against an in-process GreenMail sink, never a real relay) |
| Delivery states | captured, accepted by the relay, or failed; never reported as delivered | `Captured`, `SmtpAccepted` ("inbox delivery not confirmed"), `Failed`; queued messages are logged as queued. A full queue yields `Failed`, never a fake success | Unit-tested | `MailTransportTest` (failed relay → `failed` state, no fake success) |
| Failure isolation | delivery failure never undoes the security action and never changes the HTTP answer | same: messages go through a bounded background queue (2 workers, 1,000 slots), and the response never depends on delivery | Unit-tested; contract verified | `MailTransportTest` (relay exception during a lockout notice); differential responses identical while mail is asynchronous |
| Secrets in logs | recipient masked; tokens never logged | recipient masked to the first two characters (`ad***@example.test`); tokens never logged; addresses inside relay error messages are masked too | Unit-tested | `MailTransportTest` asserts the log output has no raw address |
| Templates | 18 templates, text + HTML | byte-identical output for the same inputs | Contract verified | `EmailTemplatesParityTest` (fixtures rendered by the NestJS templates, `contract/generate-email-fixtures.mjs`); differential compares every message the scenarios produce, all 18 templates |
| Lockout e-mail | `account-locked` sent once when the account locks | same; the lock is a conditional `UPDATE`, and only the request that applied it sends the notice | Contract verified | differential "exactly one lockout notice" after 9 wrong passwords; "locked and unknown accounts are indistinguishable" (same answer as an unknown address) |
| Account enumeration | register, resend and forgot answer identically for unknown, pending and verified addresses; change-email to an owned address answers like success | same | Contract verified | differential "same generic answer" checks; "no confirmation link sent to an address owned by another account" |
| Tokens (verify, reset, change-email) | 64 hex characters, stored as a peppered hash, single use, expiry from configuration, cooldown between sends | same; a link issued by one API is accepted by the other | Contract verified | differential "token is 64 hex and stored only as a hash", "raw verification tokens never stored", link reuse → `TOKEN_INVALID`, cross-API links; journeys J1 and J3 |
| Weak password on reset | refused without consuming the link | same | Contract verified; journey | differential "weak password with a valid link"; J3 |
| Session revocation on credential change | reset, change-email, MFA disable and suspension revoke sessions; change-password keeps only the new one | same | Contract verified | differential `db:` checks for each case |
| Step-up for sensitive actions | password (and TOTP or recovery code when MFA is on) for MFA changes, revoke-others, role changes, deactivation | same | Contract verified | differential wrong-password → 403 and `MFA_REQUIRED` cases |

### Administration (Phase 2)

| Property | NestJS | Spring | Status | Evidence |
| --- | --- | --- | --- | --- |
| Server-side role check | `RolesGuard` on every admin route | `RolesInterceptor` reads `@Roles("ADMIN")` on the controller | Contract verified; unit-tested | differential investor → 403 on 5 admin routes with no state change; journey J8 "a direct API call bypassing Angular is refused by Spring (403) and changes nothing"; `RolesInterceptorTest` |
| Administrator MFA requirement | `AUTH_ADMIN_MFA_REQUIRED` (default on in production) → `403 ADMIN_MFA_REQUIRED` for admins without MFA | same flag, default and error | Unit-tested; **browser journey with the policy on (phase 3)** | `RolesInterceptorTest` (5 tests, including the production default); `angular-account-journey.mjs admin-mfa` against Spring started with `AUTH_ADMIN_MFA_REQUIRED=true`, 11/11: API 403 `ADMIN_MFA_REQUIRED`, `ENROLL_MFA_FOR_ADMIN` in the dashboard context, investors unaffected, Angular admin overview shows the requirement, enrolment through the security page unlocks the same session |
| Self-protection | an admin cannot change their own status or role | same | Contract verified | differential "own status → 403", "own role → 403" |
| Role change step-up | administrator password required | same | Contract verified; journey | differential "role change with a wrong password → 403"; J9 |
| Effect of suspension and role change | security version bumped, sessions revoked, notice sent, audit row | same | Contract verified; journey | differential `db:`, `mail:` and `audit:` checks; J9 (suspended user's token rejected immediately; demoted administrator loses `/admin`) |
| Revoked admin session | 401 | same | Contract verified | differential "revoked admin session → 401" |

## Frontend (Next.js → Angular)

| Property | Next.js | Angular | Status | Evidence |
| --- | --- | --- | --- | --- |
| Access token storage | memory only | memory only (`TokenStore`) | Functionally verified | journeys: no JWT or refresh value in `localStorage`, `sessionStorage` or `document.cookie`, in either of two tabs (MT1) |
| Refresh transport | HttpOnly cookie, `credentials: 'include'` only for `/auth/` calls | same | Functionally verified | unit test; journeys (reload, second tab, cross-app continuity) |
| Open-redirect protection on `returnTo` | `sanitizeReturnTo` | verbatim port | Functionally verified | ported unit tests; journeys compare redirects with Next.js |
| Multi-tab sign-in/sign-out sync | BroadcastChannel `mtrs-auth` | same channel and messages | **Functionally verified** | journey MT1–MT9: second tab signed in from the cookie; simultaneous reloads keep both tabs signed in without a reuse alarm; sign-out in one tab sends the other to sign-in; no refresh after sign-out; the other tab's last token is rejected by both APIs; a new sign-in restores the other tab; continuity with Next.js |
| Admin route guard | `ProtectedRoute roles={['ADMIN']} requireEmailVerified` in `admin/layout.tsx` | `adminGuard` (`canActivate` and `canActivateChild`) redirects non-admins to `/unauthorized` and signed-out visitors to sign-in. It only decides what to render: the API enforces the role on every request | Functionally verified | `guards.spec.ts`; journey J8 (investor sent to `/unauthorized`, admin UI never rendered, direct API call refused) |
| Tokens in the address bar | `/verify-email`, `/reset-password`, `/confirm-email-change` read `?token=` and replace the URL | same: the token is read once, removed from the URL by a router navigation with `replaceUrl: true` (no history entry keeps it), and nothing is sent until the user confirms | Functionally verified | journeys J1, J3, A1 and A3 ("token is removed from the address bar before anything is sent", "nothing is verified on page load"); host check (history entry has no token); unit tests |
| Secrets in client configuration | only `NEXT_PUBLIC_API_URL` | only `apiUrl` in `environment*.ts` | Verified by inspection | `src/environments/` |
| MFA secret on screen | shown during enrolment only | same; the visual tests mask it before any screenshot is saved | Verified | `visual-parity.mjs` masks the secret; no screenshot contains it |
| Page security headers | `next.config.ts`: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` | same four headers on the dev server (`angular.json`) and on the production host `apps/web-angular/server/host.mjs` | **Verified over HTTP on the production build (phase 3)** | `scripts/migration/angular-host-check.mjs`, 37/37 |
| Token pages: `Referrer-Policy: no-referrer`, `Cache-Control: no-store` | set per route in `next.config.ts` | set by the production host for `/verify-email`, `/reset-password`, `/confirm-email-change` (with or without a trailing slash), on 200, `HEAD` and on their 308 redirects. The dev server cannot set per-route headers; the token is removed from the URL before any request either way | **Verified over HTTP and in a browser (phase 3)** | `angular-host-check.mjs`: headers on every response kind; in Edge, the token is gone from `location.href` and the history entry, the document has `Referrer-Policy: no-referrer`, and no request carries the token in a `Referer` |
| E-mail link target | `APP_FRONTEND_URL` | `APP_FRONTEND_URL`, or `MIGRATION_FRONTEND_URL` for test environments only (a bare http(s) origin listed in `CORS_ORIGINS`; refused in production) | **Verified end to end (phase 3)** | `MailTransportTest`; account journey A1 and A3 open the links exactly as e-mailed: they target the configured Angular origin, and no URL in the message sends the token to another origin |

## Phase 3: security gaps closed

### Production host for the Angular build

`apps/web-angular/server/host.mjs` (Node built-ins only, `npm run serve:host`) serves `dist/web-angular/browser` and forwards `/api` to Spring on the same origin. Header policy (`server/headers.mjs`):

| Response | Headers |
| --- | --- |
| Every response | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy` as in `next.config.ts`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Token pages (any response kind, including redirects and errors) | `Referrer-Policy: no-referrer`, `Cache-Control: no-store` |
| Fingerprinted assets (`main-<hash>.js`, fonts, …) | `Cache-Control: public, max-age=31536000, immutable` (public static assets stay cacheable) |
| Other documents and unhashed assets | `Cache-Control: no-cache` (revalidated, not `no-store`) |
| Redirects, 404, 405, 502 | `Cache-Control: no-store` |

Other behaviour verified by `angular-host-check.mjs` (37/37): path traversal refused, `POST` to a page → 405, `/api/health` forwarded with `X-Forwarded-*`, a protected route answers 401 through the host, an unreachable API → 502 `UPSTREAM_UNAVAILABLE`. The access log records `GET /verify-email?<redacted> 200`: query strings are never logged.

Behind a reverse proxy, the proxy must pass these headers through unchanged and must not add caching for the three token paths; `CUTOVER_AND_ROLLBACK.md` lists this as a gate.

**Legacy weakness observed (not modified).** The Next.js app redirects `/verify-email/?token=…` (trailing slash) with a 308 that carries none of the security, referrer or cache headers, so that response could be cached or leak its `Location` through a referrer. The Angular host sends the token-page headers on that redirect. The original app was not changed.

### Spring Security CVE-2026-22732

The [advisory](https://github.com/advisories/GHSA-mf92-479x-3373) concerns lazy header writing in `spring-security-web` servlet applications (7.x: 7.0.0–7.0.3, fixed in 7.0.4). `apps/api-spring` does not depend on `spring-security-web` or any other Spring Security module except `spring-security-crypto` 7.1.2 (password hashing), which the advisory does not cover. Checked with `mvnw dependency:tree`. **Not affected; no upgrade needed.** The Spring headers are written by the application's own `RequestFilters`.

### Account-security browser journeys

`scripts/migration/angular-account-journey.mjs` (Angular on Spring, disposable `@spring-account.test` accounts, preview mail), **44/44**: verification resend (A1), password change (A2), e-mail change (A3), recovery-code regeneration (A4), MFA disable (A5), deactivation (A6) and deletion (A7). Each covers its refusal case (wrong password, wrong code, wrong confirmation word), the database effect, session revocation and the notice e-mail. `admin-mfa` mode: 11/11 (above).

**Secrets in artifacts.** Each run checks that no TOTP secret or recovery code it saw appears in its screenshots, its result file or any captured e-mail (S1), and that captures taken while a secret was on screen were masked. A separate scan of the documentation, scripts, contract fixtures and Angular sources found no JWT, `otpauth://` URI, token link, refresh cookie or recovery-code list, except the crypto fixtures, which are generated from random test-only keys (`generate-crypto-fixtures.mjs`). An in-process comparison against the 5 secret values in `apps/api/.env` found none of them in 250 files. No exposure was established, so no credential was rotated.

### API documentation

Spring's OpenAPI document now matches NestJS for all 37 migrated operations: tags, summaries, descriptions, bearer security, request-body schemas (the NestJS DTO names and constraints), query parameters and the standard error responses (`ErrorResponse`, 400/401/403/429/503). `scripts/migration/openapi-compare.mjs` reports 0 differences. The one accepted exception is that Spring also documents the 200 of `POST /auth/refresh`, which `@nestjs/swagger` omits because the route declares an explicit 401. Documentation only: no route behaviour changed.

## Open items

1. Rate-limit counters are per process; route each path to exactly one backend.
2. The production host must be deployed behind the real reverse proxy and re-checked there (cutover gate).

## Rules respected

- No password was reset, no MFA secret regenerated, no key rotated. No real user's account was used: all tests use disposable accounts on `PIF_spring_test` (`@spring-contract.test`, `@spring-journey.test`, `@spring-account.test`, `@spring-visual.test`), removed afterwards except the visual accounts that later runs reuse.
- No e-mail was sent to a real mailbox: both APIs ran with `MAIL_TRANSPORT=preview`, and the SMTP tests use an in-process GreenMail server.
- No secret value appears in source, logs, documentation or screenshots. Tokens captured by the test scripts stay in memory and are never written to reports.
