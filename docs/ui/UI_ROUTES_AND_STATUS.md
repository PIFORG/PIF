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
| `/markets` | LIVE_INTEGRATED | Instruments, quotes, change since close, watchlist and provider details from `/api/market/*`. Prices are labelled fictional. |
| `/trading` | LIVE_INTEGRATED | Order ticket with server preview and confirmation, chart, positions, working orders and trades. See `docs/trading/README.md`. |
| `/portfolios` | LIVE_INTEGRATED | Portfolios, deposits and withdrawals, performance, risk, stress, reconciliation and full history. |
| `/risk` | DESIGNED_PENDING_BACKEND | Needs risk metrics, contributions and correlation APIs. |
| `/strategies` | DESIGNED_PENDING_BACKEND | Strategy builder plus backtest summary. |
| `/backtesting` | DESIGNED_PENDING_BACKEND | Highlights "Strategies & Backtesting" in the sidebar. |
| `/ai` | DESIGNED_PENDING_BACKEND | No AI score is shown until a real model exists. |
| `/explainability` | DESIGNED_PENDING_BACKEND | Attribution and importance layouts. |
| `/stress-testing` | DESIGNED_PENDING_BACKEND | Scenario, capital path and loss breakdown layouts. |
| `/actuarial` | LIVE_INTEGRATED | Actuarial Lab overview: reference portfolio priced by the API, its loss distribution, workspace statuses with links to the available workspaces, recent saved scenarios, recent simulation runs and recent reserving runs. Economic Capital and ALM tabs are shown as planned and are not links. See `docs/actuarial/README.md`. |
| `/actuarial/pricing` | LIVE_INTEGRATED | Claims & Pricing Studio: assumption form priced by `/api/actuarial/pricing/calculate`, premium build-up, loss distribution, frequency, severity, sensitivities and saved scenarios. All figures are labelled model estimates from fictional assumptions. |
| `/actuarial/monte-carlo` | LIVE_INTEGRATED | Monte Carlo Lab: seeded simulation by `POST /api/actuarial/simulations`, simulated KPIs, distribution, threshold probabilities, simulated-against-exact tables with 95% intervals, exceedance and convergence charts, stored runs with load and delete. Results are labelled simulated, with their seed. On a database without the simulation migration, runs are refused with a plain-English explanation. |
| `/actuarial/reserving` | LIVE_INTEGRATED | Reserving Studio: paid and incurred triangles (fictional examples or pasted), analysed by `POST /api/actuarial/reserving/analyze`; development factors with selections, chain ladder, expected loss ratio and Bornhuetter–Ferguson; case reserves, IBNR and unpaid; paid against incurred; sensitivities; expected payments; saved runs with load and delete. Figures are labelled deterministic best estimates, undiscounted, not regulatory provisions. On a database without the reserving migration, calculations work and saving runs is refused with a plain-English explanation. |
| `/learn` | LIVE_INTEGRATED | MarketQuest Learning Hub: profile, missions by level, competencies, recommendations, recent results. See `docs/learning/README.md`. |
| `/learn/missions/[slug]` | LIVE_INTEGRATED | Mission briefing; starts or resumes a server-side mission session. |
| `/learn/sessions/[id]` | LIVE_INTEGRATED | Mission player. Every action is a server command; the browser never computes fills or scores. |
| `/learn/sessions/[id]/review` | LIVE_INTEGRATED | Assessment, rule-based debrief, Financial Time Machine (replay branches, side-by-side comparison). |
| `/stories` | LIVE_INTEGRATED | FinStories vertical feed. Motion graphics rendered from the story script; watch progress stored by the API. |
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
