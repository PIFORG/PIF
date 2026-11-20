# ÉCHO — Préparation au déploiement

## Base de données

Migration additive : `tools/db-harness/prisma/migrations/20261121090000_echo_assistant/migration.sql`
(5 tables `echo_*`, `CREATE … IF NOT EXISTS`, aucune table existante modifiée, cascade sur `users`).

| Environnement | Statut |
|---|---|
| `pif_test` (Docker, machine de développement) | **appliquée** le 2026-11-20, index et contraintes vérifiés |
| `PIF_spring_test` | à appliquer sur la machine qui l'héberge (procédure ci-dessous) |
| `PIF` (principale) | **non appliquée — autorisation explicite requise** |

Procédure (environnement isolé) :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f tools/db-harness/prisma/migrations/20261121090000_echo_assistant/migration.sql
psql "$DATABASE_URL" -c "\dt echo_*"
```

Procédure future pour `PIF` : sauvegarde (`pg_dump -Fc`), application dans une transaction (`psql -1`), vérification `\dt echo_*`, puis redémarrage de l'API. Retour arrière : `DROP TABLE echo_alerts, echo_decisions, echo_messages, echo_conversations, echo_preferences;` (aucune autre table n'en dépend).

Sans migration, l'API démarre normalement ; les routes `/echo/*` répondent `503 ECHO_NOT_MIGRATED` et le panneau affiche l'indisponibilité.

## Application

- Aucune nouvelle dépendance Maven ni npm, aucune variable d'environnement, aucun service externe.
- L'API doit être **redémarrée** pour exposer `/api/echo/*`.
- Navigateurs : synthèse vocale (Chrome, Edge, Firefox, Safari) ; dictée uniquement si `SpeechRecognition` est disponible (Chrome/Edge) — sinon le bouton micro n'apparaît pas.

## Limites connues

- Pas de modèle conversationnel : compréhension limitée aux 24 intentions.
- Pas d'historique de VaR : « pourquoi mon risque a augmenté » s'appuie sur la composition actuelle et les dernières opérations.
- Alertes évaluées à la consultation (polling 60 s du panneau), pas en tâche de fond serveur.
- Analyse de crise dépendante de l'entrepôt historique (absent sur la machine de développement actuelle).
- Les contextes Actuariat / Stress utilisent le dernier scénario **enregistré** (ou le preset de référence), pas les valeurs non enregistrées du formulaire affiché.
