# ACCEPTATION FINALE — Intégrité financière & démo

Date: 2026-11-20  
Env: Angular :4200 · Spring :3002 · `PIF_spring_test`  
Preuves: `data/reports/final-integrity.json`, `final-learn-deep-stability.log`, `final-demo-journeys.log`

## 1. Validité des cotations historiques — VÉRIFIÉE

Distinction explicite désormais exposée par l'API et le ticket :

| Champ | Rôle |
|---|---|
| `asOf` / `observationAsOf` | Horodatage d'observation (clôture warehouse ou début de bucket sim). **Jamais réécrit.** |
| `freshness` | `LAST_AVAILABLE_SESSION_CLOSE` (HISTORICAL) vs `SIMULATED_CONTINUOUS_5M` (FICTIONAL) |
| `dataKind` / `provenance.kind` | HISTORICAL vs FICTIONAL |
| `validUntil` / `confirmUntil` | **Fenêtre de confirmation de l'aperçu** (TTL paper-trading), pas une allégation de fraîcheur live |

BIAT (preuve) : `asOf=2026-10-30T15:00Z`, `freshness=LAST_AVAILABLE_SESSION_CLOSE`, `provenance=HISTORICAL`, `confirmUntil` = fin du bucket courant.  
ATL : `asOf` = bucket sim courant, `freshness=SIMULATED_CONTINUOUS_5M`.  
Soumission avec `quoteAsOf` périmé → **409 QUOTE_CHANGED** (pas d'exécution silencieuse).  
UI ticket : libellé distinct « clôture historique … pas un cours live » + confirmation jusqu'à `confirmUntil`.

## 2. Historique desk — FONCTIONNEL

- BIAT history 1D/1M → **200** (tail warehouse, plus de 500).
- ATL 1D/5D/1M → **200**.
- Instrument inconnu → **404** (pas 500).
- Correction `historicalTail` + aucun fallback simulateur pour non-fictifs.

## 3. Réconciliation financière (100 000 DT)

Portefeuille `E2E Desk 1795132381289` (`final-integrity.json`) :

| Étape | Montants (DT, 3 décimales) |
|---|---|
| Capital | **100 000,000** |
| Achat 2 ATL @ 17,316 | notional **34,632** + frais **0,500** = **-35,132** → cash **99 964,868** |
| Vente 1 ATL @ 17,272 | notional **17,272** − frais **0,500** = **+16,772** → cash **99 981,640** |
| P&L réalisé | **−0,794** |
| Position restante | qty **1** · cost **17,566** · mid **17,294** · uPnL **−0,272** |
| Equity | **99 998,934** = cash + MV |
| Invariants | buyOk / sellOk / equityOk / realizedOk = **true** |

Concordance API Spring (source de vérité) ; Angular consomme les mêmes endpoints ; `PIF` non touchée.

## 4. MarketQuest learn-deep — STABLE

**Cause du flake :** le shell `.lr-reviewShell` ne s'affiche qu'après résolution async session+timeline ; l'assertion texte large courait trop tôt.

**Correctif :** attendre d'abord l'API timeline, puis `.lr-reviewShell` + breadcrumb « Bilan » (plus de regex floue).

**Stabilité :** `--repeat-each=3` → **3/3 passed** (~6–7 s chacun).

## 5. Scénario de soutenance — EXÉCUTÉ

Playwright métier (11 passed) + learn-deep 3× :

1. Marchés → desk → portefeuilles  
2. Trading deep : créer → achat → position → vente → historique  
3. Risques / backtesting / prévisions / stress / actuariat (journeys investor)  
4. MarketQuest + bilan + outcomes réussite/échec  
5. Time Machine (learn-deep branches/compare)  
6. FinStories (pause/reprise/contrôles)  

ÉCHO hors périmètre.

## 6. Visuel

- Métadonnées cotation historiques explicites (évite confusion « frais »).  
- CSS feature déjà dans le bundle prod.  
- Pas de nouvelle refonte ; responsive/admin validés en session précédente.

## 7. Tests finaux (cette session)

- `TradingViewsQuoteValidityTest`  
- Probe intégrité quotes/history/recon  
- learn-deep ×3  
- trading-deep + investor + MQ outcomes + stories → **11/11**  
- typecheck + lint  
- `check-pif-untouched` → `writesOnMain: false`  
- Spring redémarré avec correctifs ; suite complète Spring non rejouée (tests unitaires quote OK)

## 8. Défauts encore ouverts

- Warning budget bundle Angular (~530 kB) — non bloquant démo.  
- TTS FinStories : contrôle acoustique manuel.  
- ÉCHO non livré.

## 9. `PIF`

**Inchangée** — `writesOnMain: false`.