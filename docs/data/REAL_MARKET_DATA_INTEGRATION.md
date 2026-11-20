# Intégration de données de marché réelles — Market Trading Room

Date: 2026-11-20 (finalisation fonctionnelle)  
Environnement d'écriture: **PostgreSQL `PIF_spring_test` uniquement**  
Base principale **`PIF`**: **non modifiée**

## 1. Objectif

Transformer le warehouse déjà importé en **source effectivement consommée** par Marchés, Trading, Portefeuilles, Backtesting, Actualités et Administration — sans réimport inutile, sans refonte UI, sans toucher `PIF`.

## 2. Warehouse vérifié (sans réimport)

| Métrique | Valeur |
|---|---|
| Barres totales | **945 471** |
| CMF / BVMT | **874 199** (2018-01-02 → 2026-10-29) |
| Yahoo US | **71 272** (2008-01-02 → 2026-11-18) |
| Instruments ext. | **1 195** (CMF 1 165 · Yahoo 15 · Stooq stub 15 sans barres) |
| Instruments trading `fictional=false` | **1 186** (CMF 1 166 · Yahoo 20) |
| Non négociables (indices) | **5** |
| Fictifs pédagogiques conservés | **10** |
| Crises | **6** |
| Actualités RSS | **45** (Fed + SEC, titres/liens) |

Rapports: `data/reports/quality-snapshot.json`, `data/reports/cmf-ingest-report.json`  
Outils: `tools/market-data/**` (`verify-warehouse.mjs`, `count-promoted.mjs`, `quality-report.mjs`)

**Ne pas relancer** `ingest-cmf` / `ingest-yahoo` sauf besoin de rafraîchissement.

## 3. Sources

| Source | Statut | Licence / restriction |
|---|---|---|
| CMF / BVMT (WeTransfer local) | Opérationnel | Données historiques locales — usage pédagogique / interne sur `*_test` |
| Yahoo Chart API | Opérationnel | **Non contractuel** — ne pas redistribuer publiquement sans droits ; remplaçable via `market_data_sources` + connecteur |
| Stooq | Bloqué (challenge JS) | Connecteur conservé, 0 barre |
| FRED | Connecteur prêt | Bloqué sans `FRED_API_KEY` (non bloquant pour le reste) |

Architecture de remplacement Yahoo: `market_data_sources` + `provider_id` sur `instruments` + `MarketDataWarehouseRepository` (aucune dépendance dure au nom Yahoo dans l’UI).

## 4. Connexion applicative (finalisée)

| Module | Branchement |
|---|---|
| **Marchés** | Catalogue dynamique PostgreSQL (recherche, marché TN/US, nature historique/fictive, pagination). Indices consultables, non « Négocier ». |
| **Trading / ticket** | Uniquement instruments `tradable !== false`. Prix warehouse = dernière clôture historique datée. |
| **Portefeuilles** | Valorisation via dernière barre warehouse ; rejet des indices non négociables. |
| **Graphiques / history** | Séries warehouse pour `fictional=false` ; simulateur pour fictifs. |
| **Backtesting** | Séries warehouse pour `fictional=false` + simulateur pour fictifs ; sélecteur d’épisode de crise (`/market/crises`) ; couverture US dès 2008, BVMT dès 2018 affichée. |
| **Stress Testing / Time Machine pédagogique** | Inchangés (scénarios bancaires / missions) — crises de marché exposées via Backtesting + API crises. |
| **Actualités** | Warehouse RSS d’abord ; fallback pédagogique **explicitement** synthétique si vide. |
| **Admin plateforme** | Warehouse (volumes, sources, lots d’import) + échantillon instruments. |
| MarketQuest / FinStories / Actuarial / ÉCHO | Inchangés (pédagogiques). |

### Provenance honnête

- Kind warehouse: **`HISTORICAL`** (pas `HISTORICAL_DELAYED` ni `LIVE`).
- Fraîcheur: **`LAST_AVAILABLE_SESSION_CLOSE`**.
- Fictifs: **`FICTIONAL`** / `SIMULATED_CONTINUOUS_5M`.
- Un prix d’ancienne séance est libellé comme **observation historique datée**.

## 5. Crises exploitables

API: `GET /market/crises` — 6 épisodes + séries couvertes bornées à `[startDate, endDate]` (pas de fuite future).

| Épisode | Couverture US Yahoo | Couverture BVMT |
|---|---|---|
| GFC 2008–2009 | Oui | Non (CMF ≥ 2018) |
| Dette EU 2011 | Oui | Non |
| Correction 2018 | Oui | Oui (partiel selon début) |
| COVID 2020 | Oui | Oui |
| Bear 2022 | Oui | Oui |
| Banking 2023 | Oui | Oui |

UI: Backtesting → « Épisode de crise ».

## 6. Actualités

45 items Fed/SEC (`TITLE_LINK_ONLY`) : titre, source, date, marché si présent, lien original.  
Déduplication à l’ingest RSS ; sync incrémentale via upsert.  
Si pause admin ou warehouse vide → état explicite / fallback pédagogique étiqueté.

## 7. Migrations / Prisma

Fichier SQL sous `tools/db-harness/prisma/migrations/20261120120000_market_data_warehouse/` — **appliqué uniquement sur `PIF_spring_test`**.  
Aucun processus Prisma runtime dans l’app Spring. **Aucune migration sur `PIF`.**

## 8. Limitations restantes

1. CMF locale dès **2018** uniquement.  
2. Alias numériques 2018–2021 vs ISIN 2022+ incomplets (symboles `TN…` / `BV…`).  
3. Stooq 0 barre ; FRED sans clé.  
4. Yahoo non redistribuable / non contractuel.  
5. Fondamentaux instrument restent **synthétiques** (pédagogiques).  
6. Stress Testing bancaire ≠ séries de marché (volontaire).  
7. Doublons `trading_symbol` côté ext. (obligations ENAT…) gérés via symboles uniques à la promotion.

## 9. Checklist `PIF` (non exécutée)

1. Autorisation écrite  
2. `pg_dump` de `PIF`  
3. Appliquer la migration warehouse  
4. Rejouer / synchroniser les imports  
5. Smoke `/market/status`, instruments, history, news, crises  

## 10. Confirmation

**`PIF` inchangée.** Travail limité à `PIF_spring_test` + code Angular/Spring.
