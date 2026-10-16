# Transactional email flows

How every MTRS account email is produced, what it promises, and the code that keeps the promise. For setup see [transactional-email-setup.md](transactional-email-setup.md); for evidence see [transactional-email-test-report.md](transactional-email-test-report.md).

## Pipeline

```
UI action (apps/web)
  -> REST endpoint (AuthController / AdminController)
  -> AuthService / AdminService            business rules, cooldowns, generic responses
  -> Prisma transaction                    token issue (hash only) or atomic token claim + effect
  -> EmailService.sendX()                  fire-and-forget; failure never changes the HTTP response
  -> email.templates.ts                    subject, preheader, HTML + text
  -> MailTransport                         preview (.eml on disk) | smtp (Nodemailer, TLS, retries)
  -> user opens link  ->  /verify-email | /reset-password | /confirm-email-change (Next.js)
  -> page strips the token from the URL, shows a button
  -> button click  ->  POST with the token in the JSON body  ->  atomic consumption
```

Opening a link (GET) never changes state. Corporate link scanners and previewers that prefetch URLs cannot verify, reset or move an account.

## Event catalogue

Only events that the backend actually emits are listed. There are no trading, AI-recommendation or stress-test emails.

| Template id | Trigger (endpoint / service) | Recipient | Primary action | Token |
|---|---|---|---|---|
| `verify-email` | `POST /auth/register`; `POST /auth/resend-verification`; duplicate registration of an unverified address | new address | Confirm email address → `/verify-email?token=` | `EMAIL_VERIFICATION`, `EMAIL_VERIFICATION_TOKEN_EXPIRES_IN_MINUTES` (60) |
| `welcome` | `POST /auth/verify-email` when it activates a `PENDING_VERIFICATION` account | account | Sign in → `/login` | none |
| `account-exists` | `POST /auth/register` for an already active address (once per cooldown) | existing owner | Sign in → `/login` | none |
| `reset-password` | `POST /auth/forgot-password` (verified, active accounts; once per cooldown) | account | Choose a new password → `/reset-password?token=` | `PASSWORD_RESET`, `PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES` (30) |
| `password-changed` (reset wording) | `POST /auth/reset-password` | account | Sign in | none |
| `password-changed` (change wording) | `POST /auth/change-password` | account | Review active sessions → `/settings/sessions` | none |
| `email-change-confirm` | `POST /auth/change-email/request` (only if the new address is free) | new address | Confirm new email → `/confirm-email-change?token=` | `EMAIL_CHANGE`, `EMAIL_CHANGE_TOKEN_EXPIRES_IN_MINUTES` (60) |
| `email-change-requested` | `POST /auth/change-email/request` (always) | current address | Review security settings | none; target address masked |
| `email-changed-old` | `POST /auth/change-email/confirm` | old address | none (that address can no longer sign in) | none; new address masked |
| `email-changed-new` | `POST /auth/change-email/confirm` | new address | Sign in | none |
| `mfa-enabled` | `POST /auth/mfa/enable` | account | Review security settings | none; no secret, no codes |
| `mfa-disabled` | `POST /auth/mfa/disable` | account | Review security settings | none |
| `mfa-recovery-codes-regenerated` | `POST /auth/mfa/recovery-codes/regenerate` | account | Review security settings | none; codes are never emailed |
| `account-locked` | failed-login lockout in `login()` | account | Reset your password → `/forgot-password` | none |
| `sessions-revoked` | `POST /auth/logout-all`, `DELETE /auth/sessions` | account | Sign in / Review sessions | none |
| `account-deactivated` | `POST /auth/me/deactivate`; admin status change | account | none | none |
| `account-suspended` | admin status change | account | none | none |
| `account-reactivated` | admin status change back from suspended/deactivated | account | Sign in, or Request a verification link when still unverified | none |
| `account-deletion-scheduled` | `DELETE /auth/me` | pre-anonymisation address | none | none |
| `smtp-test` | operator `npm run mail:verify -- --to …` | operator-chosen | none | none |

## Message anatomy (every template)

- Subject, hidden preheader, eyebrow, H1 title, greeting with the HTML-escaped first name (neutral "Hello," when empty).
- At most one primary button. Token links appear only in that button and in the visible fallback URL.
- Token links state the configured expiry and single use ("This link expires in 1 hour and can be used only once.") in an amber-ruled note. Plain navigation links never claim expiry.
- Footer: what to do if it was not you (no "ignore this" on security notices), "Need help?" only when `EMAIL_SUPPORT_URL` is set, unmonitored-replies note, simulation disclaimer.
- Both `text/html` and `text/plain` parts. The plain-text part carries the same facts and the full URL.

## Design system (`email.templates.ts`, `EMAIL_THEME`)

| Token | Value | Use |
|---|---|---|
| canvas | `#081322` | page background |
| card | `#0B1422` | content card, 1px `#1B2B40` border, 12px radius, 40px padding (28/20px under 620px) |
| heading | `#F4F8FF` | 27px title (24px mobile) |
| body | `#B8C8DA` | 16px copy, 1.6 line height |
| muted | `#8A9BB0` | labels, footer |
| primary | `#2563EB` | the single CTA |
| accent | `#38BDF8` | eyebrow, rule, links |
| attention | `#F5B544` | expiry note rule only |

600px max container, `Arial, Helvetica, sans-serif`, table layout with inline styles, no scripts, images, web fonts, forms or remote assets. The wordmark is text ("M" tile + "MTRS." + full name), so nothing has to load. It is original MTRS branding; no third-party product names, logos or domains appear in any template (unit-tested).

## Copy accuracy rules (checked against the services)

| Claim in copy | Backed by |
|---|---|
| Reset "signs you out on every device and cancels any pending email change" | `resetPassword` revokes all sessions and `revokeOutstandingTokens` (includes `EMAIL_CHANGE`) |
| After reset: "Every device was signed out" | same transaction |
| After signed-in change: "Other devices were signed out" | `changePassword` revokes all sessions, then issues a new one for the caller |
| Email change: "all sessions were signed out" | `confirmEmailChange` revokes all sessions and bumps `securityVersion` |
| Old address: "password reset links now go to the new address" | reset is keyed by the account email, which has moved |
| MFA off: "recovery codes were invalidated. Other devices were signed out." | `mfaDisable` deletes codes and revokes other sessions |
| Reactivation of an unverified account does not promise sign-in | admin service moves it to `PENDING_VERIFICATION` |
| Lockout: "Devices that are already signed in are not affected" | lockout only blocks new logins |

## Token security model

- 32 random bytes, hex encoded. Only `HMAC-SHA-256(AUTH_TOKEN_PEPPER, token)` is stored (`auth_tokens.token_hash`).
- Scoped by `type`; email-change tokens carry `pendingEmail`.
- Issuing a token revokes earlier unused tokens of the same type for that user, so only the newest link works.
- Consumption is a conditional `updateMany … where usedAt IS NULL AND revokedAt IS NULL AND expiresAt > now` inside the same transaction as the effect. Exactly one concurrent request can win (tested with 5–6 parallel requests).
- Credential and ownership changes revoke outstanding reset, email-change, MFA-challenge and refresh tokens.
- Raw tokens never appear in API responses, logs (recipients are masked as `ad***@domain`), audit events, Swagger examples or `localStorage`. Token pages send `Referrer-Policy: no-referrer` and `Cache-Control: no-store` and remove the token from the address bar on load.
- Resend, forgot-password and account-exists notices share the `AUTH_EMAIL_COOLDOWN_SECONDS` cooldown, and their responses are identical for known and unknown addresses.

## Delivery semantics

Sends are fire-and-forget. The HTTP response is decided before delivery and never depends on it, so responses cannot be used to probe account existence. A failed send is logged with a masked recipient and the error code. The SMTP transport retries transient failures (4xx replies, connection and timeout errors) twice with 1 s and 4 s backoff and never retries permanent ones (5xx, authentication). There is no persistent outbox: if the relay is down for longer than the retry window, the user re-requests (resend and forgot-password are both available). A durable queue is a recorded follow-up, not implemented.

## Phase 0 gap checklist (audit result → resolution)

| Gap found | Resolution |
|---|---|
| SMTP pointed at `localhost:1025` with nothing listening: every email failed silently | `MAIL_TRANSPORT=preview` local capture, boot-time `transporter.verify()` that logs the failure loudly, operator `npm run mail:verify` |
| No way to see an email without Docker/Mailpit | RFC 5322 `.eml` capture + loopback-only preview inbox (`npm run mail:inbox`) |
| Preview could be mistaken for delivery | log lines say "captured to local preview (not delivered)" or "accepted by SMTP relay (inbox delivery not confirmed)"; production refuses preview at env validation and in the service constructor |
| Production could boot with a localhost relay or `@localhost` sender | env validation rejects loopback `SMTP_HOST`, reserved sender domains, plaintext SMTP and a user without a password |
| Light teal templates, no preheader | dark MTRS template system with preheaders |
| No recovery-codes-regenerated notice | added, wired to `mfaRegenerateRecovery` |
| No welcome after verification | added, only when verification activates the account |
| Reset completion said "other devices" | separate reset/change wording |
| Reactivation promised sign-in to unverified accounts | conditional wording and CTA |
| Old-address notice advised a reset that would go to the new address | replaced with "contact your MTRS administrator" guidance |
| No `.env.example` in the repository | `apps/api/.env.example` with names and safe placeholders only |
| DB e2e suite had never run (no `_test` database) | `PIF_test` created and migrated; both suites run there |
