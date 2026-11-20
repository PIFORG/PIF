# ATLAS DES INTERFACES — Market Trading Room

Date: 2026-11-20 (mandat ultime)
Source: `apps/web/src/app/app.routes.ts` — **46 path entries** (41 navigables hors redirects vides / `**`)

| Famille | Preuve | État |
|---|---|---|
| Public × 4 viewports × 2 thèmes | `routes-matrix` | VERIFIEE |
| INVESTOR (incl. `/rooms`, sessions, review) × 4×2 | `routes-matrix` + rooms follow-up | VERIFIEE |
| ADMIN (+ détail user) × 4×2 | `routes-matrix` | VERIFIEE |
| Responsive échantillon | `routes-responsive` 24/24 | VERIFIEE |

Campagne: **351 passed** (matrice initiale) + **9** rooms matrix + **1** investor `/rooms` · log `data/reports/ultimate-routes-campaign.log` · `ultimate-rooms-routes.log`

Viewports: 375 / 768 / 1024 / 1440 · thèmes light + dark.

## Verdict atlas
**41/41 navigables VERIFIEE** (46 path entries routeur ; redirects parents non comptés comme écrans).