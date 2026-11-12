# Feature parity matrix

Inventory: every `page.tsx` under `apps/web/src/app` (37 routes), plus the shared layout features. Phase 1 documents said 38 routes; that was a miscount (the Phase 1 table itself listed 2 + the redirect + 34 = 37). For each item, the status is the highest gate it has actually passed. *Visually verified* implies the functional and contract checks listed for it.

**Summary: 16 of 37 routes are migrated and verified: 15 screens plus the `/settings` redirect, together with the workspace shell. The other 21 routes are not started; Angular shows an explicit "not migrated yet" notice for them, and they are not counted as migrated. The Next.js `not-found`, `error` and `global-error` boundaries are not counted as routes.**

Migrated routes: `/login`, `/register`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`, `/confirm-email-change`, `/unauthorized`, `/settings/profile`, `/settings/security`, `/settings/sessions`, `/admin`, `/admin/users`, `/admin/users/[id]`, `/admin/audit`, and `/settings` (which renders only a redirect, but is a `page.tsx` in Next.js).

Database compatibility applies to every row: both backends read and write the same Prisma tables on `PIF_spring_test` with no schema change. Rows written by one API are used by the other in the differential and browser runs (users, sessions, refresh, verification, reset and e-mail-change tokens, MFA secrets and recovery codes, audit events).

Evidence keys:
- **U:** Angular unit tests (`apps/web-angular`, `ng test`): 151/151 in 15 files.
- **J:** browser journeys on Angular + Spring, with Next.js + NestJS for the cross-app steps. `angular-auth-journey.mjs` passed 23/23; `angular-identity-journey.mjs` passed 61/61 (J1–J10, MT1–MT9).
- **V:** pixel comparison against Next.js at 1440/768/375 px; see [UI_VISUAL_PARITY.md](UI_VISUAL_PARITY.md).
- **C:** differential API contract tests: Phase 1 suite 58/58, identity suite 216/216.

## Migrated

| Feature | Next.js route → Angular route | NestJS endpoint → Spring endpoint (same path) | Status | Tests executed | Remaining differences |
| --- | --- | --- | --- | --- | --- |
| Sign-in, password step | `/login` → `/login` (`auth/login`) | `POST /api/auth/login` | Visually verified | U (8 ported tests), J, V `login` (light+dark ×3 widths, validation, error), C | none known |
| Sign-in, MFA step | same | `POST /api/auth/mfa/verify-login` | Visually verified | U, J (TOTP, wrong code, recovery code single use), V `login-mfa` ×3, C | none known |
| Registration | `/register` → `/register` (`auth/register`) | `POST /api/auth/register` | Visually verified | U (6), J1, V `register` (light+dark ×3, validation, password strength), C | none known |
| E-mail verification link | `/verify-email` → `/verify-email` | `POST /api/auth/verify-email` | Visually verified | U, J1 (token removed from URL, single use, welcome mail), V `verify-email-link` ×3, `verify-email-missing-token`, C | Production host must send `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for this path |
| Resend verification | `/resend-verification` → same | `POST /api/auth/resend-verification` | Visually verified (no browser journey) | U, V `resend-verification` ×3, C | none known |
| Forgot password | `/forgot-password` → same | `POST /api/auth/forgot-password` | Visually verified | U, J3, V `forgot-password` (light+dark ×3), `forgot-password-sent`, C | none known |
| Reset password | `/reset-password` → same | `POST /api/auth/reset-password` | Visually verified | U, J3 (weak password keeps the link; old password refused), V `reset-password-handoff` ×3, `reset-password-form`, C | Same per-route header item as `/verify-email` |
| Confirm e-mail change | `/confirm-email-change` → same | `POST /api/auth/change-email/confirm` | Visually verified (no browser journey) | U, V `confirm-email-change-link` ×3, C | Same per-route header item |
| Access denied | `/unauthorized` → same | — | Visually verified | U, J8, V `unauthorized` ×3, `admin-forbidden-investor` | none known |
| Settings › Profile | `/settings/profile` → same | `GET/PATCH /api/auth/me`, `PATCH /api/auth/me/preferences` | Visually verified | U, J (save persisted in PostgreSQL and visible in Next.js), V, C | none known |
| Settings › Security: password change, e-mail change, MFA enrolment/disable/regenerate, deactivation, deletion | `/settings/security` → same | `POST change-password`, `change-email/request`, `mfa/setup`, `mfa/enable`, `mfa/disable`, `mfa/recovery-codes/regenerate`, `GET mfa/status`, `POST me/deactivate`, `DELETE me`, `GET /api/users/me/dashboard-context` | Visually verified | U (12), J5 (enrolment, recovery codes shown once, recovery sign-in), V (see UI doc), C | Password change, e-mail change, MFA disable/regenerate, deactivation and deletion are covered by U, C and V but not by a browser journey |
| Settings › Sessions: list, revoke one, sign out everywhere | `/settings/sessions` → same | `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `DELETE /api/auth/sessions`, `POST /api/auth/logout-all` | Visually verified | U (8), J6, MT1, V (see UI doc), C | "Sign out everywhere" is covered by U, C and the dialog capture, not by a journey |
| Administration overview | `/admin` → same | `GET /api/admin/overview` | Visually verified | U (10 admin tests), J9, V `admin-overview` | none known |
| User list (search, filters, pagination) | `/admin/users` → same | `GET /api/admin/users` | Visually verified | U, J9, V `admin-users`, C (20 query variants) | none known |
| User detail: status and role changes | `/admin/users/[id]` → `/admin/users/:id` | `GET /api/admin/users/:id`, `PATCH …/status`, `PATCH …/role` | Visually verified | U, J9 (suspend, reactivate, promote with step-up, demote), V `admin-user-detail`, `admin-role-dialog`, C | none known |
| Audit log | `/admin/audit` → same | `GET /api/admin/audit-events` | Visually verified | U, J9, V `admin-audit`, C (15 query variants) | Invalid ISO week/basic dates: NestJS 500, Spring 400 (documented fix) |
| Admin access control | `admin/layout.tsx` (`ProtectedRoute roles={['ADMIN']} requireEmailVerified`) → `adminGuard` | server-side `RolesGuard` → `RolesInterceptor` | Functionally verified | U (`guards.spec.ts`), J8 (investor → `/unauthorized`, UI never rendered, direct API call 403), `RolesInterceptorTest`, C | Admin-MFA requirement tested by unit tests only (flag off in development) |
| Safe `returnTo` handling | `lib/auth/returnTo.ts` → `core/auth/return-to.ts` | — | Functionally verified | U, J (redirects identical to Next.js) | none known |
| Session restore, single-flight refresh, in-memory access token | `lib/api/client.ts`, `AuthProvider` → `core/api/api-client.ts`, `core/auth/*` | `POST /api/auth/refresh` | Functionally verified | U, J (reload; concurrent reload in two tabs; no token in storage) | none known |
| Multi-tab sign-in/sign-out sync (BroadcastChannel `mtrs-auth`) | same | `POST /api/auth/logout` | Functionally verified | J MT1–MT9 | none known |
| Protected-route gate ("Checking session…") | `ProtectedRoute` → `protected-route.component.ts` | — | Functionally verified | U, J | none known |
| Workspace shell: sidebar, collapse, breadcrumb, chips, theme toggle; profile menu; mobile drawer | `AppShell`, `ProfileDropdown` → `layout/*` | `GET /api/health` | Visually verified | U, J, V `settings-profile` ×3 ×2 themes, `shell-collapsed`, `profile-menu`, `mobile-drawer` | none known |
| Light/dark theme and accessibility preferences | `globals.css`, `ThemeToggle` → verbatim copy, `shared/theme-toggle` | — | Visually verified | V (light and dark), J (`data-reduce-motion`) | none known |
| `/settings` redirect | `app/settings/page.tsx` → route redirect | — | Functionally verified | U | none known |

## Not started (21 routes; Angular shows an explicit "not migrated yet" notice)

| Route(s) | Area | Notes |
| --- | --- | --- |
| `/` | Landing page | Angular serves the public "Not available yet" page |
| `/dashboard` | Overview | Default page after sign-in; currently the notice inside the shell |
| `/markets`, `/trading`, `/portfolios` | Virtual trading | Needs the trading API slice; the financial core is ported ([FINANCIAL_PARITY.md](FINANCIAL_PARITY.md)) |
| `/risk`, `/strategies`, `/backtesting`, `/ai`, `/stress-testing`, `/explainability` | Preview modules ("backend pending" in Next.js too) | |
| `/learn`, `/learn/missions/[slug]`, `/learn/sessions/[id]`, `/learn/sessions/[id]/review` | MarketQuest and Time Machine | |
| `/stories` | FinStories | Must keep the current design: no mandatory A/B buttons |
| `/challenges` | Challenges | |
| `/actuarial`, `/actuarial/pricing`, `/actuarial/monte-carlo`, `/actuarial/reserving` | Actuarial Lab | See [ACTUARIAL_PARITY.md](ACTUARIAL_PARITY.md). Portfolio-loss insurance must not be reintroduced |

## Gaps closed in this phase

| Gap (Phase 1) | Resolution | Evidence |
| --- | --- | --- |
| A non-admin typing `/admin…` saw the "not migrated" notice instead of `/unauthorized` | `adminGuard` on the admin route and its children; the API refuses the calls independently | `guards.spec.ts`; J8 |
| Multi-tab sync was migrated but unverified | Two-tab browser checks MT1–MT9 | identity journey |
| No lockout e-mail from Spring | Spring mail module; one notice per lock | differential "exactly one lockout notice" |


## Gate M (2026-11-12)

Active implementation is Spring Boot + Angular only. Nest/Next removed from the active tree. See FINAL_ACCEPTANCE_REPORT.md.

