# Conformité — deux cahiers des charges

**Date :** 2026-11-20 (mandat ultime)  
**Officiel :** `docs/requirements/PIF_Cahier_des_Charges_2026-2027.pdf` (+ `_cahier_extract.txt`)  
**Historique :** Simulateur Anne-Marie Hugues 2023–2024 — **PDF non trouvé dans le dépôt** ; exigences reprises depuis le mandat utilisateur + docs projet existants  
**Matrices liées :** `MATRICE_EXHAUSTIVE_FINALISATION.md`, `AUDIT_MOTEUR_CARNET_ORDRES.md`, `READINESS_POSTGRESQL_PIF.md`, `ATLAS_DES_44_INTERFACES.md`

États : `CONFORME_VERIFIE` · `IMPLEMENTE_NON_VERIFIE` · `PARTIEL` · `MANQUANT` · `NON_APPLICABLE_JUSTIFIE` · `EXTENSION_FACULTATIVE` · `BLOQUE`

---

## Priorité

1. Obligations « devra » du cahier **2026–2027**
2. Décisions déjà validées Market Trading Room
3. Intégrité des moteurs / données existants
4. Extensions compatibles **2023–2024**
5. Améliorations justifiées

---

## A. Cahier officiel 2026–2027 (synthèse fidèle)

| ID | Section | Formulation / résumé | Niveau | Implémentation | État | Réserve |
| --- | --- | --- | --- | --- | --- | --- |
| PIF26-UI-01 | 3.1 | Interface conviviale, dashboard personnalisé | devra | Angular shell + dashboard | `CONFORME_VERIFIE` | Matrice routes 351+rooms · light/dark · 4 viewports 2026-11-20 |
| PIF26-UI-02 | 3.1 | Suivi PF, positions, performances, graphiques, risque | devra | portfolios / trading / risk | `CONFORME_VERIFIE` | cotations **simulées** étiquetées |
| PIF26-UI-03 | 3.1 | Infos économiques/financières « en temps réel » | devra | quotes période + news pédagogiques + provenance | `CONFORME_VERIFIE` | Pas de feed bourse licencié ; provenance affichée |
| PIF26-TRD-01 | 3.2 | Achats/ventes multi-actifs, exécution simulée, historique | devra | Engine + PortfoliosService | `CONFORME_VERIFIE` | Mode quote-driven (pas CLOB) |
| PIF26-TRD-02 | 3.2 | Actions, obligations, matières premières, devises | objectif | EQUITY/FUND + BOND/FX/COMMODITY pédagogiques | `CONFORME_VERIFIE` | OK sur `PIF_spring_test` ; **`PIF` non migrée** |
| PIF26-RSK-01 | 3.2 | Risque **avant** transaction | devra | `PreTrade` + preview ordre | `CONFORME_VERIFIE` | |
| PIF26-RSK-02 | 3.2 | Indicateurs de risque position/PF | devra | Analytics VaR/ES/drawdown | `CONFORME_VERIFIE` | |
| PIF26-RSK-03 | 3.2 | Stop-loss, take-profit (exemples) | exemple | STOP + TAKE_PROFIT | `CONFORME_VERIFIE` | enum `PIF` pending migration |
| PIF26-ANA-01 | 3.2 | Analyse technique / fondamentale | devra | indicators + FundamentalsCatalog | `CONFORME_VERIFIE` | Fondamentaux pédagogiques (non Bloomberg) |
| PIF26-BT-01 | 3.2 | Backtesting + stratégies | devra | BacktestEngine + UI | `CONFORME_VERIFIE` | |
| PIF26-PED-01 | 3.3 | Formation, exercices, scénarios, défis, progression, quiz | devra | MarketQuest / challenges / learn | `CONFORME_VERIFIE` | |
| PIF26-AI-01 | 3.4.1 | Prédictions / recommandations (« pourra ») | pourra | AiService + page Prévisions | `CONFORME_VERIFIE` | Métriques honnêtes ; pas « modèle fiable » forcé |
| PIF26-AI-02 | 3.4.2 | Agent trading analysable | devra/pourra | RULE_AGENT + évaluation | `CONFORME_VERIFIE` | Heuristique règles, pas DL autonome |
| PIF26-AI-03 | 3.4.3 | Sentiments actualités | pourra | lexique FR + news synthétiques | `CONFORME_VERIFIE` | Portée pédagogique documentée |
| PIF26-ST-01 | 3.5 | Stress bancaire conv. / non-conv. + scénarios | devra | StressEngine | `CONFORME_VERIFIE` | Non réglementaire |
| PIF26-XAI-01 | 3.6 | Expliquer prédictions + stress | devra | /explainability + attributions | `CONFORME_VERIFIE` | Importance ≠ causalité |
| PIF26-ACT-01 | 3.7 | Primes, marges, sinistres, provisionnement | devra | module actuariat | `CONFORME_VERIFIE` | Extensions MC/CL/BF/ALM au-delà du minimum |
| PIF26-SEC-01 | 4 | Auth, rôles, protection données | devra | JWT/MFA/sessions/audit | `CONFORME_VERIFIE` | |
| PIF26-ADM-01 | 5 | Admin comptes, données, formations, modèles, scénarios, stats | devra | admin users + platform writes + audit | `CONFORME_VERIFIE` | Persistance PG sur schéma isolé ; news admin filtrées corrigées 20/11 |

**Obligatoires 2026–2027 :** 19/19 `CONFORME_VERIFIE` (0 PARTIEL / MANQUANT / BLOQUE).

---

## B. Cahier historique 2023–2024 (extensions)

| ID | Thème | Niveau | État | Note |
| --- | --- | --- | --- | --- |
| PIF23-AUTH-01 | Multi-joueurs id/mdp | extension alignée | `CONFORME_VERIFIE` | Déjà dans auth PIF |
| PIF23-PF-01 | PF vide puis trading | extension alignée | `CONFORME_VERIFIE` | Cash initial configurable |
| PIF23-ORD-01 | Marché + limite | extension alignée | `CONFORME_VERIFIE` | |
| PIF23-SHORT-01 | Pas de short | extension alignée | `CONFORME_VERIFIE` | Contrôle serveur |
| PIF23-CLOB-01 | Carnet + matching peer + partiels | **extension majeure** | `EXTENSION_FACULTATIVE` | **non livré** (volontaire) |
| PIF23-OPT-01 | Options | extension | `NON_APPLICABLE_JUSTIFIE` | Pas de moteur options complet |
| PIF23-BANK-01 | Compte bancaire externe | extension | `EXTENSION_FACULTATIVE` | PF virtuel interne |
| PIF23-TA-01 | Chandeliers / MM | extension | `PARTIEL` | Séries mid + indicateurs ; pas OHLC candle engine complet |
| PIF23-MACRO-01 | Événements macro / temps accéléré / bots | extension | `PARTIEL` | Simulation déterministe ; bots CLOB non présents |
| PIF23-HELP-01 | Aide produits/vocabulaire | extension | `PARTIEL` | Aide existante à renforcer contextuellement |

---

## C. Distinction critique — trading

| Affirmation | Autorisée ? |
| --- | --- |
| « Simulation d’exécution d’ordres » (cahier 2026) | Oui — moteur quote-driven |
| « Véritable carnet d’ordres multi-participants » | Non tant que CLOB non livré |
| « Cotations temps réel de bourse » | Non — simulé / pédagogique |
| « TAKE_PROFIT prêt sur `PIF` » | Non — migration non autorisée |

---

## D. Verdict dimensions

| Dimension | Verdict |
| --- | --- |
| Conformité officielle 2026–2027 | **COMPLET** — 19/19 `CONFORME_VERIFIE` (réserves pédagogiques documentées) |
| Extensions historiques 2023–2024 | CLOB / options / banque externe **non livrés** ; short + ordres marché/limite OK |
| Qualité scientifique | Moteurs testés ; IA/XAI/stress avec limites |
| Qualité fonctionnelle | Trading + admin news + parcours métier OK |
| Qualité visuelle | Matrice routes/thèmes/viewports rejouée |
| Validation technique | Spring 3946 · Angular 324 · Playwright routes+journeys |
| Préparation migration | Documentée ; **`PIF` intacte** |
| Autorisation mise en service | **EN ATTENTE D’AUTORISATION DE MIGRATION** |

**Verdict global autorisé :**  
**VALIDATION PRODUIT COMPLÈTE SUR ENVIRONNEMENT ISOLÉ.**  
**MISE EN SERVICE EN ATTENTE D’AUTORISATION DE MIGRATION.**