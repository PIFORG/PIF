# Market Rooms — salles de marché multijoueurs

Date: 2026-11-20  
Base cible: **`PIF_spring_test` uniquement** (`PIF` inchangée)  
Migration: `tools/db-harness/prisma/migrations/20261120180000_market_rooms/`  
Application: `node tools/db-harness/apply-market-rooms-migration.mjs`

## Objectif

Simulation financière **collaborative**, pédagogique et fictionnelle : plusieurs utilisateurs authentifiés partagent une salle, un contexte de marché et une horloge (fictive ou historique), avec isolation stricte des portefeuilles et une économie à trois soldes.

**Aucune transaction réelle. Aucun dépôt/retrait monétaire réel.**

## Parcours utilisateur

1. Accueil → **Salles de marché** (`/rooms`)
2. Créer une salle (défauts pédagogiques) **ou** rejoindre via code
3. Lobby → l’hôte démarre
4. Trading simulé, chat, points, crédit virtuel
5. Classement pédagogique (explication FR affichée)
6. Fin de session → classement final persisté dans l’événement `ROOM_ENDED`

Modes: `LEARNING` · `COMPETITION` · `CLASSROOM` · `PRACTICE`  
Visibilité: `PUBLIC` · `PRIVATE` (code + expiration)

## Cycle de vie

`LOBBY` → `ACTIVE` → (`PAUSED`) → `ENDED`

Événements séquencés (`market_room_events`) + polling `/rooms/{id}/state?sinceSeq=` + SSE `/rooms/{id}/events/stream`  
SSE : authentification par en-tête `Authorization: Bearer` (fetch stream) — **jamais de JWT en query string**.

## Valorisation mark-to-market

`RoomValuation` (serveur) :

**Valeur nette = Trésorerie + Valeur de marché des positions − Dette virtuelle restante.**

- Prix warehouse `barOnOrBefore(simClock)` en mode historique (pas de look-ahead)
- Simulateur / dernier close disponible en mode fictif
- PnL réalisé / latent, frais, devises via instruments existants
- Positions liquidées (qty ≤ 0) ignorées
- Cours manquants **ou** devise ≠ devise de base du portefeuille → `valuationComplete=false` (pas de FX silencieux) ; le classement n’affiche pas un score comme exact (`scoreProvisional`)

**Rendement trading** (hors injections) :

`(grossEquity − capitalExterne − capitalInitial) / capitalInitial`  
où `capitalExterne = conversions de points + dette de crédit restante`.

## Classement pédagogique

Score ∈ [0,100] :

| Volet | Poids | Contenu |
|---|---|---|
| Performance | 30 % | Rendement trading (hors conversions/crédit) |
| Risque | 25 % | Pénalise le drawdown — le risque excessif n’est pas récompensé |
| Apprentissage | 30 % | Points + missions réclamées (`market_room_rewards` MISSION) |
| Discipline | 15 % | Baisse si trading limité |

Explication FR exposée dans `scoreExplanation.fr` et dans l’UI.

## Économie (trois soldes)

| Solde | Rôle |
|---|---|
| Capital fictif / valeur nette | Cash + MTM − dette |
| Points d’apprentissage | Progression pédagogique |
| Crédit virtuel | Emprunt fictif = **dette**, jamais un gain |

Règles serveur (`RoomEconomy`) :

- Conversion points → capital : taux, plafond, cooldown, idempotence (+ reprise sur collision unique)
- Crédit : plafond transparent ; capacité = plafond − tirages lifetime (pas de double soustraction dette)
- BUY bloqué si `tradingLocked` ; SELL, formations, chat, remboursement restent accessibles

## Données de marché

- Défaut: simulateur **FICTIONAL**
- Option: `TN` / `US` / `MIXED` / `HISTORICAL` + épisode de crise + `sim_clock_date`
- Label honnête: « Simulation sur données historiques »
- Horloge avancée par l’hôte ; trading/valorisation sous `RoomQuoteContext`

## Communication

- Chat texte réel
- Voix: **non déployée** (hors périmètre de clôture)

## API principale

| Méthode | Chemin |
|---|---|
| GET/POST | `/rooms` |
| POST | `/rooms/join` |
| GET | `/rooms/{id}` |
| POST | `/rooms/{id}/start\|pause\|end\|leave` |
| GET | `/rooms/{id}/state` |
| GET | `/rooms/{id}/events/stream` (SSE) |
| GET | `/rooms/{id}/portfolio` (MTM) |
| POST | `/rooms/{id}/orders[/preview]` |
| GET/POST | `/rooms/{id}/credit…`, `/points/convert`, `/rewards/claim` |
| GET/POST | `/rooms/{id}/messages` |

## Sécurité

- Auth JWT obligatoire
- Membership serveur
- Idempotency keys + `DuplicateKeyException` → replay
- Pas de confiance au `userId` client

## UI

- `/rooms` : parcours créer / rejoindre + rappel des 3 soldes (valeur nette MTM)
- `/rooms/:id` : valeur nette MTM, points, dette, classement + formule FR, SSE + polling
- Quiet Luxury préservé (pas de refonte)

## Validation (2026-11-20 — clôture)

| Preuve | Résultat |
|---|---|
| `RoomEconomyTest` + `RoomValuationFormulaTest` | OK |
| `MarketRoomsDatabaseTest` (`-P database-tests`) | OK |
| `node tools/e2e/market-rooms-multiplayer.mjs` | **22 steps PASS** — 3 comptes A/B/C, SSE Bearer, crédit/plafond, BUY refusé, idempotence, historique crise 2020-02-20→21, 2 salles isolées, reconnect sans perte |
| Playwright `rooms-real` (3 contextes) | **1 passed** (créer / rejoindre / démarrer / soldes / chat) |
| `node tools/e2e/check-pif-untouched.mjs` | `writesOnMain: false` — base `PIF` non modifiée |
| Angular typecheck / lint / build | OK |
| Trading pages unit | OK (régression individuelle) |
| Rapport | `data/reports/market-rooms-multiplayer.json` |

## Limites honnêtes

1. Voix de salle absente (chat OK) — hors périmètre
2. Quitter la salle (`leave`) crée une nouvelle adhésion/portefeuille si on rejoint ensuite ; la « reconnexion » validée est login + poll sans `leave`
3. Pas d’ÉCHO / IA dans cette campagne
4. Indices non négociables inchangés (moteur trading existant)
5. Pas de conversion FX silencieuse : devises hétérogènes → valorisation provisoire
