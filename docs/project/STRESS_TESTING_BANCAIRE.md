# Tests de résistance bancaire — méthode et état

Cahier des charges 2026-2027, §3.5 (AI Stress Testing) et §3.6.2 (explication des stress tests).
Version du modèle : `pif-bank-stress-1.0.0`. Code : `apps/api/src/main/java/com/pif/api/stress/`, écran `apps/web/src/app/stress/`.

## Ce qui est livré

| Élément | État |
| --- | --- |
| Deux banques fictives comparables (conventionnelle, participative) | Livré |
| 8 facteurs de choc réglables, 9 scénarios prédéfinis, intensité globale × 0 à × 2 | Livré |
| Pertes de crédit PD × LGD × EAD, capital, levier, liquidité à 30 jours | Livré |
| Mécanismes propres à la banque participative | Livré |
| Comparaison des deux banques, expliquée | Livré |
| Décomposition exacte de Shapley des ratios (explication) | Livré |
| Courbe de sensibilité à l'intensité | Livré |
| API `GET /api/stress/catalog`, `POST /api/stress/run` (authentification requise) | Livré |
| Écran Angular `/stress-testing`, entièrement en français | Livré |
| Modèle d'apprentissage automatique (§3.5.3) : émulateur par gradient boosting, comparé à la moyenne et à une régression linéaire, validé hors échantillon | Livré — voir `MODELES_IA_ET_EVALUATION.md` |
| Explications du modèle (§3.6) : importance par permutation, Shapley du modèle comparé à celui du moteur | Livré |
| Aperçu IA en direct pendant le réglage des chocs (`POST /api/stress/preview`), confirmé par le moteur au relâchement avec l'écart affiché | Livré |
| « Qui absorbe le choc ? » : sources de la perte face à ce qui l'absorbe (fonds propres, impôt, PER, IRR, titulaires des PSIA), à la même échelle pour les deux banques ; équilibre vérifié pour les 9 scénarios × 2 banques | Livré |
| Jauge de capital (seuil 7 %, coussin 9,5 %) et cascade de Shapley façon SHAP du scénario central au ratio sous stress | Livré |
| Enregistrement et historique des exécutions | **Non livré** (aucune écriture en base) |
| Projection pluriannuelle | **Non livré** (horizon unique d'un an) |

## Banque non conventionnelle retenue

Banque **participative** (finance islamique), choisie parce que ses différences avec une banque conventionnelle sont
mécaniques et modélisables, pas seulement un changement de nom :

- **Mourabaha** (vente à marge fixe) : la marge ne suit pas les taux et l'échéance du client ne change pas ; la PD
  de ces financements ne réagit donc pas à une hausse de taux.
- **Ijara** (location) : loyers en partie révisables ; la banque porte la valeur résiduelle du bien, réévaluée avec
  l'immobilier.
- **Moucharaka / moudaraba** (partenariat) : la banque partage les pertes du projet ; taux de perte sensible aux
  actions, au PIB et à l'immobilier, pondéré à 250 %.
- **Comptes d'investissement participatifs (PSIA)** : non garantis ; les pertes sur les actifs qu'ils financent
  passent d'abord par la réserve IRR, puis sont partagées avec les titulaires (50 % par hypothèse).
- **Risque commercial déplacé** : une hausse des taux oblige la banque à reverser 60 % de la hausse aux titulaires,
  d'abord sur la réserve PER, puis sur son résultat.
- **Facteur alpha** (0,5) appliqué aux actifs pondérés financés par les PSIA, formule simplifiée inspirée de l'IFSB.

## Méthode (horizon un an, bilan statique)

| Étape | Formule |
| --- | --- |
| PD sous stress | `logistique(logit(PD₀) + β_chômage·Δu + β_PIB·(−ΔPIB) + β_taux·part variable·Δtaux) × multiplicateur de défaut`, plafonnée à 0,999 |
| LGD sous stress | `LGD₀ + sensibilité garantie × baisse de l'immobilier`, bornée à [0, 1] |
| Perte attendue | `PD × LGD × EAD` ; plus la perte de valeur résiduelle (ijara) |
| Marge | `marge de référence + Δtaux × (actifs − passifs révisés dans l'année)` (impasse de taux) |
| Titres | `−encours × part en juste valeur × duration × Δtaux` ; actions : `encours × variation de prix` |
| Résultat | marge + commissions − charges − coût du risque − risque commercial déplacé + absorptions ; impôt de 25 % si positif |
| CET1 à un an | `CET1₀ + résultat net + réévaluations` (aucun dividende) |
| Actifs pondérés | pondérations forfaitaires ; nouveaux défauts à 150 % nets de la perte ; risque opérationnel `15 % × PNB × 12,5` |
| LCR | `HQLA / (sorties à 30 jours − min(entrées, 75 % des sorties))` |
| Explication | valeurs de Shapley exactes sur les 256 combinaisons des 8 facteurs ; la somme égale la variation totale |

Seuils de lecture, inspirés de Bâle III : CET1 7 %, coussin 2,5 %, levier 3 %, LCR 100 %.
Ils servent de repères ; le modèle ne prétend à aucune conformité réglementaire.

## Validation

`StressEngineTest` (12 tests) et `StressServiceTest` (8 tests) vérifient notamment :

- bilans équilibrés et banques de même taille ;
- scénario central égal au compte de résultat de référence (calcul à la main) ;
- réévaluation obligataire et risque commercial déplacé égaux aux formules (−145,8 et 22,8 M DT pour +300 pb) ;
- PD des mourabaha insensible aux taux, PD des crédits à taux variable sensible ;
- PD, LGD et perte attendue égales au calcul à la main ;
- ratio CET1 strictement décroissant avec l'intensité du scénario, LCR non croissant ;
- absorption des pertes par les PSIA conforme aux paramètres ;
- somme des contributions de Shapley égale à la variation totale (à 10⁻¹² près) ; facteur neutre = 0 ;
- pont de capital de chaque banque égal au CET1 projeté ;
- validation des requêtes (scénario inconnu, facteur inconnu, valeurs hors bornes).

Vérifié dans le navigateur, avec le compte de test : scénarios « Récession » et « Combiné sévère », détail des deux
banques, aucune débordement horizontal à 360 px.

Résultats de référence (CET1 initial 13,48 % conventionnelle, 13,89 % participative) :

| Scénario | CET1 à un an, conventionnelle | CET1 à un an, participative |
| --- | --- | --- |
| Central | 15,20 % | 15,46 % |
| Récession | 12,23 % | 12,10 % |
| Combiné sévère | 4,93 % (vulnérable) | 5,76 % (vulnérable) |

## Limites

- Paramètres et sensibilités supposés, non estimés sur des données : le modèle illustre des mécanismes.
- Le choc de liquidité n'affecte que le LCR : pas de ventes forcées ni de coût de financement d'urgence.
- Pas d'effets de second tour, de croissance du bilan, de réaction de la direction ni de dividendes.
- La décomposition de Shapley explique ce modèle déterministe ; elle ne prouve aucune causalité réelle.
- Pas d'historique des exécutions.
- Le volet IA est un émulateur du moteur : il ne corrige aucune de ces limites et y ajoute sa propre erreur.
