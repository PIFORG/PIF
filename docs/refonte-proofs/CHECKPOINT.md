# Refonte dual-layout — checkpoint

Date: 2026-11-15

## Architecture

| Espace | Shell | Navigation principale |
|--------|-------|------------------------|
| INVESTOR | `AppShellComponent` via `WorkspaceLayoutComponent` | Navbar horizontale `.inv-nav` + drawer mobile |
| ADMIN | `AdminLayoutComponent` | Sidebar `.adm-side` + barre utilitaire `.adm-top` |

Pas de double navigation : admin n’embarque plus `AppShell` / MarketPulse / NewsWire.

## Navigation investisseur (`investor-nav.ts`)

Vue d’ensemble · Marchés · Négociation · Portefeuilles · Analyses · Apprentissage

Toutes les destinations pointent vers des routes `MIGRATED_ROUTES` existantes. Aucune entrée `/admin` dans la navbar.

## Navigation admin (`admin-nav.ts`)

Vue générale · Utilisateurs · Supervision · Journal d’audit  
Lien explicite « Espace investisseur » → `/dashboard`.

## Preuves visuelles

`docs/refonte-proofs/`

1. `01-investor-header-dark.png`
2. `02-investor-header-light.png`
3. `03-admin-sidebar.png`
4. `04-trading-desk.png`
5. `05-ai-lab.png`
6. `06-investor-mobile.png` (si capturé)

## Tests

- Angular: **312/312** verts (incl. `investor-nav.spec`)
- Lint: corrigé (import `computed` inutilisé)
- Spring Boot: non rejoué dans ce segment (dernier run antérieur OK)
- Base `PIF`: **non modifiée**

## Non terminé (honnête)

- Refonte visuelle module-par-module (dashboard badges majuscules, markets, learn, actuarial, bank) encore partielle
- Matrice complète ~40 routes navigateur non exhaustive ici
- Suites Spring / PostgreSQL isolées non rejouées dans ce tour
- Captures tablette / FinStories / MarketQuest / actuariat / portefeuilles à compléter
