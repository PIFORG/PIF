# UI routes and status

Every screen states where its data comes from. Status values:

- **LIVE_INTEGRATED**: reads and writes the real MTRS API.
- **DEMO_EXPLICITLY_LABELLED**: renders fictitious fixtures from `apps/web/src/lib/demo/` behind an explicit user action, with a visible "Sample data" label on every surface.
- **DESIGNED_PENDING_BACKEND**: designed screen; the engine or API does not exist yet. The screen shows layout, planned capabilities, key concepts and the proposed backend contract. It never shows prices, orders, balances, P&L, AI scores or results.

The sidebar status comes from `apps/web/src/lib/navigation/workspaceNav.ts`. Module content comes from `apps/web/src/lib/modules/moduleCatalog.ts`.

## Public and auth

| Route | Status | Access | Notes |
| --- | --- | --- | --- |
| `/` | LIVE_INTEGRATED (static) | Public; authenticated users are redirected to `/dashboard` | Hero, sample-labelled product preview, capability pillars, three-step workflow, honest availability, disclaimer, footer. No testimonials or metrics. |
| `/login` | LIVE_INTEGRATED | Public | Split-screen `AuthLayout`. MFA challenge, safe `returnTo`. Logic unchanged. |
| `/register` | LIVE_INTEGRATED | Public | Password rule: 8–128 characters with a letter, a number and a symbol. |
| `/forgot-password`, `/reset-password` | LIVE_INTEGRATED | Public | Reset token is not consumed until submit. Needs SMTP to receive the email. |
| `/verify-email`, `/resend-verification` | LIVE_INTEGRATED | Public | Verification runs only on click. Needs SMTP. |
| `/confirm-email-change` | LIVE_INTEGRATED | Public (token) | Token is stripped from the address bar. Needs SMTP. |
| `/unauthorized`, 404, error pages | Static | Any | Existing pages restyled by tokens. |

## Workspace (signed in, inside `AppShell`)

| Route | Status | Data |
| --- | --- | --- |
| `/dashboard` | LIVE_INTEGRATED + DEMO_EXPLICITLY_LABELLED | Live: user, dashboard context (modules, capabilities, required actions), sessions, account readiness. Market panels show "not connected" empty states. "Explore sample workspace" switches the market panels to labelled fixtures; the choice is not persisted. |
| `/markets` | DESIGNED_PENDING_BACKEND | Needs instruments, quotes, candles and watchlists APIs. |
| `/trading` | DESIGNED_PENDING_BACKEND | Order ticket is rendered inside a disabled `fieldset` with a written reason. Nothing can be submitted. |
| `/portfolios` | DESIGNED_PENDING_BACKEND | Needs portfolios, positions and performance APIs. |
| `/risk` | DESIGNED_PENDING_BACKEND | Needs risk metrics, contributions and correlation APIs. |
| `/strategies` | DESIGNED_PENDING_BACKEND | Strategy builder plus backtest summary. |
| `/backtesting` | DESIGNED_PENDING_BACKEND | Highlights "Strategies & Backtesting" in the sidebar. |
| `/ai` | DESIGNED_PENDING_BACKEND | No AI score is shown until a real model exists. |
| `/explainability` | DESIGNED_PENDING_BACKEND | Attribution and importance layouts. |
| `/stress-testing` | DESIGNED_PENDING_BACKEND | Scenario, capital path and loss breakdown layouts. |
| `/actuarial` | DESIGNED_PENDING_BACKEND | Assumptions, reserves and life table layouts. |
| `/learn` | DESIGNED_PENDING_BACKEND | Academy paths and lessons. |
| `/challenges` | DESIGNED_PENDING_BACKEND | Challenges and leaderboard layouts. |
| `/settings/profile` | LIVE_INTEGRATED | Profile, preferences, email change, deactivate and delete account. |
| `/settings/security` | LIVE_INTEGRATED | Password change, MFA enrolment and recovery codes. |
| `/settings/sessions` | LIVE_INTEGRATED | List, revoke one, revoke others, sign out everywhere. |

## Administration (ADMIN role, verified email, MFA enforced by the API)

| Route | Status | Data |
| --- | --- | --- |
| `/admin` ("Platform") | LIVE_INTEGRATED | Overview counts and recent events. |
| `/admin/users`, `/admin/users/[id]` | LIVE_INTEGRATED | Search, role and status changes, with the last-admin rule. |
| `/admin/audit` | LIVE_INTEGRATED | Paginated audit log. |

The administration group is hidden from investors. Visiting `/admin` as an investor lands on `/unauthorized` (verified in the browser).

## Shell status chip

The top bar shows a "Simulated" tag, service health from `GET /api/health`, the clock in the user's preference time zone, the theme switch and the account menu.

Health results are cached for 60 seconds across pages. A rate-limited (429) response hides the chip rather than claiming the API is down.
