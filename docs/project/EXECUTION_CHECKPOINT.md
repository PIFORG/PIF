# Point de reprise — mandat de finalisation Market Trading Room

Dernière mise à jour : 13 novembre 2026, livraison du premier incrément des tests de résistance bancaire.

## Phase actuelle

**P5 — Tests de résistance bancaire, incrément 1 livré** (priorité avancée à la demande de l'utilisatrice ;
les tests sur base PostgreSQL sont reportés). Détail : [`STRESS_TESTING_BANCAIRE.md`](STRESS_TESTING_BANCAIRE.md).

- Moteur déterministe, API `/api/stress`, écran `/stress-testing` (sorti des aperçus), décomposition de Shapley exacte.
- Résultats des tests au 13 novembre : backend **3 832 tests, 0 échec** (dont 20 nouveaux) ; Angular **290 tests,
  0 échec** (dont 5 nouveaux), typecheck OK, build de production OK ; vérification dans le navigateur faite.
- **Incrément 2 livré le 13 novembre** : émulateur par gradient boosting (§3.5.3) comparé à la moyenne et à une
  régression linéaire, validé sur des jeux jamais vus (R² test CET1 0,983, LCR 0,9998 ; dégradation hors domaine
  mesurée et signalée), explications globales et locales (§3.6). Détail : [`MODELES_IA_ET_EVALUATION.md`](MODELES_IA_ET_EVALUATION.md).
  Tests : backend **3 846, 0 échec** ; Angular **293, 0 échec** ; vérifié dans le navigateur.
- **Incrément 3 (design) le 13 novembre** : aperçu IA en direct pendant le réglage (confirmé par le moteur, écart
  affiché), vue « Qui absorbe le choc ? », jauges de capital, cascade façon SHAP. Tests : backend **3 849, 0 échec** ;
  Angular **296, 0 échec** ; vérifié dans le navigateur (par lecture de la page : le volet était masqué, pas de capture
  en largeur de bureau).
- CSS corrigé le 13 novembre : commentaire cassé de `globals.css` (perte de toute la palette du thème sombre),
  collision de classes `st-` avec FinStories (préfixe renommé `bs-`), doublons de thème inutilisés mis à la corbeille.
- Non livré : historique des exécutions, horizon pluriannuel, test de résistance inversé, carte de vulnérabilité.
- **FinStories, 13 novembre** : narration toujours en voix française (la voix `en-US` lisait le texte français avec
  un accent anglais), meilleure voix choisie automatiquement (voix neuronales d'Edge en priorité), sélecteur de voix
  mémorisé, texte adapté à l'oral, scène qui attend la fin de la phrase, montants des visuels au format français.
  Tests Angular **302, 0 échec**. Limite : la qualité dépend des voix installées dans le navigateur ; une voix
  humaine identique partout demanderait des fichiers audio pré-générés.
- **FinStories, design « story »** : galerie (anneaux de progression, affiches animées par personnage, statut
  Nouveau / En cours / Vu) ; une histoire s'ouvre en plein écran (zoom), toucher à droite / à gauche pour changer de
  scène, maintenir pour mettre en pause, glisser ↑ ↓, flèches ou molette pour passer d'une histoire à l'autre (le fil
  vertical est conservé), Échap pour fermer, enchaînement automatique, `?story=` ouvre directement l'histoire,
  animations désactivées avec « réduire les animations ». Correction : l'horloge du lecteur ne recule plus et ne
  saute plus après une image bloquée. Tests Angular **308, 0 échec**, lint et build OK ; vérifié dans le navigateur.
  Le bundle initial passe à 599,8 kB (budget 500 kB, dépassement déjà existant, +10 kB de CSS).

**Attention — modifications extérieures non vérifiées.** Entre 00 h 47 et 00 h 50 le 13 novembre, des fichiers ont été
modifiés hors de ce travail : `apps/web/src/styles/globals.css`, `actuarial.css`, `admin.css` (modifiés) et
`apps/web/src/app/core/theme.service.ts`, `styles/design-tokens.css`, `styles/theme-light.css` (créés). Ils provoquent
1 erreur de lint (`theme.service.ts:24`, variable `e` inutilisée) et un avertissement CSS (`globals.css:2`, l'ouverture
du commentaire `/*` semble avoir été remplacée par la ligne `@import`). Non corrigés : à confirmer avec leur auteur.

## Phase précédente

**P0 — Stabilisation : terminée pour les tests unitaires.** Toutes les suites unitaires backend et frontend passent.
Les tests d'intégration PostgreSQL (`database-tests`) restent à exécuter (aucune base `*_test` n'existe encore).

## Point de récupération

- `HEAD` = `20d1008abf87d428590427b45aed8a57f80866ed` (`main`, aligné sur `origin/main`). Rien n'est commité.
- Modifications non commitées qui existaient avant le mandat : `backups/pre-mandat-uncommitted-20261112.patch`
  (`apps/api/.env.example` supprimé, `apps/api/README.md`, `apps/web/angular.json`, `package-lock.json`). Non modifiées depuis.
- Références anglaises d'origine : versions de `learning-golden.json` et `trading-golden.json` au commit `20d1008`.
- Base `PIF` : aucune migration ni réinitialisation. Seules modifications, à la demande de l'utilisatrice : les
  comptes de test `test@pif.tn` (investisseur) et `admin@pif.tn` (administrateur, créé le 13 novembre via
  l'inscription puis rôle `ADMIN` et e-mail vérifié par une requête SQL limitée à ce compte). Identifiants dans
  `.env.test-accounts.local` (ignoré par git).

## Résultats des tests exécutés

| Suite | Avant | Après |
| --- | --- | --- |
| Backend `mvnw test` (profil `unit`) | 3 807 tests, 185 échecs | **3 812 tests, 0 échec** |
| Angular `ng test` | 286 tests, 1 échec | **286 tests, 0 échec** |
| Angular `ng lint` | 4 erreurs | **0 erreur** |
| Angular typecheck | OK | OK |
| Angular build de production | — | OK (avertissement : bundle initial 589 kB pour un budget de 500 kB, non traité) |
| Backend `database-tests` | non exécuté | non exécuté |

## Réalisé dans cette session

### 1. Références de tests (« golden master ») — vérification scientifique avant régénération

Les 185 échecs venaient de la francisation, pas des calculs. Méthode suivie :

1. Le moteur d'origine (commit `6a8c793`, textes anglais rétablis) passe les références d'origine à 100 % : c'est l'oracle.
2. Les sorties complètes de l'oracle et du moteur actuel ont été comparées sur les 105 sessions pédagogiques
   (3 330 628 valeurs) et les 70 cas d'analytique de portefeuille (11 601 valeurs).
3. Résultat : **0 différence** de nombre, d'identifiant, de code, de statut, de transition d'état, de rejeu
   ou de longueur de liste. Seuls changent les textes (dont les nombres intégrés sont identiques, au séparateur
   de milliers près) et la nouvelle clé d'affichage `sectorLabel`.
4. Les références ont alors été régénérées depuis le moteur Java : seules les sorties enregistrées sont
   remplacées ; missions, commandes, graines, cotations et historiques sont recopiés tels quels. Une comparaison
   ancienne/nouvelle référence confirme 0 changement de nombre, de code ou de type. Chaque fichier porte une
   note `frenchRegeneration` qui décrit cette provenance.

### 2. Défauts corrigés

- **FinStories** : 12 légendes affichaient « {0} » / « {1} » à l'utilisateur. Les montants sont maintenant
  calculés par `StoryCatalog.captionValues` (les mêmes constantes que le script anglais) et écrits au format
  français (`10 000`, `8 457,5`). Légendes des graphiques, titres d'actualité et points « À retenir » traduits.
  Libellés du lecteur traduits (« Montant de départ », « Revenons en arrière ! », « À retenir »…).
- **Machine à remonter le temps** : « Annuler lordre {0} » (apostrophe et identifiant perdus par `MessageFormat`)
  devient « Annuler l'ordre o7 ». Les ordres sont décrits en français (« Achat 120 OLV à cours limité à 9.85 DT »),
  les scénarios de résistance par leur nom (« Test de résistance : Krach actions »).
- **Moteur pédagogique**, textes seulement : « Passage à day 3 sur 5 » → « Passage au jour 3 sur 5 » ;
  « meilleur offre / demande » → « meilleur prix vendeur / acheteur » ; « raison « diversify » » → motif en français ;
  jargon anglais remplacé (utilities, profit warning, downside, bid/ask expliqués).
- **Angular** : 4 erreurs de lint, 1 test resté en anglais.
- Nouveau test `StoryCaptionsFrTest` (5 cas) : aucun texte entre accolades, montants identiques au script anglais,
  traduction complète des visuels, libellés de la Machine à remonter le temps.

Vérifié sur l'API en cours d'exécution (compte de test) : les 4 histoires, 0 texte entre accolades, UTF-8 valide.
Pas de vérification visuelle dans le navigateur : le volet navigateur était masqué.

## Défauts ouverts

1. Tests `database-tests` : créer `PIF_spring_test` et les exécuter.
2. Classes d'actifs : l'énumération ne contient que `EQUITY` et `FUND`. La migration obligations / matières premières /
   devises attend une approbation pour `PIF` et est encodée en UTF-16 (inapplicable telle quelle).
3. Modules encore en aperçu : `/ai`, `/challenges`, `/explainability`, `/strategies`.
4. Absents du code : analyse fondamentale, sentiment, agent de trading, volet IA des tests de résistance, XAI des modèles,
   tarification actuarielle prédictive, capital économique, ALM, compétitions et quiz, ordres « take-profit »,
   administration au-delà des utilisateurs et de l'audit.
5. L'API renvoie `Content-Type: application/json` sans `charset` (sans effet sur les navigateurs).
6. `apps/api/README.md` contient `copy .env .env` (modification antérieure au mandat, à corriger en `copy .env.example .env`
   si le fichier exemple est restauré).
7. Budget de taille du bundle Angular dépassé de 89 kB.

## Prochaines actions exécutables

0. Volet IA suivant : prédiction des marchés (§3.4.1) avec découpage chronologique et validation progressive,
   puis recommandations, agent de trading et analyse de sentiment.
1. Rédiger `EXIGENCES_ET_COUVERTURE.md` et `ETAT_INITIAL_VERIFIE.md` à partir de l'audit (non écrits).
2. Créer `PIF_spring_test`, exécuter `database-tests`.
3. P1 : classes d'actifs (sur `PIF_spring_test`), données historiques, studio des risques.
