# Identity implementation plan (greenfield)

**Discovery note:** This monorepo started greenfield. At plan time, `apps/api` held Prisma identity schema / Nest package scaffolding without a complete NestJS source tree, and `apps/web` did not yet exist. Frontend work therefore defines a conventional REST contract against `http://localhost:3001/api` that the NestJS identity module is expected to implement.

## Goals

- Cookie-based refresh (`mtrs_refresh`, `credentials: 'include'`) with Bearer access JWT held **only** in React memory.
- Full investor/admin identity UX: register → verify → login (incl. MFA) → dashboard → settings → admin.
- No invented market/portfolio numbers; no TaxGain branding.

## Frontend (`apps/web` / `@mtrs/web`)

| Area | Approach |
| --- | --- |
| Framework | Next.js 15 App Router, React 19, TypeScript |
| Forms | React Hook Form + Zod |
| Styling | Global CSS variables + CSS modules; trading-desk palette |
| Auth session | `AuthProvider` + in-memory token store + single-flight refresh + BroadcastChannel logout |
| Guards | `ProtectedRoute`, `PermissionGate`, sanitized `returnTo` |

## Expected API surface (wired by web client)

- `POST /auth/register|login|logout|refresh|verify-email|resend-verification|forgot-password|reset-password`
- `POST /auth/mfa/verify`
- `GET|PATCH|DELETE /me`, `POST /me/password`, `POST /me/email-change`, `POST /me/deactivate`
- `GET|DELETE /me/sessions`, `DELETE /me/sessions/:id`
- `POST /me/mfa/enroll|confirm|disable`, `POST /me/mfa/recovery-codes`
- `GET /admin/overview`, `GET|PATCH /admin/users`, `GET|PATCH /admin/users/:id`

## Phased delivery

1. **Scaffold web app** — package workspace, env, design tokens, AuthProvider, API client.
2. **Public auth routes** — landing, register, login, verify, resend, forgot/reset.
3. **Authenticated shell** — dashboard, settings (profile/security/sessions).
4. **Admin** — overview + users list/detail with real API calls.
5. **Hardening** — open-redirect blocking, 401 retry, cross-tab logout, a11y.

## Dependencies / blockers

- NestJS API controllers must exist and match the paths/DTOs above (or the web client paths should be adjusted once OpenAPI is published).
- PostgreSQL + Mailpit via `docker-compose` for end-to-end auth email flows.
- CORS must allow `http://localhost:3000` with credentials; refresh cookie path `/api/auth`.
