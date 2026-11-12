# Learning module — Market Trading Room Simulator

The learning module is the **Learn** section of the Market Trading Room Simulator. It is not a separate application. It runs inside the same Next.js app and NestJS API, uses the same accounts, sign-in, roles and sessions, the same PostgreSQL database and Prisma schema, the same `AppShell`, sidebar and design system, and the same Swagger documentation.

It has three parts:
- **MarketQuest:** missions in a simulated market, with assessment and a competency profile.
- **Financial Time Machine:** replay a finished mission from any decision.
- **FinStories:** short decision stories.

**Where it connects to the rest of the simulator:**
- **Sidebar:** the *Learn* group (MarketQuest, FinStories, Challenges).
- **Mobile:** MarketQuest is in the bottom navigation.
- **Dashboard:** the *Learning path* panel shows live progress, an attempt to continue and recommended missions. The *Workstation modules* list reports the learning module as available, from `GET /users/me/dashboard-context`.
- **Accounts:** learning data belongs to the user account. Deleting the account deletes it through foreign-key cascades.
- **Home page:** the availability section lists the module as live.

Delivery status, test evidence and the self-review are in [`progress.md`](./progress.md).

| Area | Route | What it is |
| --- | --- | --- |
| MarketQuest Learning Hub | `/learn` | Profile, recommended level, missions by level, competency profile, recommendations, recent results, FinStories entry |
| Mission briefing | `/learn/missions/[slug]` | Situation, starting portfolio, rules, objectives, scoring weights, mentor style, related FinStory |
| Mission player | `/learn/sessions/[id]` | Market sandbox: chart (past only), quotes, order ticket, positions, orders, risk, news, objectives, mentor, stress test |
| Review and Time Machine | `/learn/sessions/[id]/review` | Assessment with evidence, debrief, confidence calibration, decision timeline, replay branches, side-by-side comparison |
| FinStories | `/stories` | Vertical 9:16 feed of short decision stories rendered as motion graphics |

## 1. Architecture

```
apps/api/src/finance/   Shared financial core, framework-free (see docs/architecture/financial-core.md)
  money.ts       Integer amounts in thousandths, rounding, commission
  execution.ts   Execution price, limit and stop triggers, depth, spread cost
  ledger.ts      Average-cost booking of executions, realised P&L, fees, invariants
  valuation.ts   Market values, equity, weights, exposure, HHI, unrealised P&L
  risk.ts        Drawdown, volatility, historical VaR/ES, scenario and stress P&L
  pretrade.ts    Pre-trade estimate and checks (holdings, cash with reservations, position limit)
apps/api/src/learning/
  engine/        Pure, deterministic TypeScript: no I/O, no clock, no randomness outside the seeded RNG
    money.ts       Learning names (millimes, 1 DT = 1000) for the core money functions
    rng.ts         Seeded PRNG + standard normals
    market.ts      One-factor seeded market path, bid/ask, depth, scripted events and regimes
    simulator.ts   Command reducer: PLACE_ORDER, CANCEL_ORDER, ADVANCE, RUN_STRESS_TEST, FINISH; replay()
    metrics.ts     Equity, P&L, drawdown, volatility, historical VaR/ES, HHI, exposure, costs
    objectives.ts  Objective evaluation (met / on track / missed)
    assessment.ts  Four-component assessment with evidence, competency observations, calibration
    mastery.ts     Recency- and assistance-weighted competency mastery
    mentor.ts      Rule-based mentor (GUIDED, SOCRATIC, CRITICAL, DEBRIEF)
    recommendations.ts
  missions/      Mission catalog (10 missions) + validation run at module load
  stories/       FinStories catalog (4 stories) + feed/progress service and controller
  learning.service.ts / learning.controller.ts / learning.view.ts   Persistence, authorization, views
apps/web/src/
  lib/api/learning.ts                 Typed client for the learning and stories endpoints
  components/learning/                Hub, briefing, player, review, ticket preview, shared parts
  components/learning/stories/        Feed, player, timeline helpers
  app/learn/**, app/stories/          Route pages (ProtectedRoute → AppShell)
```

### Server-authoritative play

- A session stores its **command log** (`learning_commands`), not a mutable portfolio. The state is rebuilt by replaying the log through the pure reducer on every request. The reducer is deterministic, and tests prove that rebuilding from the log gives a byte-identical state.
- Every command carries an **idempotency key** and the **expected sequence number**:
  - A retry with the same key returns the original result.
  - Reusing a key for a different command is rejected.
  - A stale `expectedSeq` returns `409 SEQUENCE_CONFLICT`. The player then reloads the session instead of guessing.
  - Unique indexes on `(session_id, seq)` and `(session_id, idempotency_key)` make concurrent submissions safe.
- The browser **never** computes fills, P&L, scores or mastery. The order-ticket preview (`ticket.ts`) is advisory only and labelled as an estimate. The server re-validates every command.
- Sessions, assessments, replays and story progress are scoped to the signed-in user. Another user's id returns 404. All routes require the existing JWT guard; nothing is public.
- No look-ahead: the session view, chart series and news include only steps up to the current one.

### Financial Time Machine (Mode A, controlled replay)

- `POST /learning/sessions/:id/branches { fromSeq, strategy }` creates a `REPLAY` session on the **same seeded market path**. It keeps every decision before `fromSeq`.
- `HOLD` replays those decisions and then holds to the end, which gives an instant result. `MANUAL` opens a playable replay from that point.
- `GET /learning/sessions/:a/compare/:b` returns both equity curves, metrics, assessments and the divergence point.
- **Replays are practice with hindsight.** They are assessed for comparison, but never create competency observations, so they cannot change the profile.

### Mentor

- `mentor.ts` is a deterministic, rule-based mentor. It is clearly labelled in the API (`source: "RULE_BASED"`, `sourceLabel: "Rule-based mentor (no AI provider configured)"`) and in the UI.
- It has four modes:
  - **GUIDED:** advice;
  - **SOCRATIC:** questions;
  - **CRITICAL:** challenge;
  - **DEBRIEF:** after the mission, built from the assessment evidence.
- It only sees what the learner can see at the current step.
- Asking the mentor during a mission marks the attempt **assisted**.
- No language model is called, and no provider key exists in the frontend or the backend.

## 2. Financial model

Everything is a **Market Simulation Sandbox** of fictional instruments. It is not historical data, not a forecast and not a "digital twin".

**Prices.** Log-returns follow a one-factor model with scripted events:

\[ r_i = \mu_i + \Delta\mu + \sigma_i\,m\,\big(\beta_i f + \sqrt{1-\beta_i^2}\,\varepsilon_i\big) + \ln(1+\text{jump}_i), \qquad f,\varepsilon_i \sim N(0,1) \]

- Event *regimes* temporarily scale volatility, drift, spread and depth.
- Random draws do not depend on events, so editing one event does not reshuffle the noise elsewhere.
- Each asset's mid at step 0 equals its configured opening price.
- Every mission has a fixed seed, so every learner sees the same path.

**Quotes.**
- Bid = mid − half-spread and ask = mid + half-spread, from the asset's spread in basis points, widened by regimes.
- **Depth** is the number of shares available at the best price in that step.

**Orders.**

| Type | Rule |
| --- | --- |
| MARKET | Immediate-or-cancel: a buy executes at the ask, a sell at the bid. Quantity above depth is partially filled; the rest is cancelled. |
| LIMIT | Good till the end of the mission. Buy limits reserve cash and fill when the ask crosses the limit. |
| STOP | Sell only. Triggers when the bid reaches the stop and **executes at the bid of that step**, so a gap passes straight through the stop price. |

- **Commission** = max(minimum fee, notional × bps / 10 000), per fill.
- Accounting uses weighted-average cost; commissions are included in the cost basis.
- The identity *equity − initial equity = realised + unrealised P&L* holds exactly at every step; it is tested on every playable mission.

**Rules and failure.**
- Missions can cap per-asset weight, restrict order types and allow stress tests.
- A `MAX_LOSS` breach ends the mission as FAILED and cancels open orders.
- Unfilled orders expire at the horizon.

**Risk metrics.**

| Metric | Definition |
| --- | --- |
| Max drawdown | Largest peak-to-trough fall of equity. |
| Volatility | Sample standard deviation of per-step returns; shown only from 5 returns. |
| VaR / ES (95 %, one step) | Historical simulation of the current holdings over every past one-step move. Shown only from 30 observations; otherwise "—". |
| HHI and effective number of assets | Concentration of invested weights. |
| Exposure, fees, spread cost, turnover | Self-explanatory. |

**Stress tests** revalue current holdings under the mission's named shocks. They never change the market.

## 3. Assessment and competencies

**Components and default weights:**

| Component | Default weight |
| --- | --- |
| Risk management | 40 % |
| Decision quality | 25 % |
| Reasoning | 20 % |
| Execution | 15 % |

- Weights are configurable per mission and validated to sum to 100.
- A component that cannot be judged (for example, reasoning when no order was placed) is shown as "not judged", and its weight is redistributed.

**Evidence each component looks at:**
- **Risk:** drawdown against the mission's reference, concentration discipline, stop coverage when stops are allowed.
- **Decision:** objectives achieved (required objectives count double), response to adverse events within two steps, overtrading.
- **Reasoning:** whether each order matched the reason given *at placement time* (`rationaleConsistent` uses only the order's context snapshot), and evidence gathered before acting (stress tests).
- **Execution:** rejected orders, order type against the liquidity at the time, cost efficiency.

**No reward for P&L alone and no hindsight.** Return is reported, but it is not a scored criterion. To pass, an attempt needs:
- no rule failure;
- every required objective met;
- a total at or above the mission's threshold.

**Confidence review** (Behavioral Finance Lab, `assessment-1.1`). It is **retrospective and never part of the score**. An unfavourable outcome is not treated as evidence of overconfidence.
- The learner may rate confidence on each order (required in mission 9).
- **Outcome side, market-adjusted.** A filled buy counts as favourable when its asset beat the mission's equal-weight universe from each fill to the end; a sell, when it lagged. A market-wide fall alone does not make a decision unfavourable. Orders with no time left after the fill are left out. The review shows mean confidence, the share that beat the market and the Brier score.
- **Sample size.** Below 10 compared outcomes, the review and the debrief say the outcomes are too few to read as over- or under-confidence. One mission (at most 6 orders in mission 9) is never enough. The hub shows the profile Brier score only from 10 outcomes, pooled over assessed missions and never from replays.
- **Decision-time signals** use only what was visible when the order was placed:
  - a confidence of 80 % or more within 2 days of an unconfirmed report (`unconfirmed: true` on the event) about the same asset;
  - the same confidence on every rated order (3 or more);
  - an average confidence of 80 % or more with more fills than the mission's reasonable trade count.
- Assessments stored by `assessment-1.0` (raw final price against fill price) keep their wording and are not pooled into the profile figure.

**Mastery** per competency (Market Understanding, Trading Execution, Risk Management, Portfolio Diversification, Strategic Reasoning):
- It is a weighted mean with recency decay (0.8 per older observation).
- Assisted attempts count at 0.7.
- Competencies the mission does not target are observed at weight 0.3.
- Assisted and unassisted scores are reported separately, with an evidence level: none, emerging, developing or established.

## 4. Missions

| # | Mission | Level | Availability |
| --- | --- | --- | --- |
| 1 | My First Trade | Rookie Trader | Implemented |
| 2 | Protect Your Capital | Rookie Trader | Implemented |
| 3 | The Diversification Challenge | Rookie Trader | Implemented |
| 4 | Breaking News | Market Strategist | Configured (playable, difficulty in review) |
| 5 | The Market Shock | Market Strategist | Implemented |
| 6 | The Sector Collapse | Market Strategist | Configured |
| 7 | The Interest Rate Shock | Market Strategist | Configured |
| 8 | The Liquidity Crisis | Risk Commander | Configured |
| 9 | The Overconfident Trader | Risk Commander | Implemented. Every order needs a confidence rating; an unrated order is refused (`422 CONFIDENCE_REQUIRED`) and not recorded |
| 10 | Survive the Market Crash (showcase) | Risk Commander | Implemented |

- **Showcase mission:** 100,000 DT concentrated portfolio, warning signs, then a crash, with a 10 % loss limit.
- **Levels** guide recommendations ("Recommended later"). They do not lock missions.

## 5. FinStories

| Story | Character | Skill | Related mission |
| --- | --- | --- | --- |
| Sarah and the Market Crash (showcase) | Sarah | Risk management | Survive the Market Crash |
| Adam's First Order | Adam | Trading execution | My First Trade |
| Youssef Goes All In | Youssef | Diversification | The Diversification Challenge |
| Youssef and the Gap | Youssef | Risk management | Protect Your Capital |

**Story structure.**
- Each story is a scene script: Setup → Decision → *If you chose A* → *Let's rewind* → *If you chose B* → Lesson. Each one lasts 90 seconds or less.
- At the decision, the narrator asks "What would YOU do? A or B? Choose in your head." **There are no A/B buttons**; the viewer watches both futures.
- A and B are written as genuine trade-offs: each path has a real advantage and a real cost.

**Sarah's numbers:**
- 10,000 DT invested; −15 % in a week, so 8,500.
- Selling locks in 8,457.50 after costs.
- Holding sees a trough of 7,480 (25.2 % below the start), then recovers to 9,350.

The lesson: a decision cannot be judged by its realised profit alone. Risk tolerance, horizon, information and objectives matter.

**Media.**
- Motion graphics are rendered in the browser from the scene script: intro, headline, allocation, chart, outcome counter, rewind effect, lesson points.
- Narration is optional browser text-to-speech; captions are on by default.
- **No video file is generated, stored or claimed.** The API stores only scene metadata (`media.kind = MOTION_GRAPHICS`).

**Player.**
- Controls: play/pause, previous/next scene, captions, narration, keyboard shortcuts (K, Space, arrows, M, C).
- The feed shows segment progress, a loading state and recommendations (weakest competency first), with the next story preloaded.
- Progress is saved every 5 seconds of playback, on pause and at the end, and the story resumes from the saved point.
- With reduced motion on, nothing autoplays and animations are static.

**Versioning.** Stories carry a version. Progress stores the scene being watched (`scene_id`) and the last version watched to the end (`completed_version`). After a story is edited:
- playback resumes at the start of the same scene, or at 0 if that scene no longer exists;
- the feed shows "Updated since you watched";
- an earlier completion is kept and shown as "Watched an earlier version".

## 6. API

All routes are under `/api`, require a bearer access token and are documented in Swagger (`/api/docs`, tags *Learning* and *Time Machine*). Mission routes allow 240 requests per minute per client, because a mission is one request per action. Story routes allow 120.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/learning/missions` | Catalog with availability, level and your progress |
| GET | `/learning/missions/:slug` | Briefing (no future data) |
| POST | `/learning/missions/:slug/sessions` | Start, or resume the active attempt (409 `MISSION_NOT_AVAILABLE` for planned missions) |
| GET | `/learning/profile` | Mastery, progress, recommendations, calibration |
| GET | `/learning/sessions` | Your sessions |
| GET | `/learning/sessions/:id` | Session view up to the current step |
| POST | `/learning/sessions/:id/commands` | `{ idempotencyKey, expectedSeq, command }` |
| POST | `/learning/sessions/:id/orders/preview` | `{ order }`: pre-trade check with the same rules as placing the order; returns `{ seq, accepted, code, message, estimate, warnings }` and records nothing (422 `NOT_AN_ORDER` for other commands) |
| POST | `/learning/sessions/:id/abandon` | Abandon (not assessed) |
| GET | `/learning/sessions/:id/assessment` | Assessment once the session has ended |
| POST | `/learning/sessions/:id/mentor` | Rule-based mentor or debrief |
| GET | `/learning/sessions/:id/timeline` | Decisions, equity curve, news, replays |
| POST | `/learning/sessions/:id/branches` | Rewind to a decision (`HOLD` or `MANUAL`) |
| GET | `/learning/sessions/:id/compare/:otherId` | Side-by-side comparison |
| GET | `/learning/stories` | Feed with progress and recommendation order |
| GET | `/learning/stories/:slug` | Full scene script |
| PUT | `/learning/stories/:slug/progress` | `{ positionMs, completed }` |

## 7. Database

The additive migration `apps/api/prisma/migrations/20261105120000_marketlab_learning` creates:

| Table | Contents |
| --- | --- |
| `learning_sessions` | Attempts and replays: kind, status, parent, branch point, last seq, assisted, mentor mode |
| `learning_commands` | Append-only command log; unique `(session_id, seq)` and `(session_id, idempotency_key)` |
| `learning_events` | Derived event journal |
| `learning_assessments` | One per session, with the engine version and full result JSON |
| `competency_observations` | One per (session, competency); never written for replays |
| `mentor_interactions` | Mode, rule id, step and response |
| `story_progress` | One per (user, story): version, position, completion |

- Two new enums are added: `LearningSessionStatus` and `LearningSessionKind`.
- Foreign keys go to `users` with `ON DELETE CASCADE`, so deleting an account removes its learning data.
- No existing table, column or row is changed.

## 8. Configuration

The learning module adds **no environment variables**. Mission and story content is versioned source code. The mission catalog is validated when the API starts, and an invalid mission stops start-up. The story catalog's structure is checked by unit tests. There is no AI or video provider, so there are no keys.

## 9. How to run

```powershell
# from the repo root (npm workspaces; pnpm is blocked on this machine)
npm install
cd apps/api
npx -y prisma@6.5.0 generate       # workaround for the local Prisma CLI
npx prisma migrate deploy           # additive; applies the learning migration
cd ../..
npm run dev:api                     # http://localhost:3001/api, Swagger at /api/docs
npm run dev:web                     # http://localhost:3000/learn and /stories
```

If `dev:api` was already running when the Prisma client was regenerated, restart it. Otherwise watch mode keeps reporting stale type errors such as `storyProgress` on `{}`.

### Tests

| Command | Scope |
| --- | --- |
| `npm run test:api` | Jest unit tests, including the learning engine, assessment, mission playthroughs and story catalog |
| `npm run test:web` | Vitest: ticket form, story timeline, Learning Hub, story player |
| `npm run test:e2e` with `E2E_DATABASE_URL` pointing at a database whose name ends in `_test` | Supertest against PostgreSQL. **It wipes that database between tests.** It refuses any other database name. |
| `npm run test:e2e:learning [-- <screenshot-dir>]` | Headless Edge browser journey (below) |

**Browser journey** (`scripts/e2e/learning-journey.mjs`).

Prerequisites:
- The API runs with `MAIL_TRANSPORT=preview`, preferably against the `_test` database.
- The web app is running.

What it does:
1. Registers a throwaway `@example.test` learner with a random password that is never printed.
2. Verifies it through the captured email.
3. Plays all 10 steps: hub → beginner mission → trade → complete → assessment → Time Machine → updated competencies → FinStories → watch → resume. On the way it checks the server pre-trade preview in the ticket, the confidence review wording, a MANUAL Time Machine branch (trade differently, finish, compare, profile unchanged), the FinStories captions toggle and live region, and that reduced motion stops autoplay. Step 11 trades in The Overconfident Trader, where every order needs a confidence rating.
4. Checks for horizontal overflow at 375, 768 and 1440 px.
5. Saves screenshots to `docs/learning/screenshots/`.

## 10. Limitations and planned work

- **Planned, not built:**
  - AI/LLM mentor provider: the rule-based mentor is the clearly labelled fallback.
  - Video rendering pipeline (Remotion/FFmpeg); FinStories use in-browser motion graphics.
  - Time Machine Mode B (interactive branching inside the player).
  - Scenario Director and Instructor Command Center.
  - Behavioral Finance Lab beyond confidence calibration and The Overconfident Trader.
  - Trading Behavior DNA (a behaviour profile across missions).
- **Configured missions** (4, 6, 7, 8) are playable. Unit tests show that each one passes a plan that applies its lesson and fails a plan that ignores it. Their difficulty and pass thresholds have not been reviewed with real learners, so they stay "Playable · in review".
- **Confidence review** compares outcomes over a few days of a synthetic market. Even above 10 outcomes it suggests miscalibration; it does not prove it.
- **Narration** depends on the browser's speech synthesis. The button is disabled with an explanation where it is unsupported.
- **Accessibility** follows the existing jsx-a11y rules: labelled controls, live regions, keyboard shortcuts and reduced motion. It has not been tested with a screen reader.
