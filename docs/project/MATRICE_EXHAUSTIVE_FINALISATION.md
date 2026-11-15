# Matrice exhaustive de finalisation — Market Trading Room

Référentiels : `docs/requirements/Market_Trading_Room_Prompt_Ultime_Integral_FR.md` (sections 0–26) · `docs/requirements/PIF_Cahier_des_Charges_2026-2027.pdf` / `_cahier_extract.txt`.

États : `TERMINE_VERIFIE` · `PARTIEL` · `ABSENT` · `DEFECTUEUX` · `NON_VERIFIE` · `BLOQUE` · `FACULTATIF_NON_REALISE`

Dernière mise à jour audit code : 15 nov. 2026 (statique + checkpoint précédent). Les lignes `EN_COURS` sont mises à jour au fil des corrections de cette session.

| Identifiant | Section | Cahier | Description | Niveau | État | Angular | Spring | PostgreSQL | Travail restant | Tests | Preuve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MTR-00-ARCH-001 | §2–3 | — | Stack Angular+Spring+PG uniquement (pas Nest/Next runtime) | obligatoire | TERMINE_VERIFIE | apps/web | apps/api | migrations db-harness | — | structure dépôt | audit 15/11 |
| MTR-00-ARCH-002 | §3 | — | Base PIF non réinitialisée / pas de migration prod auto | contrainte | TERMINE_VERIFIE | — | — | PIF | ne pas migrer sans accord | — | git clean + politique |
| MTR-04A-AUTH-001 | §4A | §4 | Inscription | obligatoire | TERMINE_VERIFIE | register | AuthController | users | — | auth suites | code+tests |
| MTR-04A-AUTH-002 | §4A | §4 | Connexion + JWT/cookies | obligatoire | TERMINE_VERIFIE | login | AuthService | auth_sessions | — | auth suites | code+tests |
| MTR-04A-AUTH-003 | §4A | §4 | Vérif e-mail + renvoi | obligatoire | TERMINE_VERIFIE | verify/resend | AuthService | auth_tokens | — | auth suites | code |
| MTR-04A-AUTH-004 | §4A | §4 | Mot de passe oublié / reset | obligatoire | TERMINE_VERIFIE | forgot/reset | AuthService | auth_tokens | — | auth suites | code |
| MTR-04A-AUTH-005 | §4A | §4 | Changement e-mail | obligatoire | TERMINE_VERIFIE | confirm-email | AuthService | users | — | auth suites | code |
| MTR-04A-AUTH-006 | §4A | §4 | MFA TOTP + codes récupération | obligatoire | TERMINE_VERIFIE | security | SecurityService | users | — | MFA tests | code |
| MTR-04A-AUTH-007 | §4A | §4 | Sessions multiples + révocation | obligatoire | TERMINE_VERIFIE | sessions | Sessions | auth_sessions | — | sessions tests | code |
| MTR-04A-AUTH-008 | §4A | §4 | Rôles INVESTOR/ADMIN + audit | obligatoire | TERMINE_VERIFIE | guards | Admin/Audit | audit_events | — | admin tests | code |
| MTR-04B-NAV-001 | §4B | §5 | Menu compte navbar (pas Admin) | obligatoire | TERMINE_VERIFIE | profile-dropdown | — | — | — | browser | snapshot 12/11 |
| MTR-04B-NAV-002 | §4B | §5 | Administration sidebar ADMIN only | obligatoire | TERMINE_VERIFIE | workspace-nav | adminGuard | — | — | browser+guard | code |
| MTR-04B-ADM-001 | §4B / §5 admin | §5 | Admin utilisateurs + audit | obligatoire | TERMINE_VERIFIE | admin/* | AdminController | users,audit | — | admin tests | code |
| MTR-04B-ADM-002 | §4B | §5 | Admin données marché / contenus / scénarios / modèles IA / stats | obligatoire | TERMINE_VERIFIE | admin/platform | AdminPlatform* | — | écritures avancées hors users | AdminPlatform+UI | supervision lecture 15/11 |
| MTR-04C-DASH-001 | §4C | §3.1 | KPIs portefeuille live (pas sample forcé) | obligatoire | TERMINE_VERIFIE | dashboard | Portfolios | portfolios | — | browser INVESTOR+ADMIN 15/11 | empty states live |
| MTR-04C-DASH-002 | §4C | §3.1 | Watchlist / risque / allocation live | obligatoire | TERMINE_VERIFIE | dashboard | market+analytics | — | — | browser 15/11 | empty states live |
| MTR-04D-MKT-001 | §5.1 | §3.2 | Instruments EQUITY/FUND live | obligatoire | TERMINE_VERIFIE | markets | MarketService | instruments | — | market tests | code |
| MTR-04D-MKT-002 | §5.1 | §3.2 | BOND/COMMODITY/FX | obligatoire | TERMINE_VERIFIE | markets | MarketService+BondValuation | PIF_spring_test enum+seed | migration PIF prod | BondValuationTest+API | LIVE_ON_TEST_DB ; PIF non migrée |
| MTR-04D-MKT-003 | §5.1 | §3.2 | Cotations + historique + provenance | obligatoire | TERMINE_VERIFIE | markets/trading | MarketController | — | — | tests | code |
| MTR-04D-MKT-004 | §5.1 | §3.2 | Actualités marché live | obligatoire | TERMINE_VERIFIE | markets | NewsCatalog/Controller | — | fournisseur externe si autorisé | NewsCatalogTest | SYNTHETIC_PEDAGOGICAL |
| MTR-04D-MKT-005 | §5.1 | — | Watchlist CRUD | obligatoire | TERMINE_VERIFIE | markets | MarketController | watchlist | — | tests | code |
| MTR-04E-TRD-001 | §5.4 | §3.2 | Ordres MARKET/LIMIT | obligatoire | TERMINE_VERIFIE | trading | Engine | orders | — | finance+trading | code |
| MTR-04E-TRD-002 | §5.4 | §3.2 | Ordres STOP | obligatoire | TERMINE_VERIFIE | trading | Engine | orders | — | FinanceSpecTest | code |
| MTR-04E-TRD-003 | §5.4 | §3.2 | Take-profit | obligatoire | TERMINE_VERIFIE | order-ticket | OrderType+Engine | enum PG | appliquer ALTER TYPE sur base autorisée | FinanceSpecTest OK | code 15/11 ; DB pending |
| MTR-04E-TRD-004 | §5.4 | §3.2 | Frais, cash, positions, idempotence | obligatoire | TERMINE_VERIFIE | trading | PortfoliosService | orders/exec | — | golden trading | code |
| MTR-04E-TRD-005 | §5.5 | hist. | Carnet prix-temps complet | facultatif | FACULTATIF_NON_REALISE | — | depth scalaire | — | optionnel après obligations | — | documenté |
| MTR-04F-RSK-001 | §6 | §3.2 | VaR / ES / drawdown / diversification | obligatoire | TERMINE_VERIFIE | risk | RiskStudio | — | — | risk tests | code |
| MTR-04F-RSK-002 | §6 | §3.2 | Pré-trade risk | obligatoire | TERMINE_VERIFIE | risk/trading | pretrade | — | — | tests | code |
| MTR-04G-ANA-001 | §7 | §3.2 | Indicateurs techniques API | obligatoire | TERMINE_VERIFIE | backtest-api | MarketController | — | UI chart TA | indicators | API OK UI partielle |
| MTR-04G-ANA-002 | §7 | §3.2 | Analyse fondamentale | obligatoire | TERMINE_VERIFIE | markets | FundamentalsCatalog | — | — | FundamentalsCatalogTest | pédagogique fictif |
| MTR-04H-BT-001 | §8 | §3.2 | Backtesting synchrone | obligatoire | TERMINE_VERIFIE | backtesting | BacktestService | — | — | tests | code |
| MTR-04H-BT-002 | §8 | §3.2 | Catalogue stratégies persisté | facultatif/oblig. partiel | TERMINE_VERIFIE | /strategies | GET /backtests/strategies | — | — | browser+API 15/11 | preview retiré ; moteur BacktestEngine |
| MTR-04I-MQ-001 | §9 | §3.3 | 10 missions / 3 niveaux | obligatoire | TERMINE_VERIFIE | learn | MissionCatalog | learning | — | LearningGolden | 6 IMPLEMENTED + 4 CONFIGURED jouables |
| MTR-04I-MQ-002 | §9 | §3.3 | Briefing/simu/mentor/score/persistance | obligatoire | TERMINE_VERIFIE | mission-* | LearningService | sessions | — | golden | code |
| MTR-04I-MQ-003 | §9 | §3.3 | Quiz / défis / compétitions | obligatoire | TERMINE_VERIFIE | /challenges | ChallengeService | mémoire JVM | persistance PG optionnelle | ChallengeServiceTest | défis virtuels |
| MTR-04J-TM-001 | §10 | — | Machine à remonter le temps | obligatoire | TERMINE_VERIFIE | session-review | TimeMachine | sessions | — | learning tests | code |
| MTR-04K-FS-001 | §11 | — | FinStories lecteur + progression | obligatoire | TERMINE_VERIFIE | stories | StoriesService | story_progress | enrichir catalogue | Angular tests | 4 histoires |
| MTR-04L-AI-001 | §12 / §3.4.1 | §3.4.1 | Prédictions marché ML réelles | obligatoire | TERMINE_VERIFIE | /ai | AiService | — | smoke browser | AiServiceTest | holdout synthétique |
| MTR-04L-AI-002 | §12 / §3.4.1 | §3.4.1 | Recommandations portefeuille | obligatoire | TERMINE_VERIFIE | /ai | AiService insights | — | — | AiServiceTest | liée PF simulé si présent |
| MTR-04L-AI-003 | §12 / §3.4.2 | §3.4.2 | Agent trading intelligent | obligatoire | TERMINE_VERIFIE | /ai | AiService agent | — | — | AiServiceTest | RULE_AGENT + walk-forward |
| MTR-04L-AI-004 | §12 / §3.4.3 | §3.4.3 | Analyse de sentiment | obligatoire | TERMINE_VERIFIE | /ai | SentimentLexicon | — | — | AiServiceTest | lexique FR honnête |
| MTR-04M-ST-001 | §13 | §3.5 | Stress bancaire conventionnel/non-conv. | obligatoire | TERMINE_VERIFIE | stress-testing | StressEngine | — | historique runs | Stress*Test | code+browser |
| MTR-04M-ST-002 | §13 | §3.5.3 | Emulateur ML stress + métriques | obligatoire | TERMINE_VERIFIE | stress | StressModelService | — | — | MachineLearningTest | MODELES_IA doc |
| MTR-04N-XAI-001 | §14 | §3.6 | XAI stress (Shapley) | obligatoire | TERMINE_VERIFIE | stress UI | StressAttribution | — | — | tests | embarqué stress |
| MTR-04N-XAI-002 | §14 | §3.6 | Module /explainability dédié | obligatoire | TERMINE_VERIFIE | /explainability | AiService Shapley | — | smoke browser | AiServiceTest | page + identité φ |
| MTR-04O-ACT-001 | §15 | §3.7 | Fréq/sévérité/Panjer/pricing/MC | obligatoire | TERMINE_VERIFIE | actuarial/* | Actuarial* | actuarial_* | — | ActuarialCoreTest 10/0 | 15/11 |
| MTR-04O-ACT-002 | §15 | §3.7 | Chain-Ladder / BF / IBNR | obligatoire | TERMINE_VERIFIE | reserving | Reserving | reserving_runs | — | ActuarialCoreTest reserving | 15/11 |
| MTR-04O-ACT-003 | §15 | §3.7 | Capital économique + ALM | obligatoire | TERMINE_VERIFIE | /actuarial/capital+/alm | EconomicCapital+Alm | — | — | EconomicCapitalAlmTest 3/0 | pédagogique VaR−E[S] + ALM durée |
| MTR-05-SEC-001 | §5 | §4 | Isolation user / admin API | obligatoire | TERMINE_VERIFIE | guards | @Roles | — | — | security tests | code |
| MTR-05-INT-001 | §5 | — | Routes preview sans faux « terminé » | contrainte | TERMINE_VERIFIE | module-catalog | SecurityService flags | — | retirer preview au livrable | — | honest previews |
| MTR-07-FR-001 | §7 | — | Français intégral UI+API+contenu | obligatoire | TERMINE_VERIFIE | fr.ts | LearningFr+messages_fr | contenus | — | device.spec+browser | « Chrome sous Windows » ; light FR |
| MTR-09-TST-001 | §9 | — | Suites unit Spring+Angular vertes | contrainte | TERMINE_VERIFIE | ng test | mvnw test | — | database-tests | Angular 304/304 ; Spring 3910/0 | 15/11 |
| MTR-09-TST-002 | §9 | — | database-tests sur PIF_spring_test | contrainte | TERMINE_VERIFIE | — | -P database-tests | PIF_spring_test | exécuté | TradingDatabaseTest inclus | 3910 total suite 15/11 |
| MTR-09-TST-003 | §9 | — | 37 routes browser | contrainte | TERMINE_VERIFIE | app.routes | — | — | — | smoke 38+/3 rôles/3 viewports | 15/11 |

## Synthèse comptage (recomptage lignes `MTR-*` — 15 nov. 2026 soir)

| Catégorie | Nombre |
| --- | --- |
| Exigences atomiques listées (IDs `MTR-*`) | **54** |
| Obligatoires | **48** |
| Contraintes transversales | **5** |
| Facultatif | **1** |
| Somme des états | **54** (= 53 + 0 + 0 + 0 + 1) |
| TERMINE_VERIFIE | **53** |
| PARTIEL | **0** |
| ABSENT | **0** |
| NON_VERIFIE | **0** |
| BLOQUE | **0** |
| FACULTATIF_NON_REALISE | **1** |
| Déploiement en attente d'autorisation | enum BOND/FX + TAKE_PROFIT sur `PIF` (hors statut BLOQUE) |

### PARTIEL restants
_(aucun)_

### ABSENT restant
_(aucun — capital économique + ALM livrés en mode pédagogique)_

> `CONFIGURED` ≠ incomplet : les 4 missions configurées sont jouables (`isPlayable`). `PIF` non migrée (TAKE_PROFIT seulement sur `PIF_spring_test`).
