# ÉCHO — Évaluation

## Nature des « modèles » utilisés par ÉCHO

| Composant | Nature | Rôle dans ÉCHO |
|---|---|---|
| `EchoIntentRouter` | règles déterministes (pas d'apprentissage) | compréhension de la question |
| `market-return-gbm`, `market-return-linear` (`AiModelRegistry`) | régresseurs entraînés sur série **synthétique** | expliqués (R², RMSE vs naïf, importance par permutation), jamais présentés comme prévision réelle |
| Moteur de stress (Shapley exact) | calcul déterministe + émulateur GBM | contributions de facteurs (association, pas causalité) |
| Lexique de sentiment | règles | non utilisé pour décider d'une alerte |

## Banc d'évaluation automatisé

| Suite | Contenu | Résultat (2026-11-20) |
|---|---|---|
| `EchoIntentRouterTest` | 27 questions du cahier des charges → intention attendue ; entités ; acronymes ≠ tickers ; contexte de page sans choix arbitraire ; validation du ticket | 33/33 ✅ |
| `EchoDatabaseTest` (`@Tag("database")`, `pif_test`) | performance sourcée = equity du moteur (±1 TND) ; suite conversationnelle (vente moitié → avant/après) ; pré-trade concentration + aucun ordre ; rejet moteur fonds insuffisants ; mémoire consentie + bilan ; alertes calculées/dédupliquées/ignorées ; isolation 2 utilisateurs ; choc 10 % = −10 % des positions (±0,05) ; notion ; prévision `MODEL` ; crise sans entrepôt → `NO_DATA` sans graphique ; instrument inconnu → `NO_DATA` ; mission absente → `NO_DATA` | 7/7 ✅ |
| `echo.spec.ts` (Angular) | mapping module ; formatage sans invention (`Indisponible`) ; badges de nature, flags, scénario hypothétique ; pas de graphique < 2 points ; voix muette sans consentement ; jamais pendant FinStories ; `stop()` n'annule que la voix d'ÉCHO | 7/7 ✅ |
| `journeys-echo.spec.ts` (Playwright) | P1, P3, P4, P5, P10, P11, P12, mobile | écrit ; **non exécuté** (voir ACCEPTANCE) |

## Propriétés vérifiées

- Données manquantes → `NO_DATA`/`PARTIAL` + `limitations` (jamais de valeur fabriquée).
- Données anciennes → « dernière clôture disponible au … », `dataAsOf`.
- Historique / modèle / simulation / hypothèse séparés par `evidence[].kind`.
- Biais : aucune émotion attribuée ; le bilan intention/résultat ne s'appuie que sur des mesures (positions effectives, poids, secteur, prix) et rappelle qu'un résultat ne juge pas une décision.
