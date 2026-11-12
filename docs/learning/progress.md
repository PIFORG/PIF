# Learning module delivery progress — Market Trading Room Simulator

This file reports only what was built and executed. Architecture, financial model, API and how to run are in [`README.md`](./README.md).

**Status legend** (from the master prompt):
- **Implemented and tested:** built, connected end to end, and verified by an executed automated test at the level listed.
- **Implemented but not fully tested:** built and connected, but part of the behaviour has no executed test.
- **Partially implemented**
- **Planned:** not built. Where it appears in the UI, it is labelled as planned.
- **Blocked**

## 1. Status

| Feature | Backend | Frontend | Executed tests | Status |
| --- | --- | --- | --- | --- |
| Deterministic market sandbox: seeded one-factor model, events, regimes, bid/ask, depth | `engine/market.ts` | Chart, quotes, news | Unit (determinism, exact jumps, regime spreads, noise independence) | Implemented and tested |
| Order execution and accounting: market, limit, stop; fees; average cost; partial fills; expiry; loss-limit failure | `engine/simulator.ts` on the shared core `apps/api/src/finance/*` | Order ticket, positions, orders | Unit (11 cases) + core hand-computed tests (18) + golden master (30 snapshots recorded before the core extraction) + accounting identity at every step on all 10 playable missions + API e2e + browser | Implemented and tested |
| Server pre-trade preview (same rules as placing the order, nothing recorded) | `checkPlaceOrder`/`previewOrder` in `simulator.ts`; `POST /learning/sessions/:id/orders/preview` | Ticket estimate, refusal reason and warnings from the server; the form only validates input (`ticket.ts`) | Unit parity on more than 100 orders across all missions + API e2e (estimate, cash refusal, unrated order, `NOT_AN_ORDER` 422, foreign session 404, nothing recorded, cash after the fill matches the estimate) + browser (refused order not sent; estimate shown) | Implemented and tested |
| Risk metrics: drawdown, volatility, historical VaR/ES, HHI, exposure, costs | `engine/metrics.ts` | Risk panel, review | Unit (via assessment and playthrough tests); values shown in the browser journey | Implemented and tested |
| Server-authoritative commands: idempotency, `expectedSeq`, unique indexes | `learning.service.ts` | `MissionPlayer` send/retry/reload | API e2e (retries, key reuse, concurrent commands, invalid commands not recorded) | Implemented and tested |
| Mission catalog: 10 missions with availability | `missions/catalog.ts`, `validate.ts` | Hub, briefing | Unit (catalog validation; every playable mission played to a deterministic assessment); API e2e (catalog of 10, all playable; unknown mission → 404) | Implemented and tested |
| Missions 1, 2, 3, 5, 9, 10 (Implemented) | Catalog | Playable | Mission 10 and mission 9: API e2e full flow. Missions 1 and 9: browser journey. All six: automated playthrough | Implemented and tested |
| Mission 9, The Overconfident Trader: confidence required on every order | `engine/simulator.ts` (`CONFIDENCE_REQUIRED` → 422, not recorded), `engine/mentor.ts` (`HIGH_CONFIDENCE` rule), calibration in the debrief | Ticket label "Confidence (required)", client-side refusal | Unit (pass and fail plans, refusal records nothing, mentor rule) + API e2e (unrated order refused with 0 commands, rated orders, mentor, calibration 85 % over 3 orders) + browser (refusal, fills, mentor question) | Implemented and tested |
| Missions 4, 6, 7, 8 (Configured) | Catalog | Playable, badge "Playable · in review" | Automated playthrough + unit pass/fail pairs: each passes a plan that applies its lesson and fails one that ignores it | Implemented but not fully tested (difficulty not reviewed with learners) |
| Catalog consistency | `assessment.spec.ts` | Hub showcase button uses the catalog title | Unit: briefing capital matches initial equity (within 1 %); every objective label states its parameters; related stories exist | Implemented and tested |
| Learning progress counter | `profile.stats.playableMissions` (Implemented + Configured) | Hub KPI "Missions passed", dashboard "N of 10 missions passed" | API e2e (`playableMissions` = 10) + browser ("1 of 10") | Implemented and tested |
| Assessment: 40/25/20/15 configurable weights, evidence, no P&L criterion, no hindsight, pass rules | `engine/assessment.ts` | Review page | Unit (21 cases including weight redistribution and pass rules) + API e2e + browser | Implemented and tested |
| Competency mastery (assisted and unassisted kept separate) and recommendations | `mastery.ts`, `recommendations.ts` | Hub profile, recommended next | Unit + API e2e + browser (profile updates after a mission) | Implemented and tested |
| Rule-based mentor: GUIDED, SOCRATIC, CRITICAL, DEBRIEF; marks the attempt assisted | `engine/mentor.ts` | Player mentor panel, review debrief | Unit + API e2e + browser | Implemented and tested |
| Confidence review (`assessment-1.1`): market-adjusted outcomes, 10-outcome minimum, decision-time signals, not scored | `assessment.ts`, `mentor.ts`, profile in `learning.service.ts` | Review "Confidence check", hub KPI | Unit (market-wide fall, signals, no-horizon orders, pass plan) + API e2e (method, observations, not interpretable at 3, debrief wording, profile) + browser (review wording, hub "2 of 10 outcomes needed") | Implemented and tested |
| Financial Time Machine Mode A: rewind to a decision, HOLD/MANUAL, compare | `learning.service.ts` | Review page timeline, branches, comparison | API e2e (rewind, compare, replay never changes the profile, cannot rewind an active mission) + browser (HOLD branch and comparison; MANUAL branch: practice replay at day 0, a different trade, finish, assessment labelled practice, compare, both replays listed, profile unchanged) | Implemented and tested |
| Learning Hub `/learn` | `GET /learning/missions`, `/learning/profile`, `/learning/stories` | `LearningHub.tsx` | Component (3) + browser at 375/768/1440 | Implemented and tested |
| Mission briefing and player | Session and command routes | `MissionBriefingView.tsx`, `MissionPlayer.tsx`, `ticket.ts` | Unit (ticket form, 5) + browser at 375/768/1440 (including the phone "Order ticket" jump link) | Implemented and tested |
| FinStories feed and player: 9:16, no A/B buttons, captions, narration, progress and resume, recommendations, reduced motion | `stories/*` | `StoryFeed.tsx`, `StoryPlayer.tsx`, `storyTimeline.ts` | Unit (catalog structure per story; Sarah's arithmetic) + component (4) + API e2e (progress per user) + browser (autoplay, decision reel, no A/B buttons, resume, captions toggle and polite live region when paused, no autoplay with reduced motion, 375/768/1440) | Implemented and tested |
| FinStories progress across story versions: resume at the same scene after an edit, keep the earlier completion | `stories/progress.ts`, migration `20261109120000_story_progress_versions` (additive; back-fills `completed_version`) | Badges "Watched an earlier version" and "Updated since you watched" | Unit (5) + API e2e (stale rows resume at the scene start; the earlier completion survives a new save) | Implemented and tested |
| Sample workspace (dashboard, home page) | n/a (labelled fictional fixture) | `lib/demo/sampleWorkspace.ts`; DT amounts; the banner says amounts are not converted to the display currency | Unit (positions + cash = equity; allocation derived from positions; sparklines end at the quoted price) + browser (DT, banner, screen-reader name of the positions table) | Implemented and tested |
| FinStories narration (browser text-to-speech) | n/a | `StoryPlayer.tsx` | Not executed (headless browser, muted by default) | Implemented but not fully tested |
| AI/LLM mentor provider | — | — | — | Planned (rule-based fallback is live and labelled) |
| Generated video (Remotion/FFmpeg) | — | — | — | Planned (in-browser motion graphics are live; no video file is claimed) |
| Behavioral Finance Lab | Calibration, overtrading evidence, `HIGH_CONFIDENCE` mentor rule, mission 9 | Review calibration panel, hub KPI | As above | Partially implemented (no bias catalogue or dedicated lab screen) |
| Trading Behavior DNA (cross-mission behaviour profile) | — | — | — | Planned (mastery and calibration exist; no behaviour profile is derived from the command logs yet) |
| Time Machine Mode B, Scenario Director, Instructor Command Center | — | — | — | Planned |

## 2. Verification record

### Engineering phase: shared financial core, preview, confidence review (executed on 9 Nov 2026)

| Command | Result |
| --- | --- |
| `apps/api`: `npx tsc --noEmit`, `eslint "src/**/*.ts" "test/**/*.ts"` | Clean |
| `apps/api`: `npx jest` | **27 suites / 465 tests passed, 30 snapshots matched**. The learning and finance suites alone: 8 suites / 140 tests |
| `apps/api`: `npx jest --config ./test/jest-e2e.config.ts --runInBand` against `PIF_test` | **3 suites / 23 tests passed** |
| `apps/api`: `prisma migrate status` on the development database and `PIF_test` (read-only) | 4 migrations, both up to date. **No migration was added or applied in this phase** |
| `apps/api`: `nest build` | Succeeded |
| `apps/web`: `npx tsc --noEmit`, `next lint` | Clean |
| `apps/web`: `npx vitest run` | **20 files / 114 tests passed**. Three financial ticket tests moved to the API, where the calculation now lives |
| `apps/web`: `next build` | Succeeded |
| `npm run test:e2e:learning` (headless Edge, production build, API on `PIF_test`) | **77/77 checks passed** |

Corrections made to tests during the phase (the product was not changed for them):
- the hand-computed cost basis in `finance.spec.ts` was mis-added (803,750 instead of 802,750);
- a no-horizon calibration test first tried to trade after the market closes, then to finish early, which this mission does not allow. It now uses a limit order that fills on the final advance;
- the objective-label check now accepts number words ("four").

### Previous audit (executed on 9 Nov 2026)

| Command | Result |
| --- | --- |
| `apps/api`: `npx tsc --noEmit` | Clean |
| `apps/api`: `npm run lint` (`{src,test}/**/*.ts`, max warnings 0) | Clean |
| `apps/api`: `npx jest` | **24 suites / 394 tests passed**, of which the learning suites are 5 suites / 69 tests |
| `apps/api`: `prisma migrate deploy`, then `prisma migrate status` on `PIF` and on `PIF_test` | 4 migrations found; both schemas up to date. The new migration only adds two nullable columns and back-fills one |
| `apps/api`: `npx jest --config ./test/jest-e2e.config.ts --runInBand` against `PIF_test` | **3 suites / 23 tests passed**: identity, email and 9 learning-module tests |
| `apps/api`: `nest build` | Succeeded |
| `apps/web`: `npx tsc --noEmit`, `next lint` | Clean |
| `apps/web`: `npx vitest run` | **20 files / 117 tests passed** |
| `apps/web`: `next build` | Succeeded; `/learn`, `/learn/missions/[slug]`, `/learn/sessions/[id]`, `/learn/sessions/[id]/review`, `/stories` |
| `npm run test:e2e:learning` (headless Edge; production web build; API on `PIF_test`) | **62/62 checks passed**: the 10-step journey; all 10 missions open their briefing; the dashboard shows "1 of 10 missions passed"; the sample workspace is in DT with the currency note; the positions table keeps its screen-reader name; The Overconfident Trader refuses an unrated order, fills rated ones and the mentor questions the stated confidence; on a phone the "Order ticket" link scrolls the ticket into view; responsive checks at 375/768/1440; no page errors |

The first browser run of the new step failed (54/55) because the script chose a confidence of 85, which the ticket does not offer (it offers 50 to 100 in steps of 10). The script was corrected; the product was not changed for it. The run then exposed a real bug: the hub and dashboard divided passes over every playable mission by the 6 Implemented ones, so "7 of 6" was possible. Fixed with `playableMissions`.

Screenshots from the last browser run are in [`screenshots/`](./screenshots):
- `01-hub-*`, `02-briefing-*`, `03-player-*`, `04-review-*`, `06-finstories-*` at desktop, tablet and mobile widths;
- `05-hub-after-desktop.png` (the profile after a mission);
- `05-dashboard-*` (the simulator dashboard with the live *Learning path* panel);
- `05b-dashboard-sample-*` (the same dashboard with the sample workspace open, in the mission universe and DT);
- `07-finstories-mobile-viewport.png` (the player as a phone shows it);
- `08-calibration-mission-*` (The Overconfident Trader after three rated orders and a Socratic mentor question).

## 3. Deliverables

**Summary.** MarketQuest (hub, 10-mission catalog, briefing, server-authoritative player, assessment, mastery, recommendations, rule-based mentor, calibration), the Financial Time Machine (Mode A) and FinStories (4 stories, motion-graphics player), integrated into the existing template.

**Backend files.**
- **New:**
  - `apps/api/src/learning/**`: engine, missions, stories, service, controller, view, DTOs, specs;
  - `apps/api/prisma/migrations/20261105120000_marketlab_learning/`;
  - `apps/api/test/learning.e2e-spec.ts`;
  - `apps/api/test/qa-learner.ts`: disposable `@example.test` learner, `_test` databases only.
- **Modified:**
  - `apps/api/prisma/schema.prisma`: new models and enums; relations on `User`;
  - `apps/api/src/app.module.ts`: `LearningModule`;
  - `apps/api/src/common/swagger/api-tags.ts`: Learning and Time Machine tags;
  - `apps/api/src/auth/auth.service.ts`: the dashboard context now reports the learning module as available.

**Frontend files.**
- **New:**
  - `apps/web/src/lib/api/learning.ts`;
  - `apps/web/src/components/learning/**`: hub, briefing, player, review, ticket, parts, stories, tests;
  - `apps/web/src/app/learn/**`, `apps/web/src/app/stories/page.tsx`.
- **Modified:**
  - `lib/navigation/workspaceNav.ts` (+ test): MarketQuest and FinStories are live;
  - `components/ui/Icon.tsx`: story and player icons;
  - `lib/modules/moduleCatalog.ts`: removed the `learn` placeholder;
  - `app/dashboard/page.tsx`: live *Learning path* panel (progress, continue, recommendations) replacing the old "Academy content is on its way" placeholder; module blurb;
  - `app/page.tsx` (public home): the learning module moved from "In development" to "Available now";
  - `lib/demo/sampleWorkspace.ts` (+ test): the dashboard and home-page sample workspace uses the missions' fictional Tunisian universe, in TND, instead of a separate set of instruments;
  - `app/globals.css`: `.table-wrap` is positioned, so visually hidden table text can no longer widen the page on phones (this fixed a 334 px overflow in the dashboard sample positions table at 375 px);
  - `components/charts/Charts.tsx`: optional `xCount` so the future stays empty, and `minSpan` so a small portfolio move is not drawn as a crash.

**Audit follow-up (9 Nov 2026).**
- **Missions:** 9 (The Overconfident Trader) is Implemented and 7 (The Interest Rate Shock) is Configured: `missions/catalog.ts`, `engine/types.ts` (`requireConfidence`), `engine/simulator.ts`, `engine/mentor.ts`, `missions.spec.ts`, `assessment.spec.ts`, `test/learning.e2e-spec.ts`; web `ticket.ts` (+ test) and `MissionPlayer.tsx`.
- **Progress counter:** `learning.service.ts` (`playableMissions`), `LearningHub.tsx` (+ test), `app/dashboard/page.tsx`.
- **Story versions:** `stories/progress.ts` (+ spec), `stories.service.ts`, `schema.prisma`, migration `20261109120000_story_progress_versions`; web `lib/api/learning.ts`, `StoryFeed.tsx`, `StoryPlayer.tsx` and their tests.
- **Currency display:** `lib/format/finance.ts` (+ test) writes dinars as "DT" like the missions. The dashboard sample banner and the profile's display-currency hint say that learning and sample amounts are in DT and not converted. The saved USD preference is kept.
- **Sample consistency:** `lib/demo/sampleWorkspace.ts` (+ test) derives cash and allocation from the positions. The allocation previously read 40/23/37 % while the positions gave 40.7/23.5/35.8 %.
- **Player layout:** `MissionPlayer.tsx`, `learning.module.css`: an "Order ticket" link on narrow screens, where the ticket is below the market; the portfolio chart scale.
- **Configuration:** `apps/api/.env.example` had been deleted in the working tree before this session. It was restored from the last commit, and two commented QA names were added (no values).
- **Tooling:** `scripts/e2e/learning-journey.mjs` (step 11, DT, accessibility-tree check).

**Tooling and docs.**
- `scripts/e2e/learning-journey.mjs` and the root script `test:e2e:learning`;
- `docs/learning/*`;
- `docs/ui/UI_ROUTES_AND_STATUS.md`: the learning routes;
- `docs/ui/DESIGN_SYSTEM.md`: the fixture instruments.

**Database changes.** Two additive migrations, both applied to `PIF` and `PIF_test`:
- 7 tables and 2 enums for the module; no existing table changed;
- `story_progress.scene_id` and `story_progress.completed_version` (nullable). Existing completed rows get `completed_version = story_version`, so no earlier completion is lost.

**API integration.** Every endpoint in README §6 is called by the web client in `lib/api/learning.ts` and used by a page. None is unused or mocked in production code.

**Configuration.** No new required environment variables, secrets or providers. `QA_LEARNER_EMAIL` and `QA_LEARNER_PASSWORD` are listed, commented out, in `.env.example` for the optional QA learner script.

## 4. Five-perspective self-review

**Software architect.**
- The engine is a pure, versioned module (`ASSESSMENT_ENGINE_VERSION`, mission and story versions). Persistence keeps only the command log, so state, assessments and replays are reproducible.
- The module follows the existing NestJS patterns: guard, `ApiDoc`, throttles, error codes, `PrismaService`. The web side reuses `ProtectedRoute`, `AppShell`, the workspace primitives and the design tokens.
- **Weakness:** the state is rebuilt from the log on every request. That is fine for missions of 5–15 steps with a few dozen commands. Longer missions would need snapshots.

**Financial engineer.**
- Integer millimes avoid float drift.
- The accounting identity holds exactly at every step on all ten playable missions.
- Stops execute at the gapped bid, not at the stop price.
- VaR/ES are hidden below 30 observations, and volatility below 5 returns.
- Return is never a scored criterion. Calibration is labelled retrospective.
- **Assumptions:** depth and spread are per step, not intraday. Fills are at the top of the book only, with no market impact beyond depth. There are no dividends, taxes or short selling.
- **Weakness:** the Configured missions' pass thresholds come from design reasoning, not learner data.

**Pedagogical expert.**
- Each mission maps to weighted competencies with explicit learning outcomes and objectives.
- Every score shows its evidence, so feedback is explainable.
- Assisted evidence counts less and is shown separately.
- Replays teach "what if" without polluting the profile.
- FinStories present genuine trade-offs (A is not systematically wrong) and link to the mission that practises the same skill.
- **Weakness:** mastery has no forgetting or spaced-practice model beyond recency weighting.

**UI/UX designer.**
- The pages use the template's shell, headings, panels, KPI cards and badges, in light and dark themes.
- The browser run found **three real problems, now fixed**:
  1. The player overflowed by 266 px on phones. Visually hidden table labels escaped their scroll container; the table wrapper is now their containing block, and the toolbar badges wrap.
  2. The decorative "A" and "B" boxes on the decision scene looked like tappable buttons. They are now plain "A or B?" typography.
  3. On phones, the story controls sat under the bottom navigation. The feed is now sized between the top bar and the bottom navigation, and the time label no longer wraps.
- **Weakness:** no screen-reader or real-device testing.

**QA engineer.**
- The full 10-step journey runs in a real browser on a production build with a fresh account and no shared credentials.
- Invalid and edge cases are covered by API e2e and unit tests:
  - ticket without a reason (browser);
  - stale sequence;
  - idempotent retry and key reuse;
  - concurrent commands;
  - foreign sessions (404);
  - unknown missions (404) and unrated orders in a confidence mission (422, nothing recorded);
  - rewinding an active mission;
  - unauthenticated access.
- The mission playthrough test closed the gap where only two missions were played end to end.
- **Remaining gaps:** narration audio; long-running sessions; load testing; screen-reader testing.

## 5. Notes for the next session

- After regenerating the Prisma client (`npx -y prisma@6.5.0 generate` from `apps/api`), restart `npm run dev:api`. Watch mode keeps the old client and reports stale type errors.
- On OneDrive, `next build` can fail with `EINVAL readlink` inside `.next`. Delete `apps/web/.next` (a cache) and rebuild.
- When a story's version changes, saved progress resumes at the start of the same scene (or at 0 if the scene was removed), and an earlier completion is kept and shown as "Watched an earlier version".
- The root `package.json` lists `pnpm` as a dependency, and nothing uses it (npm workspaces). It predates this work and was left in place.
- **Next priority:** the PIF virtual trading and portfolio backend on the shared core (`docs/architecture/pif-scope-gap-analysis.md` §3), after a tested database backup. For learning: Trading Behavior DNA, then Time Machine Mode B.
- The shared financial core and its reuse rules are in `docs/architecture/financial-core.md`.
- The browser journey and `qa-learner.ts` create `@example.test` accounts in `PIF_test` only. Remove them with `npx ts-node test/qa-learner.ts --remove` (with `E2E_DATABASE_URL` set to the `_test` database).
