# ÉCHO — Acceptation (2026-11-20)

Environnement : Windows 11, Java 25, Angular 22, PostgreSQL 16 (Docker `mtrs-postgres`, base `pif_test`). `PIF` et `PIF_spring_test` n'existent pas sur cette machine (voir DATA_SOURCES.md).

## Résultats exécutés

| Suite | Commande | Résultat |
|---|---|---|
| Spring unitaires | `mvnw -o -B test` | **3 939 / 3 939** ✅ (dont 33 ÉCHO) |
| Spring + base isolée | `mvnw -o -B -P database-tests test` | 3 982 / 3 989 — **7 échecs préexistants hors ÉCHO** : `AdminPlatformPersistenceDatabaseTest` (6) et `MarketRoomsDatabaseTest` (1) exigent les migrations `20261119220000_platform_admin_content` et `20261120180000_market_rooms`, non appliquées sur `pif_test`. `EchoDatabaseTest` 7/7 ✅ |
| Angular unitaires | `ng test --exclude login.page.spec.ts` | **322 / 323** ✅ ; l'échec `pricing-studio.page.spec.ts` (debounce, module non modifié) passe 2/2 en isolé — test sensible au temps sous charge. Dont 7 tests ÉCHO |
| Typecheck | `tsc -p tsconfig.app.json` / `tsconfig.spec.json` | ✅ hors `login.page.spec.ts` |
| Lint | `ng lint` | 1 erreur, **dans `login.page.spec.ts` uniquement** |
| Build production | `ng build` | ✅ ; avertissement de budget initial 538,7 kB / 500 kB — ÉCHO n'y contribue pas (panneau chargé en `@defer (on idle)`, chunk séparé de 61 kB) |
| Playwright ÉCHO | `journeys-echo.spec.ts` (projet `investor`) | **non exécuté** : l'API active sur :3002 a été démarrée avant l'ajout d'ÉCHO (`/api/echo/*` → 404) et doit être redémarrée |

`login.page.spec.ts` contient une modification non commitée antérieure à ÉCHO (apostrophe non échappée ligne 121 : `'ne montre aucun message d'erreur au départ'`) ; elle n'a pas été modifiée.

## Critères d'acceptation

| Critère | Statut |
|---|---|
| Intégré à Angular et Spring Boot, services existants réutilisés | ✅ |
| Contexte utilisateur autorisé (route, module, symbole, portefeuille, ordre, mission) | ✅ |
| Réponses françaises sourcées, données absentes/anciennes reconnues | ✅ |
| Réalité / simulation / prédiction distinguées | ✅ (`evidence.kind`, `scenario.hypothetical`) |
| Portefeuille, pré-trade, modèles, MarketQuest, FinStories, Time Machine, actuariat, stress bancaire | ✅ |
| Mémoire décisionnelle sous contrôle utilisateur, intention vs résultat | ✅ |
| Alertes calculées, dédupliquées, vocales si activées | ✅ |
| Permissions, aucun ordre autonome, données privées protégées | ✅ (tests DB) |
| Interface professionnelle, clair/sombre (tokens), responsive, clavier (Alt+E, Échap, focus) | ✅ code ; inspection visuelle navigateur non réalisée |
| Tests E2E | ◐ écrits, non exécutés |
| Suites Spring et Angular vertes | ◐ vertes hors échecs préexistants listés |
| Base `PIF` inchangée | ✅ (absente de la machine ; aucune connexion) |
| Capacités dépendant d'un modèle absent distinguées | ✅ (`/echo/capabilities`, `engine`) |

## Non livré

- Conversation libre par LLM (aucun modèle installé ; non téléchargé sans autorisation).
- Alertes poussées par le serveur (SSE) : évaluation à la consultation + polling 60 s.
- Captures visuelles et exécution Playwright.
- Analyse de crise sur données réelles sur cette machine (entrepôt absent).

## Scénario de démonstration

1. `/trading` : choisir un instrument → ÉCHO (Alt+E) « Peux-tu analyser cet actif ? » (cotation, période, volatilité, provenance).
2. Saisir une quantité importante dans le ticket → « Examiner le risque avec ÉCHO » → drapeaux de concentration/liquidités, tableau avant/après/moitié, aucun ordre envoyé.
3. Onglet Journal → activer la mémoire → noter « Diversification » → confirmer l'ordre dans le ticket → « Comparer intention et résultat ».
4. `/portfolios` : « Quels actifs représentent ma plus grande exposition ? » → « Et si je vendais la moitié de cette position ? » → « Compare le risque avant et après. »
5. « Quel serait l'impact d'une baisse simulée de 10 % ? » (badges Hypothèse/Simulation).
6. Onglet Alertes (concentration ≥ 40 %), Réglages → réponses vocales + alertes parlées.
7. Mission MarketQuest terminée → « Qu'aurais-je pu faire différemment ? » (Time Machine en mémoire).
8. « Voir la provenance et les limites » sur chaque réponse.
