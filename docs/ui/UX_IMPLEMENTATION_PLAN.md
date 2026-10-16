# MTRS UI implementation plan and live checklist

Scope: a premium FinTech UI for the Market Trading Room Simulator (`apps/web`). The work restyles and restructures the frontend and keeps every working identity flow intact. Backend security policies are unchanged.

Related: [UI_ROUTES_AND_STATUS.md](./UI_ROUTES_AND_STATUS.md) · [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)

## Repository identity

The repository was confirmed to be MTRS:

- packages `@mtrs/api` and `@mtrs/web`;
- Prisma schema for MTRS identity;
- no TaxGain names, trademarks or tax routes in `apps/` (searched for `taxgain`, `tax-gain` and `/tax`).

TaxGain was used as a quality reference only. The MTRS emblem and layouts are original.

## Checkpoint and rollback

The folder is not a git repository, so the pre-redesign frontend was archived:

- `backups/web-before-ui-redesign-20261015-234549.zip`, containing `apps/web/src` plus the web config files.

To roll back, stop the dev server, delete `apps/web/src`, extract the archive in place and run `npm install`. The API was not changed by this redesign.

## Checklist

### Phase A — foundation

- [x] Tokens for dark and light themes, a pre-paint theme script, a theme switch, and high-contrast and reduced-motion support.
- [x] Geist and Geist Mono via `next/font`; tabular numerals.
- [x] Original emblem, lockup and favicon (`icon.svg`, `public/brand/*`).
- [x] Workspace shell:
  - [x] grouped sidebar with real status per item, collapsible;
  - [x] top bar with "Simulated" tag, health, clock, theme and account menu;
  - [x] mobile drawer with focus trap and Escape, plus a bottom bar;
  - [x] skip link.
- [x] Navigation config with role filtering (`lib/navigation/workspaceNav.ts`).
- [x] Primitives: PageHeading, StatusBadge, DemoModeLabel, Panel, KpiCard, Change, EmptyState, PanelSkeleton.
- [x] Formatters: money, signed money, percent, date in the user's time zone, device names.

### Phase B — public and auth

- [x] Homepage:
  - [x] hero with a sample-labelled product preview;
  - [x] capability pillars with Preview status, a three-step workflow and the honest "available now / in development" split;
  - [x] disclaimer and footer;
  - [x] no testimonials or metrics.
- [x] Split-screen `AuthLayout` with the brand statement, a decorative candlestick illustration and assurances.
  - [x] The form title is now the page `h1`.
  - [x] Every auth page keeps its logic unchanged.

### Phase C — dashboard, settings and admin

- [x] Signature dashboard:
  - [x] live account data: readiness checklist, signed-in devices, active sessions KPI, module availability from the API;
  - [x] honest empty states for market panels;
  - [x] opt-in, labelled sample workspace with KPIs, performance chart, watchlist, allocation and positions.
- [x] Settings and admin moved onto `PageHeading` and tab-style `.subnav` inside the shell. Their guards are unchanged.

### Phase D — financial modules

- [x] Eleven module routes, plus `/backtesting`, built from one DESIGNED_PENDING_BACKEND template. Each has:
  - [x] a "Designed, not yet connected" notice;
  - [x] a wireframe layout;
  - [x] planned capabilities and key concepts;
  - [x] the proposed API contract.
- [x] `/trading` order ticket is fully disabled and explains why.

### Phase E — quality

- [x] Unit and DOM tests (see below).
- [x] `npm run verify` and `npm run build:web` pass.
- [x] Real-browser review in headless Microsoft Edge (Chromium) at 1440, 390 and 360 px, in dark and light themes.
- [x] These trackers.

## Verification (2026-10-15)

| Check | Result |
| --- | --- |
| `npm run verify` (typecheck, lint, API and web tests) | Pass. API 164/164. Web 95/95 across 16 files. |
| `npm run build:web` | Pass. 32 route entries (including `/_not-found` and `/icon.svg`), all static except `/admin/users/[id]`. First Load JS is 103–141 kB. |
| Browser: horizontal overflow at 360 px | None on `/`, `/login`, `/dashboard`, all 12 module routes and the 3 settings pages. |
| Browser: runtime errors during the full run | 0. |
| Browser: investor visiting `/admin` | Lands on `/unauthorized`. |

New tests:

- `lib/navigation/workspaceNav.test.ts`: role filtering, unique routes that all exist on disk, live status only for identity routes, every module catalogued, active matching.
- `lib/theme/theme.test.ts`, `lib/format/finance.test.ts`, `lib/format/device.test.ts`, `lib/demo/sampleWorkspace.test.ts`.
- `components/layout/AppShell.test.tsx`: Simulated tag, `aria-current`, preview flags, admin visibility, drawer Escape and focus return, collapse persistence.
- `components/workspace/ModulePreviewPage.test.tsx`: pending notice, proposed contract, disabled order ticket.

Bugs found and fixed during the browser review:

- `ThemeToggle` assumed `matchMedia` exists. It crashed under jsdom and would in some embedded browsers; it is now guarded.
- The definition list overflowed at 360 px on long email addresses.
- The heatmap wireframe overflowed at 360 px.
- The health chip showed "API unreachable" when the API was rate limiting (429). Results are now cached for 60 seconds and a 429 hides the chip.
- Session devices showed raw user-agent strings.
- Long sidebar labels clipped their status badge.

Screenshots are in `docs/ui/screenshots/`: homepage, auth, dashboard (empty, sample, light), mobile dashboard and drawer, trading, risk and settings. They were captured in development mode with the Next.js dev badge hidden.

## Known gaps and follow-ups

- **No SMTP in development.** Verification, reset and email-change emails cannot be received. The review account was a dedicated disposable `ui-review-…@example.test` user whose email was marked verified directly in the development database. No other records were touched.
- **API rate limit.** The global limit is 20 requests per minute per route per IP, and it applies to `/api/health` too. Normal browsing is fine, but quick full-page reloads can hit 429. A backend follow-up could exempt the health check (`@SkipThrottle`) or tune per-route limits. Left unchanged: backend security policy is out of scope.
- **Market engines.** Every module in UI_ROUTES_AND_STATUS.md marked DESIGNED_PENDING_BACKEND needs the proposed endpoints listed on its page. None exist yet.
- **Admin screens with an ADMIN account.** These were not re-captured in the browser after the restyle. They are covered by unchanged logic plus typecheck and build. Capture them with a real administrator account.
- **Light-theme contrast.** Light `text-3` (#5F738A on #FFFFFF) was chosen to stay above 4.5:1. A full automated audit (axe or Lighthouse) has not been run.
