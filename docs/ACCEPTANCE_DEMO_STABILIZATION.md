# ACCEPTATION — Stabilisation démo soutenance

Date: 2026-11-20  
Env: Angular :4200 · Spring :3002 · PostgreSQL `PIF_spring_test`  
`PIF`: **writesOnMain: false**

## 1. Bug historique (graphique desk)

**Cause:** `GET /market/instruments/{symbol}/history` pour instruments **historiques** (ex. BIAT) :
quand aucune barre warehouse n'existait dans la fenêtre courte (ex. 1D = 10 jours) alors que la dernière séance était plus ancienne (2026-10-30), `MarketService.points` retombait sur `SimulatedMarketProvider.intraday(providerSymbol)` avec un ISIN (`TN0001800457`) → `IllegalArgumentException: Unknown simulated instrument` → **500** → UI « Historique indisponible / Une erreur inattendue ».

**Correction:**
- Pas de fallback simulateur pour les instruments non fictifs.
- `historicalTail` : dernières barres disponibles jusqu'à la dernière séance warehouse.
- Message UI desk clarifié si échec résiduel.

**Preuve:** BIAT `HIST 200` + `GET 200` après redémarrage API ; trading-deep **passed**.

## 2. Cotations expirées

**Cause:** `validUntil = asOf + 5 min`. Pour une clôture historique, `asOf` = séance 15:00 (ex. 2026-10-30) → déjà expiré à l'aperçu → boucle « Actualiser l'aperçu » sans pouvoir confirmer. Aucune exécution silencieuse (le ticket refuse tant que `expired()`).

**Correction (`TradingViews.validUntil`):**
- Bucket sim encore ouvert → `asOf + 5m` (inchangé).
- Observation déjà stale → `validUntil` = fin du **bucket courant** (horloge serveur).
- `asOf` reste l'horodatage d'observation ; le submit compare toujours `quoteAsOf`.

**Preuve:** BIAT preview `asOf=2026-10-30T15:00Z`, `validUntil` dans le bucket courant, `expired=false`. Tests unitaires `TradingViewsQuoteValidityTest` **OK**. ATL/FICTIONAL inchangé.

## 3. Réconciliation financière (portefeuille propre 100 000 DT)

Portefeuille `E2E Desk 1795132186450` — fichier `data/reports/recon-clean-atl.json`.

| Étape | Détail exact |
|---|---|
| Capital initial | **100 000,000 DT** |
| Achat | 2 ATL @ **17,345** · notional **34,690** · frais **0,500** · cashImpact **-35,190** |
| Cash après achat | **99 964,810** (Δ = 35,190 = preview) |
| Coût unitaire | (34,690 + 0,500) / 2 = **17,595** |
| Vente | 1 ATL @ **17,301** · frais **0,500** · cashImpact **+16,801** |
| P&L réalisé | 16,801 − 17,595 = **-0,794** |
| Cash après vente | **99 981,611** |
| Position restante | qty **1** · costBasis **17,595** · mid **17,323** · uPnL **-0,272** |
| Equity | cash + MV = 99 981,611 + 17,323 = **99 998,934** |
| Invariants | buyMatchesPreview **true** · equityIdentity **0** |

Pas de double comptabilisation observée.

## 4. CSS / visuel

- Feuilles feature déjà dans `angular.json` `styles` (dashboard, trading, …).
- Build prod : `styles-*.css` **159 kB** contient `db-moduleText` / workspace ; `main-*.css` **118 kB**.
- Séparateurs market-pulse / news-wire conservés.
- Budget initial **529,89 kB** (warning 500 kB) — non bloquant pour la démo.

## 5. Routes et viewports

| Campagne | Résultat |
|---|---|
| Admin routes (+ détail user) | **5/5** |
| Responsive 375/768/1024/1440 (échantillon) | **24/24** |
| Trading deep | **1/1** |
| Investor + stories (+ learn-deep rejoué) | learn-deep **OK** après 1 flake UI bilan |

## 6. Parcours démo

Couvert via API réelle + Playwright : dashboard/marchés/trading/portefeuilles, MQ + time machine, FinStories, IA/stress/actuariat (journeys investor), risques/backtesting (routes). Données déterministes simulateur ATL.

## 7. Tests exécutés (cette session)

- `TradingViewsQuoteValidityTest`
- Playwright trading-deep, admin routes, responsive, investor/stories, learn-deep (retry)
- Angular typecheck + lint
- Build production (warning budget)
- `check-pif-untouched` → `writesOnMain: false`
- Spring : redémarrage avec correctifs market/quote (suite complète non rejouée ; tests unitaires quote OK)

## 8. Défauts restants

- Flake occasionnel texte bilan MarketQuest (rejoué OK).
- Budget bundle initial > 500 kB (warning).
- ÉCHO non livré (hors scope).
- TTS FinStories : checklist manuelle acoustique.

## 9. `PIF`

**Inchangée** — `writesOnMain: false`.