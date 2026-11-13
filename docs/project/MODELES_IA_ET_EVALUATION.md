# Modèles d'IA et évaluation

État au 13 novembre 2026. Un seul modèle d'apprentissage automatique est livré : l'émulateur des tests de
résistance bancaire. Les autres volets IA du cahier (prédiction des marchés, recommandations, agent de trading,
analyse de sentiment) ne sont **pas encore implémentés**.

## Émulateur des tests de résistance (§3.5.3, §3.6)

Version `pif-stress-emulator-1.0.0`. Code : `apps/api/src/main/java/com/pif/api/stress/ml/` et
`StressModelService.java`. API : `GET /api/stress/model` (fiche du modèle) ; chaque `POST /api/stress/run` renvoie
l'estimation par banque (`aiEstimate`). Écran : `/stress-testing`, panneaux « Estimation par l'IA » et « Volet IA :
fiche du modèle ».

### Ce que le modèle est — et n'est pas

Il apprend à prédire, pour un scénario et une banque, la variation à un an du ratio CET1 et du LCR (en points de
pourcentage). Ses données sont des scénarios **synthétiques** calculés par le moteur déterministe
(`STRESS_TESTING_BANCAIRE.md`). C'est donc un **émulateur** : sa précision mesure sa fidélité au moteur, pas une
capacité à prévoir le comportement de banques réelles. Le résultat exact du moteur est toujours affiché à côté.

Usages : estimation instantanée, détection des scénarios qui franchissent un seuil, et démonstration
pédagogique d'un protocole complet d'apprentissage automatique (données, validation, comparaison, explication).

### Données et protocole

- 9 variables : les 8 facteurs du scénario + l'indicateur « banque participative » (0/1).
- Échantillonnage : chaque facteur est neutre avec une probabilité de 40 %, sinon tiré uniformément dans sa plage
  d'entraînement (plus étroite que la plage acceptée par l'API).
- 4 jeux disjoints, avec des graines fixes, chaque scénario donnant une ligne par banque :

| Jeu | Lignes | Graine | Rôle |
| --- | --- | --- | --- |
| Entraînement | 6 000 | 101 | ajustement |
| Validation | 1 600 | 202 | arrêt précoce uniquement |
| Test | 3 000 | 303 | évaluation, même distribution, jamais vu |
| Extrapolation | 1 600 | 404 | plages complètes, chocs plus sévères que l'entraînement |

Aucun hyperparamètre n'est réglé sur le jeu de test. L'entraînement est entièrement reproductible
(même graine, même modèle) ; il prend environ 9 s et se lance en arrière-plan au démarrage du serveur.

### Modèles comparés

| Modèle | Description |
| --- | --- |
| Moyenne | prédit la moyenne d'entraînement : plancher |
| Régression linéaire | moindres carrés sur variables standardisées ; transparent, sans interaction |
| Gradient boosting | arbres de régression de profondeur 4, taux 0,1, sous-échantillonnage 0,8, ≥ 20 observations par feuille, au plus 400 itérations, arrêt précoce sur la validation |

Tout est écrit en Java (aucun service Python, aucune bibliothèque externe d'apprentissage automatique).
Le choix de 400 itérations est mesuré : R² de test du CET1 0,983 à 400 itérations contre 0,986 à 1 000, pour
2,5 fois le temps de calcul.

### Résultats mesurés

R² et erreur absolue moyenne (en pp) :

| Cible | Modèle | R² test | Erreur test | R² extrapolation | Erreur extrapolation |
| --- | --- | --- | --- | --- | --- |
| CET1 | Moyenne | 0,000 | 2,40 | −0,348 | 6,60 |
| CET1 | Linéaire | 0,783 | 1,08 | 0,652 | 3,10 |
| CET1 | Gradient boosting | **0,983** | **0,26** | 0,606 | 3,21 |
| LCR | Moyenne | 0,000 | 45,47 | −0,012 | 58,94 |
| LCR | Linéaire | 0,879 | 14,01 | 0,326 | 36,08 |
| LCR | Gradient boosting | **0,9998** | **0,40** | **0,839** | **6,98** |

Détection des franchissements de seuil (CET1 < 7 % ou LCR < 100 %), à partir des deux prédictions :

| Jeu | Modèle | Précision | Rappel | Exactitude |
| --- | --- | --- | --- | --- |
| Test (1 090 franchissements / 3 000) | Linéaire | 98,4 % | 75,6 % | 90,7 % |
| Test | Gradient boosting | **99,4 %** | **98,3 %** | **99,2 %** |
| Extrapolation (1 022 / 1 600) | Linéaire | 95,7 % | **92,0 %** | **92,3 %** |
| Extrapolation | Gradient boosting | **99,9 %** | 86,4 % | 91,3 % |

**Lecture honnête.** Le gradient boosting est nettement meilleur sur des scénarios comparables à l'entraînement.
Hors domaine, il se dégrade fortement, comme attendu pour des arbres qui n'extrapolent pas. Sur le CET1 et sur le
rappel des franchissements, la régression linéaire y fait même mieux. L'écran signale chaque scénario hors domaine.

### Explications (XAI)

- **Globale** : importance par permutation sur le jeu de test (hausse de l'erreur quadratique moyenne quand une
  variable est mélangée, 3 répétitions). Elle retrouve la structure du moteur : le choc de liquidité n'a aucun poids
  sur le CET1 (0,000) et domine le LCR.
- **Locale** : valeurs de Shapley exactes de la prédiction du modèle (256 combinaisons des 8 facteurs), avec le
  scénario sans choc comme référence ; leur somme égale la prédiction moins la prédiction de référence.
- **Fidélité** : les contributions du modèle sont comparées à la décomposition de Shapley exacte du moteur
  (même facteur principal ? écart relatif Σ|φ modèle − φ moteur| / Σ|φ moteur|). Exemple vérifié, récession,
  banque conventionnelle : même facteur principal, écart relatif de 11,4 %.
- **Modèle transparent** : coefficients de la régression linéaire, par écart-type et par unité.

### Tests

`MachineLearningTest` (7 tests) : métriques calculées à la main, coefficients exacts retrouvés sur des données
linéaires, boosting supérieur au linéaire sur une fonction non linéaire (R² > 0,97 contre < 0,8), reproductibilité,
importance nulle d'une variable inutilisée, propriété d'efficacité de Shapley.
`StressModelServiceTest` (7 tests) : supériorité du boosting sur le test, dégradation hors domaine signalée,
détection des franchissements, cohérence de l'importance avec le moteur, somme des explications locales,
comparaison indéfinie quand le moteur ne varie pas, protocole documenté.

### Limites

- Données synthétiques : aucune capacité de prévision sur des banques réelles n'est démontrée ni revendiquée.
- Extrapolation faible ; une seule référence pour les valeurs de Shapley ; l'importance par permutation peut
  répartir l'importance de façon trompeuse entre variables liées et ne prouve aucune causalité.
- Un seul type de modèle d'apprentissage automatique ; pas de réseau de neurones ni de modèle de séries temporelles.
