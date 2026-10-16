# Identity requirements matrix (traceability)

| ID | Requirement | Frontend evidence | API expectation |
| --- | --- | --- | --- |
| ID-01 | Register with validated profile + password | `/register`, `registerSchema` | `POST /auth/register` |
| ID-02 | Login with email/password | `/login` | `POST /auth/login` |
| ID-03 | Email unverified login state | Login branch → resend link | Login returns `EMAIL_UNVERIFIED` |
| ID-04 | MFA challenge after password | Login MFA form | Login returns `MFA_REQUIRED` + `mfaToken`; `POST /auth/mfa/verify` |
| ID-05 | Show/hide password | `PasswordField` | n/a |
| ID-06 | Verify email only on explicit confirm (no GET consume) | `/verify-email` button → POST; `replaceState` strips token | `POST /auth/verify-email` |
| ID-07 | Resend verification | `/resend-verification` | `POST /auth/resend-verification` |
| ID-08 | Forgot password | `/forgot-password` | `POST /auth/forgot-password` |
| ID-09 | Reset password with token handoff + confirm | `/reset-password` | `POST /auth/reset-password` |
| ID-10 | Access token in memory only | `tokenStore.ts` | Access JWT in JSON body; refresh HttpOnly cookie |
| ID-11 | credentials include on auth | `api/client.ts` | Cookie `mtrs_refresh` |
| ID-12 | Single-flight refresh + one 401 retry | `refreshAccessToken` | `POST /auth/refresh` |
| ID-13 | Cross-tab logout | `BroadcastChannel` `mtrs-auth` | `POST /auth/logout` clears cookie |
| ID-14 | Same-origin `returnTo` | `sanitizeReturnTo` | n/a |
| ID-15 | Authenticated dashboard shell | `/dashboard` + `AppShell` | `GET /me` |
| ID-16 | Profile settings | `/settings/profile` | `PATCH /me` |
| ID-17 | Security: password, email, MFA, deactivate/delete | `/settings/security` | `/me/password`, `/me/email-change`, `/me/mfa/*`, `/me/deactivate`, `DELETE /me` |
| ID-18 | Session list/revoke | `/settings/sessions`, `SessionCard` | `/me/sessions` |
| ID-19 | Admin overview from API | `/admin` | `GET /admin/overview` |
| ID-20 | Admin users search/filter/pagination | `/admin/users` | `GET /admin/users` |
| ID-21 | Admin user detail | `/admin/users/[id]` | `GET|PATCH /admin/users/:id` |
| ID-22 | Unauthorized page | `/unauthorized` | 403 → gate redirect |
| ID-23 | Role gate for admin | `ProtectedRoute roles={['ADMIN']}` | Admin authorization |
| ID-24 | Accessible forms / focus / reduced motion | globals + components | n/a |
| ID-25 | No fake portfolio returns | Dashboard modules marked unavailable | n/a |
