# MTRS design system — "Institutional Finance Meets Modern FinTech"

The brand is **Market Trading Room**. "Simulator" appears in the full name, metadata and SEO. The descriptor is "Financial Markets, Without the Real-World Risk".

The visual language is original to MTRS. No third-party trademarks, logos or layouts are reproduced.

## Brand mark

`components/brand/BrandMark.tsx` provides:

- `MtrsEmblem`: an angular rounded shield with two volume columns and a market line tracing an "M", ending on an amber data point. Its colours are self-contained, so it reads on dark and light backgrounds from 20 px to 200 px.
- `BrandLockup`: the emblem with the "Market Trading Room" wordmark and a "SIMULATOR" descriptor. `compact` hides the words.

Static copies are `public/brand/mtrs-mark.svg`, `public/brand/mtrs-logo.svg` and `src/app/icon.svg` (the favicon).

## Tokens (`src/app/globals.css`)

Semantic CSS variables are prefixed `--mtr-*` and switched by `html[data-theme]`.

| Token | Dark | Light |
| --- | --- | --- |
| canvas | #081322 | #F5F8FC |
| surface | #0E1C2E | #FFFFFF |
| elevated | #14263C | #F0F5FB |
| text | #F4F8FF | #10233A |
| text-2 (secondary) | #A6B9D0 | #4F647C |
| border | #24374E | #DEE7F1 |
| brand | #3B82F6 | #2563EB |
| cyan | #38BDF8 | #0369A1 |
| pos (positive) | #22C58B | #087F58 |
| neg (negative) | #FB7185 | #B42338 |
| amber | #F5B544 | #A96305 |

Supporting tokens: `hover`, `sunken`, `border-strong`, `text-3`, `brand-strong`, `brand-text`, `*-soft` tints, `grid`, `skeleton`, `focus`, `overlay`, `topbar`, `shadow-sm/md`.

The legacy `--color-*` names used by the existing identity screens are aliases, so those screens follow the active theme without being rewritten.

### Theme

- `lib/theme/theme.ts` holds `THEME_BOOTSTRAP_SCRIPT`, inlined in `<head>` so the right theme is set before first paint.
- An explicit choice is stored under `localStorage['mtrs-theme']`; this is a display preference only, never a secret. Otherwise the theme follows `prefers-color-scheme`.
- `components/ui/ThemeToggle.tsx` switches the theme, persists the choice, and follows system changes until the user chooses.
- The account preferences "Reduce motion" and "High contrast" still apply through `data-reduce-motion` and `data-high-contrast`, with high-contrast overrides for both themes.

## Type, spacing, shape, motion

- **Typefaces:** Geist and Geist Mono via `next/font/google` (`--font-geist-sans`, `--font-geist-mono`). Numbers use `.num` / `.mono` with `font-variant-numeric: tabular-nums`.
- **Type sizes:**
  - hero: `clamp(2.4rem … 4rem)`, about 52–64 px on desktop;
  - workspace H1: `clamp(1.625rem … 2rem)`, 26–32 px;
  - panel H2: 16–18 px;
  - section H2: up to 36 px;
  - body: 14 px, with 13 px for dense UI.
- **Spacing:** `--space-1…8` = 4, 8, 12, 16, 20, 24, 32, 48 px.
- **Radii:** 6, 9, 12, 14 px (`--radius-sm/md/lg/xl`).
- **Layout:** `--content-max: 1600px`, `--sidebar-w: 248px` (72 px collapsed), `--topbar-h: 64px`.
- **Motion:** `--dur-fast/base/slow` = 120, 180, 220 ms with `--ease`. All motion is disabled under `prefers-reduced-motion` and under the account "Reduce motion" preference.

## Components

| Component | File | Purpose |
| --- | --- | --- |
| `AppShell` | `components/layout/AppShell.tsx` | Workspace layout. <ul><li>Grouped sidebar with per-item status; collapsible, with the preference persisted.</li><li>Top bar with breadcrumb, "Simulated" tag, health, clock, theme and account menu.</li><li>Below 1024 px a focus-trapped mobile drawer replaces the sidebar; below 720 px a bottom bar is added.</li><li>Skip link and `main#main-content`.</li></ul> |
| `Icon` | `components/ui/Icon.tsx` | Original 20 px stroke icon set (no icon library). |
| `PageHeading` | `components/workspace/primitives.tsx` | Eyebrow, H1, description, status badge, actions. |
| `StatusBadge` | same | Live / Demo / Preview, with an icon and text. |
| `DemoModeLabel` | same | Mandatory "Sample data" label for any fixture-backed surface. |
| `Panel` | same | Titled section. `demo` adds a hatched amber treatment. |
| `KpiCard` | same | Label, tabular value, change and hint. |
| `Change` | same | Signed value with an arrow icon plus spoken "up/down" text, so it never relies on colour alone. |
| `EmptyState`, `PanelSkeleton` | same | Empty, error (`role="alert"`) and loading states. |
| `LineChart`, `Sparkline`, `AllocationBar` | `components/charts/Charts.tsx` | Dependency-free SVG charts. Labels are rendered as HTML so they don't distort; each chart has an accessible summary and a legend. |
| `ProductPreview` | `components/marketing/ProductPreview.tsx` | Homepage composition built from sample fixtures and captioned as such. |
| `ModulePreviewPage` | `components/workspace/ModulePreviewPage.tsx` | Shared DESIGNED_PENDING_BACKEND template: notice, wireframe layout, capabilities, concepts and proposed API contract. Includes a disabled order ticket on `/trading`. |

## Formatting

- `lib/format/finance.ts`: `formatMoney`, `formatSignedMoney` (uses a "+" and a true minus sign), `formatPercent`, `formatNumber`, `formatDateTime(iso, timeZone)`, `directionOf`.
- `lib/format/device.ts`: `describeDevice`, which turns a raw user agent into "Edge on Windows".

## Rules

1. Never present fixtures as real. Fixtures live only in `lib/demo/` and are fictitious (Northwind, Contoso, Woodgrove, Fabrikam, Litware). They render only after an explicit user action, and every such surface shows `DemoModeLabel`.
2. Modules without a backend show no numbers at all; they show a layout preview and an explanation.
3. Colour is never the only signal. Direction uses an arrow and text, status uses an icon and text, and checklists use icons plus screen-reader text.
4. Every interactive element works or explains why it is disabled, through a disabled `fieldset` with a note, a "Not permitted" badge, or a tooltip.
5. No secrets in `NEXT_PUBLIC_*` or `localStorage`. The access token stays in memory and the refresh token in the HttpOnly cookie. `localStorage` holds only `mtrs-theme` and `mtrs-sidebar-collapsed`.

## Design decisions

- **DESIGN DECISION: plain CSS variables and CSS modules, not Tailwind.** Tailwind is not installed, and the existing screens already use global classes. Adding it would mean a second styling system.
- **DESIGN DECISION: no new dependencies.** Charts, icons and the emblem are hand-built SVG. Geist comes through the `next/font` package already in Next.
- **DESIGN DECISION: no route groups.** Existing layouts (`settings/layout.tsx`, `admin/layout.tsx`) and pages wrap themselves in `AppShell`. Module pages use `ModulePreviewPage`, which applies `ProtectedRoute` and `AppShell`.
- **DESIGN DECISION: sample mode is not persisted.** It resets on reload, so nobody returns to a dashboard of fictitious numbers without choosing it.
