# Identity API contract (sample shapes, no secrets)

- **Base URL:** `http://localhost:3001/api` (`APP_API_URL` + `API_PREFIX`).
- **Authentication:**
  - protected routes take `Authorization: Bearer <access JWT>`;
  - the browser refresh credential is the HttpOnly cookie `mtrs_refresh` (`Path=/api/auth`), used only by `/auth/refresh`, `/auth/logout` and the cookie-clearing routes.
- **Headers:**
  - every response carries `Cache-Control: no-store` and an `X-Correlation-Id`;
  - a client-supplied `X-Correlation-Id` is kept only if it matches `^[A-Za-z0-9._:-]{1,64}$`.

The route table below is derived from `auth.controller.ts`, `users.controller.ts` and `admin.controller.ts`.

- **Swagger UI:** `/api/docs`, with the OpenAPI JSON at `/api/docs-json`. It is on by default outside production and off in production unless `SWAGGER_ENABLED=true`.
- **Swagger "Try it out":** the CSRF guard trusts the API's own origin (`APP_API_URL`) in addition to `CORS_ORIGINS`.
- **Health:** `GET /api/health` is public. It returns `200 {"status":"ok","database":"up"}` or `503 {"status":"degraded","database":"down"}`.
- **Database outages:** outside production the API starts even when PostgreSQL is unreachable. Database-backed requests then fail with `503` / `DATABASE_UNAVAILABLE`; nothing returns a fake success, and authentication still applies. In production a failed startup connection stops the process.

## Error envelope

```json
{ "statusCode": 403, "message": "Administrators cannot demote themselves", "errorCode": "SELF_DEMOTION_FORBIDDEN", "correlationId": "uuid" }
```

Validation failures are `400` with `message: "Validation failed"`, `errorCode: "VALIDATION_ERROR"` and `details: string[]`.

**401 versus 403 (DESIGN DECISION D5):**
- `401` always means the access token is unusable, so the client refreshes once.
- A failed step-up (wrong password, wrong authenticator code) on an authenticated route is `403`.

## Sample flows

### Register: `POST /auth/register`

```json
{ "firstName": "Ada", "lastName": "Trader", "email": "ada@example.com", "password": "<8-128 chars: letter + number + symbol>", "passwordConfirmation": "<same>" }
```

`201`, with the same body whether or not the address is already registered:

```json
{ "message": "If this email can be registered, you will receive a verification message shortly." }
```

### Login: `POST /auth/login`

Success without MFA: `200`, the rotated `mtrs_refresh` cookie is set, and the refresh token is never in JSON.

```json
{
  "accessToken": "<jwt>",
  "user": {
    "id": "uuid", "email": "ada@example.com", "firstName": "Ada", "lastName": "Trader",
    "role": "INVESTOR", "status": "ACTIVE", "experienceLevel": "BEGINNER",
    "emailVerified": true, "mfaEnabled": false, "createdAt": "...", "lastLoginAt": "..."
  }
}
```

MFA enabled: no session is created yet. The challenge is opaque, single-use, valid for 5 minutes, and **consumed by the first verification attempt**.

```json
{ "mfaRequired": true, "mfaChallengeToken": "<opaque>" }
```

Wrong email, wrong password and locked account all return the same response: `401 INVALID_CREDENTIALS`. Status errors (`EMAIL_NOT_VERIFIED`, `ACCOUNT_SUSPENDED`, …) are disclosed only after a correct password.

### Refresh: `POST /auth/refresh`

The request is cookie-only, and the `Origin` must be allowlisted. A `200` returns `{ accessToken, user }` and rotates the cookie.

| Status | errorCode | Meaning | Cookie |
|---|---|---|---|
| 401 | `REFRESH_MISSING` / `REFRESH_INVALID` / `REFRESH_EXPIRED` | No usable token | Cleared |
| 401 | `REFRESH_SUPERSEDED` | Another tab rotated this token within the last 15 s. Retry with the current cookie. No token is issued. | **Kept** |
| 401 | `REFRESH_REUSE_DETECTED` | Replay of a rotated token. The whole session is revoked. | Cleared |

## Route table

Auth column: `P` = public, `B` = Bearer, `A` = Bearer + `ADMIN` role (+ MFA when `AUTH_ADMIN_MFA_REQUIRED`), `C` = refresh cookie.

**Step-up** means the body includes `password`, plus `totpCode` (6 digits) when the user has MFA enabled. A failed step-up is `403` and counts toward the sign-in lockout.

### `/auth`

| Method | Path | Auth | Body | Success |
|---|---|---|---|---|
| POST | `/auth/register` | P | `firstName, lastName, email, password, passwordConfirmation?` | 201 generic message |
| POST | `/auth/verify-email` | P | `token` | 200 |
| POST | `/auth/resend-verification` | P | `email` | 200 generic message |
| POST | `/auth/login` | P | `email, password` | 200 tokens, or `{ mfaRequired, mfaChallengeToken }` |
| POST | `/auth/mfa/verify-login` | P | `mfaChallengeToken`, `totpCode` or `recoveryCode` | 200 tokens + cookie |
| POST | `/auth/refresh` | C | — | 200 tokens + rotated cookie |
| POST | `/auth/logout` | C and/or B | — | 200; the matching session is revoked and the cookie cleared |
| POST | `/auth/logout-all` | B | — | 200; every session including this one is revoked, the cookie cleared, and a notice emailed |
| POST | `/auth/forgot-password` | P | `email` | 200 generic message |
| POST | `/auth/reset-password` | P | `token, password, passwordConfirmation` | 200; all sessions and credential tokens revoked |
| POST | `/auth/change-password` | B | `currentPassword, newPassword, newPasswordConfirmation, totpCode?` (required with MFA) | 200 `{ accessToken, user }` + new cookie; other sessions revoked |
| GET | `/auth/me` | B | — | sanitized user |
| PATCH | `/auth/me` | B | `firstName?, lastName?, experienceLevel?` | sanitized user |
| GET / PATCH | `/auth/me/preferences` | B | see the preferences section | preferences |
| POST | `/auth/change-email/request` | B | step-up + `newEmail` | 200 generic message. `429 EMAIL_CHANGE_COOLDOWN` within 60 s of the previous request |
| POST | `/auth/change-email/confirm` | P | `token` | 200; all sessions revoked; old and new addresses notified |
| GET | `/auth/sessions` | B | — | `[{ id, createdAt, lastSeenAt, expiresAt, deviceLabel, userAgent, current }]` |
| DELETE | `/auth/sessions/:id` | B | — | 200 (a foreign or absent id returns `404 RESOURCE_NOT_FOUND`) |
| DELETE | `/auth/sessions` | B | step-up | 200; all *other* sessions revoked |
| POST | `/auth/mfa/setup` | B | step-up | `{ secret, otpauth, expiresInMinutes: 10 }` (pending until enabled) |
| POST | `/auth/mfa/enable` | B | `totpCode` | `{ recoveryCodes: string[10] }`, shown once |
| POST | `/auth/mfa/disable` | B | `password` + (`totpCode` or `recoveryCode`) | 200; other sessions revoked |
| POST | `/auth/mfa/recovery-codes/regenerate` | B | step-up | `{ recoveryCodes }` |
| GET | `/auth/mfa/status` | B | — | `{ mfaEnabled, mfaVerifiedAt, remainingRecoveryCodes }` |
| POST | `/auth/me/deactivate` | B | step-up + `confirmation: "DEACTIVATE"` | 200; status DEACTIVATED, sessions and tokens revoked, cookie cleared |
| DELETE | `/auth/me` | B | step-up + `confirmation: "DELETE"` | 200; status PENDING_DELETION, profile anonymised immediately, sessions revoked, cookie cleared |

### `/users/me`

| Method | Path | Auth | Body | Success |
|---|---|---|---|---|
| GET / PATCH | `/users/me/preferences` | B | same as `/auth/me/preferences` | preferences |
| GET | `/users/me/dashboard-context` | B | — | see below; contains no financial figures |

### `/admin`

| Method | Path | Auth | Body / query | Success |
|---|---|---|---|---|
| GET | `/admin/overview` | A | — | `{ users: { total, active, pending, suspended, deactivated, verified, mfaEnabled }, recentEvents, eventTotals: { windowDays: 7, items } }` |
| GET | `/admin/users` | A | `page, pageSize (≤100), q, status, role, emailVerified=true\|false` | `{ page, pageSize, total, items }` |
| GET | `/admin/users/:id` | A | — | `{ user (no preferences), security: { locked, activeSessions }, auditSummary }` |
| PATCH | `/admin/users/:id/status` | A | `status, reason (3–200 chars)` | user detail |
| PATCH | `/admin/users/:id/role` | A | `role`, `password`, `totpCode?` (required when the admin has MFA) | user detail |
| GET | `/admin/audit-events` | A | `page, pageSize, eventType, outcome, actorUserId, subjectUserId, from, to` (ISO 8601) | `{ page, pageSize, total, items }`; `context` is reduced to an allowlist |

## Preferences

All preference fields are optional, and only real JSON booleans are accepted for the flags:

```json
{
  "preferredCurrency": "TND",
  "timezone": "Africa/Tunis",
  "chartTheme": "trading_desk",
  "trainingDifficulty": "adaptive",
  "notifyEmailSecurity": true,
  "notifyMarketDigest": false,
  "reduceMotion": false,
  "highContrast": false
}
```

- `preferredCurrency` must be an ISO 4217 code known to the runtime.
- `timezone` must be an IANA time zone, or `UTC`.
- `chartTheme` is one of `trading_desk | light | dark`.
- `trainingDifficulty` is one of `adaptive | beginner | intermediate | advanced`.
- `notifyEmailSecurity` and `notifyMarketDigest` are stored but not consulted yet (D17).

## Dashboard context

```json
{
  "user": { "...": "sanitized user" },
  "role": "INVESTOR",
  "experienceLevel": "BEGINNER",
  "experienceLevelNotice": "Experience level tailors learning content only. It is not an investment suitability assessment or a trading certification.",
  "capabilities": { "trading": true, "portfolio": true, "learning": true, "aiAnalysis": false, "stressTesting": false, "actuarial": true, "admin": false },
  "requiredActions": [],
  "modules": [{ "id": "portfolio", "label": "Virtual portfolio", "permitted": true, "available": true }, { "id": "ai", "label": "AI analysis", "permitted": true, "available": false }]
}
```

- A capability is `true` only when its module is both permitted and available (implemented). As of 9 Nov 2026, AI analysis and bank stress testing are not implemented and report `available: false`.
- `requiredActions` contains `ENROLL_MFA_FOR_ADMIN` when admin MFA is required but not yet enrolled.

## `errorCode` values

| Area | Codes |
|---|---|
| Generic | `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `CONFLICT`, `RATE_LIMITED` (429), `INTERNAL_ERROR`, `DATABASE_UNAVAILABLE` (503) |
| Credentials and account | `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_UNAVAILABLE`, `ACCOUNT_NOT_ELIGIBLE` |
| Access token | `INVALID_TOKEN`, `CREDENTIALS_ROTATED` (`securityVersion` changed), `SESSION_REVOKED` |
| One-time email tokens | `TOKEN_INVALID`, `EMAIL_CHANGE_FAILED`, `EMAIL_CHANGE_COOLDOWN` (429) |
| Refresh | `REFRESH_MISSING`, `REFRESH_INVALID`, `REFRESH_EXPIRED`, `REFRESH_SUPERSEDED`, `REFRESH_REUSE_DETECTED` |
| MFA | `MFA_REQUIRED`, `MFA_INVALID`, `MFA_NOT_ENABLED`, `MFA_SETUP_REQUIRED`, `MFA_SETUP_EXPIRED`, `ADMIN_MFA_REQUIRED` |
| Admin | `SELF_DEMOTION_FORBIDDEN`, `SELF_STATUS_CHANGE_FORBIDDEN`, `LAST_ADMIN_PROTECTION`, `STATUS_UNCHANGED`, `ROLE_UNCHANGED`, `CONCURRENT_UPDATE` (409) |
| Ownership contracts | `RESOURCE_NOT_FOUND` (missing *or* foreign), `SIMULATION_QUOTA_EXCEEDED` |
| CSRF | `CSRF_REJECTED` |
