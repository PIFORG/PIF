# ÉCHO — Capacités réellement livrées

Légende : ✅ livré et testé · ◐ livré, dépend de données absentes sur cet environnement · ✗ non livré.

| Domaine | Question type | Moteur réutilisé | Statut |
|---|---|---|---|
| Performance | « Quelle est la performance de mon portefeuille ? » | `PortfoliosService.get/analytics` (TWR, MWR, P&L) | ✅ |
| Exposition | « Quels actifs représentent ma plus grande exposition ? » | positions + `RiskStudio.snapshot` (HHI, 1/HHI), agrégat secteur | ✅ |
| Risque | « Pourquoi mon risque a-t-il augmenté ? » | `analytics` (VaR/ES historiques, `riskContributions`) + dernières exécutions | ✅ (pas d'historique de VaR : dit explicitement) |
| Rejet d'ordre | « Pourquoi mon ordre a-t-il été rejeté ? » | journal des ordres (`rejectionCode`) | ✅ |
| Pré-trade | ticket → « Examiner le risque de cet ordre » | `PortfoliosService.preTradeRisk` (×2 pour la quantité alternative), `Risk` sur l'historique | ✅ aucun ordre envoyé |
| Choc de marché | « Impact d'une baisse simulée de 10 % ? » | `Risk.stressImpact` | ✅ SIMULATION |
| Vente partielle | « Et si je vendais la moitié de cette position ? » puis « Compare avant et après » | `preTradeRisk` SELL, scénario conservé dans la conversation | ✅ |
| Décision passée | « Et si je n'avais pas passé mon dernier ordre ? » | journal d'exécutions, valorisation au prix actuel | ✅ REPLAY_AT_CURRENT_MARK |
| Instrument | « Peux-tu analyser cet actif ? » | `MarketService.getInstrument/history` + `Risk` | ✅ (fictif ou historique, fraîcheur affichée) |
| Comparaison | « Compare la volatilité de A et B » | idem ×2 | ✅ |
| Crise | « Que s'est-il passé sur ce titre pendant la crise de 2020 ? » | `crisisEpisodes`, `barsBetween` | ◐ entrepôt absent ici → `NO_DATA` honnête |
| Prévision | « Pourquoi cette prévision est incertaine ? » | fiche modèle `market-return-gbm` (R², RMSE vs naïf, importance) | ✅ MODEL |
| MarketQuest | dernière décision, score, composante faible ; mission en cours = guidage sans réponse optimale selon le niveau | `LearningService.sessions/getSession/assessment` | ✅ |
| Time Machine | « Qu'aurais-je pu faire différemment ? » | `LearningService.whatIfHold` (nouveau, lecture seule) | ✅ TIME_MACHINE |
| FinStories | explication de l'épisode **terminé** + réflexion saisie | `StoriesService.feed/get` | ✅ (non terminé → pas de révélation) |
| Actuariat | « Pourquoi cette prime est-elle élevée ? » | scénario enregistré ou preset → `ActuarialService.price` (décomposition, sensibilités) | ✅ |
| Stress bancaire | « Pourquoi cette banque est-elle vulnérable ? » | `StressService.run` (Shapley exact) | ✅ (association ≠ causalité rappelée) |
| Notions | VaR, ES, HHI, CET1, prime pure… (24 entrées) | glossaire pédagogique | ✅ |
| Actualités | « Quelles actualités ? » | `NewsService.feed` (données non fiables, citées) | ✅ |
| Journal | intention → décision → bilan intention/résultat | `echo_decisions` + `RiskStudio.snapshot` | ✅ consentement requis |
| Alertes | concentration, plafond, VaR, liquidités, moins-values, intention vs exposition | règles chiffrées, déduplication | ✅ |
| Voix | lecture des réponses, alertes parlées, push-to-talk | Web Speech API | ✅ opt-in, désactivée par défaut |
| Conversation libre (LLM) | questions hors intentions | — | ✗ aucun modèle conversationnel installé |

## Seuils (constantes documentées dans le code)

Pré-trade (`EchoRiskAdvisor`) : concentration ≥ 25 % avec hausse ≥ 5 pt ; liquidités après achat < 5 % ; frais > 1 % du montant ; volatilité annualisée > 40 % ; −0,5 position effective ; plafond de ligne du portefeuille (bloquant).

Alertes (`EchoAlertService`) : plafond dépassé (CRITICAL) ; plus grande ligne ≥ 40 % (sortie < 37 %) ; VaR 95 % ≥ 5 % des capitaux (sortie < 4,5 %) ; moins-value latente ≤ −15/−25/−40 % ; liquidités disponibles < 2 % (sortie > 3 %) ; décision « diversification » suivie d'une baisse de 0,5 position effective (mémoire activée).

## Niveau d'aide

`DEBUTANT` / `INTERMEDIAIRE` / `AVANCE` : modifie le guidage pendant une mission (question réflexive / rappel des contraintes / aucun commentaire) et la profondeur des définitions. Le scoring MarketQuest reste exclusivement celui du moteur.
