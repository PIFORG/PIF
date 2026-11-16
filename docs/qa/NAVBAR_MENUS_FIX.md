# Navbar investisseur — correction menus

## Cause
.inv-nav { overflow: hidden; } découpait les menus position: absolute sous la barre (hauteur 56px). Seuls les liens directs (Vue d'ensemble, Portefeuilles) semblaient marcher.

## Correctifs
- overflow: visible sur .inv-nav, .inv-header, .inv-bar, .inv-item
- z-index menu 100 ; ticker en z-index 1
- Clic + hover, fermeture Escape / clic extérieur / navigation
- Specs: pp-shell.nav.spec.ts (5)

## Preuve navigateur (CDP)
Tous OK: Cotations /markets, Salle /trading, Portefeuilles /portfolios, Histoires /stories, IA /ai, Vue d'ensemble /dashboard, Risques /risk.

Angular: 317/317
PIF: inchangée