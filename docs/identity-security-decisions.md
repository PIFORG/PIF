# Identity security decisions — Market Trading Room Simulator

**Labels:**
- **REQUIRED**: explicitly demanded by the brief (`docs/master-prompt.md`).
- **DESIGN DECISION**: chosen where the brief was silent.
- **RECOMMENDED EXTENSION** / **NEEDS CLARIFICATION**: not implemented, or awaiting client/legal input.

No legal, GDPR or regulatory compliance is claimed. Decision IDs (D1–D18) refer to `IMPLEMENTATION_PROGRESS.md`.

## 1. Questions the brief asks us to answer (§14)

### Why a stable session ID instead of a JWT `sid` pointing at rotating refresh rows
- Each login creates one `AuthSession` row whose `id` stays the same for the life of the device session. The access JWT carries that stable `sid`. Refresh tokens are separate single-use rows that point to the session.
- If `sid` pointed at the current refresh row, every rotation would invalidate the tab's access token (or require re-issuing it). "Revoke this device" would have to chase a moving ID, and the device list would show a new entry after every refresh.
- With a stable session:
  - revocation is a single update;
  - `JwtStrategy` rejects revoked sessions on the very next request;
  - the session list maps one-to-one onto devices.

### When an old refresh token replay revokes a session, and concurrency edge cases
- Rotation is an atomic conditional claim (`usedAt IS NULL AND revokedAt IS NULL`), so exactly one concurrent request wins.
- Presenting an already-rotated token is treated as theft. The whole `AuthSession` is revoked, a `REFRESH_REUSE_DETECTED` audit event is written, and the cookie is cleared.
- **Concurrent tabs (DESIGN DECISION, 15-second grace):** if the replay happens within 15 s of rotation, while the session is live and the successor is unused, the API returns `401 REFRESH_SUPERSEDED`.
  - It issues **no** token to the old-token presenter (the brief: "do not leak a new token to a request presenting an invalid old token").
  - It keeps the cookie, so the winning tab's new cookie survives. The browser client waits and retries once.
- **Residual risk:** a thief replaying within those 15 s gets a 401 without triggering revocation. They still receive no credential.
- Reuse revocation runs in a transaction, so a failure cannot leave a half-revoked session.

### Why the role is reloaded from the database, and how admin actions invalidate access
- `JwtStrategy` reloads the user, status, role, session and `securityVersion` on every request. The JWT only proves identity and session; it is never the source of truth for privileges.
- The following bump `securityVersion` and/or revoke sessions, so outstanding access tokens stop working on their next request (`CREDENTIALS_ROTATED` / `SESSION_REVOKED`):
  - suspension and deactivation (by an admin or by the user);
  - password reset or change, email change;
  - MFA disable, deletion.
- A role change takes effect immediately because the role is read from the database.

### Why users cannot self-assign ADMIN, and why ownership is not RBAC
- Registration and profile DTOs whitelist their fields, and the global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`, so `role`, `status`, `emailVerified` and similar fields are rejected.
- `ADMIN` is granted only by an existing admin (with step-up) or by the opt-in bootstrap CLI.
- **RBAC** answers "may this role use this feature at all?" (`RolesGuard` on `/admin/*`).
- **Ownership** answers "is this specific record yours?" (`ownership.policy.ts`). It is owner-only even for admins (§6: admins do not see private resources by default).
- A missing *or* foreign private resource returns the same `404 RESOURCE_NOT_FOUND`, so IDs cannot be probed.

### Why guest access is limited to truly public routes
- `JwtAuthGuard` is a global `APP_GUARD` (default deny). Only these routes opt out with `@Public()`:
  - register, verify, resend, login, MFA verify-login, refresh, logout;
  - forgot and reset password, email-change confirm.
- Each of these is either credential-establishing or token-bound.
- On the web side, `ProtectedRoute` wraps every private page. It is UX only; the API enforces access on every request.

### Why TaxGain naming, tax-import or broker entities are not copied
The brief forbids reusing TaxGain naming, cookie names, logos and fiscal-import behaviour. This product is a trading-room *simulator*. Its identity layer must not imply real brokerage, tax or custody relationships. Business modules (portfolio, orders, stress testing, actuarial) are listed with `available: false` until they actually exist.

### Password policy (DESIGN DECISION: simplified for demonstrations)
At the product owner's request, the policy favours easy demo accounts such as `nasma@2026`:
- 8–128 characters (Unicode code points);
- at least one letter, one number and one symbol (any character that is not a letter, digit or space).

There is no common-password or personal-information screening. This is weaker than NIST SP 800-63B guidance (longer passwords screened against breached lists). Revisit before any real deployment. Passwords are still hashed with Argon2id, and login throttling and lockout still apply.

The web strength meter is a hint only; the server is authoritative.

### Why browser tokens are not in localStorage, and the cookie / SameSite / CSRF scheme
- The **access token** lives only in module memory (`tokenStore.ts`): never `localStorage`, `sessionStorage` or a JS-readable cookie. An XSS payload therefore cannot exfiltrate a long-lived credential from storage.
- The **refresh token** is an opaque 32-byte value in the `mtrs_refresh` cookie:
  - HttpOnly, `Path=/api/auth`, `SameSite=lax`, `Secure` required outside localhost;
  - only an HMAC-SHA-256 digest is stored, and the value is never returned in JSON.
- **CSRF (`CsrfGuard` on the auth controller):** the cookie is the only ambient credential.
  1. A present `Origin` must be allowlisted (including the literal `null`).
  2. Otherwise `Sec-Fetch-Site: same-origin`/`none` passes, `cross-site` fails, and `same-site` alone is not trusted.
  3. Otherwise the `Referer` origin must be allowlisted.
  4. No signal at all is allowed only outside production.
- Bearer-only requests (no cookie, not refresh/logout) are not CSRF-exposed. `/users/*` and `/admin/*` never read cookies.

### Admin bootstrap and MFA for privileged roles
- No default credentials exist. `npm run seed:admin` is opt-in: it needs `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`, and the password must pass the same policy.
- **Elevating an existing account:**
  - it is elevated only if it is **active, verified and not deleted**, so a squatter's unverified registration of the bootstrap address cannot be turned into an admin account;
  - elevation bumps `securityVersion` and is audited (`via: bootstrap`).
- **Admin MFA (RECOMMENDED, D9):** with `AUTH_ADMIN_MFA_REQUIRED` (default `true` in production), admins without MFA get `403 ADMIN_MFA_REQUIRED` on `/admin/*`. `/auth/mfa/*` is not role-gated, so a freshly bootstrapped admin can enroll first.
- **Role changes** require the acting admin's password plus TOTP when the admin has MFA. Self-demotion, self-suspension and removing the last active admin are blocked:
  - the last-admin check runs in a SERIALIZABLE transaction;
  - a conflict returns `409 CONCURRENT_UPDATE`.

### Identity assumptions that remain client decisions
See section 4 (clarification register).

## 2. Mechanisms

### Passwords and login (REQUIRED: Argon2id)
- **Hashing:** Argon2id with 19 MiB memory, t=2, p=1 (OWASP baseline parameters, DESIGN DECISION).
- **Timing:**
  - unknown emails are checked against a dummy hash;
  - registration hashes before the lookup, so timing does not reveal existing accounts.
- **Lockout (D3):**
  - after `AUTH_LOGIN_MAX_FAILURES` (default 8), new sign-ins pause for `AUTH_LOGIN_LOCKOUT_MINUTES` (default 15);
  - the lock is checked *before* the password, and a locked account answers exactly like a wrong password (`401 INVALID_CREDENTIALS`);
  - existing sessions keep working, so attackers cannot force-logout a victim;
  - the counter is an SQL increment, and one lockout email is sent per lock.
- **Throttling:**
  - a global IP throttler;
  - per-route IP limits;
  - a per-account throttler keyed on the normalized email (login 20, and register / resend / forgot 3, per 15 min).
  - These are in-memory per instance; multi-instance deployments need a shared store (RECOMMENDED EXTENSION, D4).

### Access tokens (REQUIRED: short-lived JWT)
- HS256 with the algorithm pinned, issuer and audience validated, 15-minute default TTL.
- Claims: `sub`, `sid`, `sv`.
- `JWT_ACCESS_SECRET_PREVIOUS` allows key rotation.
- Production boot rejects missing, weak or placeholder secrets and unsafe cookie/CORS combinations (`assertSafeConfiguration`).

### Single-use email tokens
- 32-byte opaque values; an HMAC digest is stored.
- **Lifetimes:** verification 60 min, reset 30 min, email change 60 min, MFA challenge 5 min.
- **Claiming:** a token is claimed inside the same transaction that applies its effect, so a crash cannot burn a token without effect, and two parallel uses cannot both succeed.
- **Pages:** the token is stripped from the URL. Pages send `Referrer-Policy: no-referrer` and `no-store`, and the token is consumed only by an explicit button press (a GET never consumes it).
- **Revocation:** password reset or change revokes outstanding reset, email-change, MFA-challenge and refresh tokens. Suspension and deactivation revoke every outstanding token.

### MFA (REQUIRED: TOTP)
- RFC 6238, 30-second step, ±1 step window.
- **Replay guard:** `mfaLastAcceptedStep` advances atomically, so each code is accepted at most once, even concurrently.
- **Storage:** secrets are AES-256-GCM encrypted (`MFA_ENCRYPTION_KEY`).
- **Enrollment:** pending enrollment expires after 10 minutes (D8). Enabling requires a valid code.
- **Recovery codes:** 10 single-use codes, Argon2-hashed, shown once. They can be regenerated with step-up.
- **Login challenge (D16):** opaque and single-use. The first verification attempt consumes it, and failures count toward lockout.
- **Disable:** requires the password plus TOTP or a recovery code (lost-device path), revokes other sessions and sends a notice.

### Step-up (reauthentication)
- **Required for:** change password, change email, revoke other sessions, MFA setup / disable / regenerate, deactivate, delete, and admin role change.
- **Factors:** the password, plus TOTP when MFA is on (D6 for change-password).
- **Failures:** `403`, never 401 (D5), and they count toward lockout (D7).

### Sessions
- `AUTH_MAX_SESSIONS` (default 8). The oldest sessions are evicted first, audited as `SESSION_LIMIT_REVOKED`.
- **Revocation options:**
  - one device (`DELETE /auth/sessions/:id`);
  - all others (step-up);
  - everything including this device (`POST /auth/logout-all`).

### Audit and logging (REQUIRED)
- Security events record the actor, subject, outcome, correlation ID, a peppered IP digest and a sanitized context. Keys containing token, password, secret or hash are stripped.
- The admin audit API returns only allowlisted context keys (D12).
- **Logs:**
  - JSON in production (`LOG_FORMAT`);
  - the access log records method, path *without* query string, status and duration, with no IPs, headers or bodies;
  - correlation IDs are charset-checked.

### Email (DESIGN DECISION)
- **Transport:** real SMTP through nodemailer (Mailpit locally). Nothing is simulated: if SMTP fails, nothing is delivered and the failure is logged with the recipient masked.
- **Enumeration safety:** register, forgot and resend always return the same generic response, and the UI never claims "email sent".
- **Wording:** templates state expiry and single use. A support link appears only when `EMAIL_SUPPORT_URL` is set.
- **Security notices** are always sent. `notifyEmailSecurity` is stored but not consulted (D17).
- RECOMMENDED EXTENSION: an outbox with retry.

### Retention and maintenance (D13, D14)
- **Command:** `npm run maintenance -w @mtrs/api` (dry run by default; `-- --apply` deletes).
- **Purged:** expired or revoked sessions and tokens older than `AUTH_TOKEN_RETENTION_DAYS`, used recovery codes, and audit events older than `AUTH_AUDIT_RETENTION_DAYS`.
- **Kept:**
  - used refresh tokens, until they expire, so replays are still detected;
  - anonymised accounts, which are counted but never hard-deleted.
- Run it from an external scheduler.

## 3. Access and policy matrix

| Capability | Guest | Investor (own data) | Investor (other user's data) | Admin |
|---|---|---|---|---|
| Register / login / verify / reset | Yes | — | — | — |
| `/auth/me`, preferences, dashboard context | No (401) | Yes | n/a: always scoped to the caller | Own only |
| List / revoke own sessions | No | Yes | 404 for a foreign session ID | Own only |
| Change password / email, MFA, deactivate, delete | No | Yes, with step-up | — | Own only, with step-up |
| Future private resources (portfolio, orders, jobs) | No | `canReadOwnResource` / `canModifyOwnResource` (ACTIVE) | 404 `RESOURCE_NOT_FOUND` | 404 by default (no implicit access) |
| Run a simulation | No | `canExecuteSimulation` (owner + quota) | 404 | Same as investor |
| `/admin/*` (users, status, role, audit) | No (401) | 403 | 403 | Yes (with MFA when required) |
| Change own role / status | — | No such endpoint | — | 403 `SELF_DEMOTION_FORBIDDEN` / `SELF_STATUS_CHANGE_FORBIDDEN` |
| Demote / suspend the last active admin | — | — | — | 403 `LAST_ADMIN_PROTECTION` (409 `CONCURRENT_UPDATE` on a race) |

## 4. Clarification register (NEEDS CLARIFICATION)

| Topic | Current behaviour | Needs |
|---|---|---|
| Business roles beyond INVESTOR / ADMIN (advisor, instructor, data sharing) | Not modelled | Client definition |
| Retention windows | 30-day tokens, 365-day audit, 30-day pending deletion (defaults only) | Legal/product approval |
| Account deletion | Immediate anonymisation + `PENDING_DELETION`; simulation records are not cascaded (none exist yet) | Final deletion and erasure policy |
| Admin MFA mandatory | On by default in production | Confirm as policy |
| Notification preferences | Stored, not consulted | Decide whether security emails can be opted out of (not recommended) |
| Email outbox / retry | Not implemented | Delivery guarantees |
| Shared rate-limit store | In-memory per instance | Deployment topology |
