# ÉCHO — Architecture

ÉCHO est intégré à l'architecture existante : **Angular (`apps/web`) + Spring Boot (`apps/api`) + PostgreSQL**. Aucun backend parallèle, aucune dépendance nouvelle (ni Maven, ni npm).

## Principe

> ÉCHO orchestre les moteurs existants ; il ne les remplace pas.

```
Angular                                   Spring Boot (com.pif.api.echo)                 Moteurs existants
───────                                   ─────────────────────────────                  ─────────────────
EchoContextService (route, module,  ──►   EchoController  (/echo/*, @Roles INVESTOR)
 symbole, portefeuille, ordre, session)    │
EchoPanelComponent (lanceur + panneau)     ├─ EchoConversationService  validation, contexte autorisé,
EchoAnswerComponent (réponse typée)        │    routage d'intention, mémoire de travail bornée
EchoVoiceService (TTS + push-to-talk)      ├─ EchoIntentRouter     règles françaises déterministes
                                           ├─ EchoFinancialTools   allowlist d'outils LECTURE SEULE ──►  PortfoliosService, MarketService,
                                           ├─ EchoRiskAdvisor      pré-trade                              AiService, LearningService,
                                           ├─ EchoScenarioService  « et si… »                              StoriesService, ActuarialService,
                                           ├─ EchoMemoryService    préférences + journal                  StressService, NewsService,
                                           ├─ EchoAlertService     alertes vérifiables                    RiskStudio, Risk, Valuation
                                           └─ EchoRepository       JDBC (5 tables echo_*)
```

## Stratégie d'inférence (décision)

Audit du 2026-11-20 : **aucun modèle conversationnel n'est installé** (pas d'Ollama, pas de Spring AI, pas de clé fournisseur). Les modèles existants sont des régresseurs (GBM, linéaire) sur série synthétique, un lexique de sentiment et un agent à règles.

Décision : ÉCHO utilise
1. un **routeur d'intentions français déterministe** (`EchoIntentRouter`, 24 intentions, règles ordonnées et testées, extraction d'entités : symboles, pourcentages, fractions, années) ;
2. le **contexte de page** pour lever l'ambiguïté (jamais un choix arbitraire de portefeuille/mission : clarification sinon) ;
3. des **outils typés** qui appellent les services métier existants ;
4. des **réponses structurées** construites à partir des seuls résultats de ces outils.

Conséquence assumée : ÉCHO ne comprend pas les questions très libres hors de ses intentions ; il le dit (`status: CLARIFICATION`) et propose des questions. Le champ `engine` (`echo-deterministic-v1`) et `GET /echo/capabilities` l'exposent honnêtement. Brancher plus tard un LLM local consisterait à remplacer `EchoIntentRouter.parse` par un classifieur/planificateur produisant le même `Parsed`, sans toucher aux outils ni aux contrôles.

## Contrat de réponse

`EchoAnswer.toJson()` : `intent`, `status` (COMPLETE/PARTIAL/NO_DATA/CLARIFICATION/REFUSED/ERROR), `answer`, `speech`, `context`, `evidence[]` (chaque valeur porte son `kind` : OBSERVED, CALCULATED, MODEL, ASSUMPTION, SIMULATION, INTERPRETATION + `source`), `dataAsOf`, `riskFlags[]` (code, gravité, base chiffrée), `suggestedActions[]` (ASK / NAVIGATE — jamais d'action métier), `visualization` (uniquement à partir de ≥ 2 points serveur), `scenario` (`hypothetical: true` pour toute simulation), `clarification`, `limitations[]`, `sources[]`, `toolsUsed[]`, `engine`. Aucun score de confiance n'est inventé.

## Mémoire

- **Travail** : `echo_conversations.state` (portefeuille, symbole, symboles récents, dernier scénario) — bornée, rechargée par tour ; les chiffres sont toujours relus dans les tables métier.
- **Historique** : `echo_messages` (60 derniers messages renvoyés ; 30 conversations max par utilisateur).
- **Décisions** : `echo_decisions`, uniquement si `memory_enabled`, 200 entrées max, snapshot de concentration au moment de la décision (via `RiskStudio.snapshot`).

## Événementiel

Pas de nouvelle infrastructure : l'unique flux SSE existant (`RoomEventHub`) est propre aux salles de marché. Les alertes sont évaluées à la demande (`GET /echo/alerts`, throttle 30 s/utilisateur) et interrogées par le panneau toutes les 60 s.

## Modification d'un module existant

Un seul ajout hors du paquet `echo` côté serveur : `LearningService.whatIfHold(...)`, rejeu HOLD **en mémoire** de la Machine à remonter le temps (réutilise `TimeMachine.branchCommands/play`, ne persiste rien, n'ajoute aucune commande, ne modifie pas le score). `LearningService.mentor()` n'est jamais appelé par ÉCHO car il enregistre un `REQUEST_HINT` qui affecte l'évaluation.
