# ATLAS DES INTERFACES — Market Trading Room

Date: 2026-11-19 (recomptage routes + audit moteur)
Source: `apps/web/src/app/app.routes.ts`
**Total: 44 path entries** (43 `path:` hors `**` + catch-all `**` ; ~37 écrans feuille hors wrappers `path: ''`)
Moteur trading: quote-driven — voir `docs/project/AUDIT_MOTEUR_CARNET_ORDRES.md`
Admin plateforme: **supervision lecture** (GET) ; écritures comptes via `/admin/users`

États: `NON_ANALYSEE` | `ANALYSEE` | `EN_REFONTE` | `REFONDUE_NON_VERIFIEE` | `VERIFIEE` | `BLOQUEE`

| Route | Titre utilisateur | Concept | Preuves | Tests | État |
|---|---|---|---|---|---|
| /login | Connexion | Shell éditorial | 14-* | auth | VERIFIEE |
| /register … | Inscription / auth | Shell éditorial | partiel | auth | REFONDUE_NON_VERIFIEE |
| /unauthorized | Accès refusé | CTAs | 15 | — | VERIFIEE (partiel) |
| /** | Introuvable | 404 | 16 | — | VERIFIEE (partiel) |
| / | Accueil | Hero marque | 17 | landing | REFONDUE_NON_VERIFIEE |
| /dashboard | Vue d'ensemble | Cockpit | 18 | dashboard | VERIFIEE (partiel) |
| /markets | Cotations | Board terminal | 21-* | trading | VERIFIEE (partiel) |
| /trading | Salle des marchés | Desk | inspecté | trading | VERIFIEE (partiel) |
| /portfolios | Portefeuilles | Wealth board | 22 | trading | VERIFIEE (partiel) |
| /risk | Analyser les risques | Lab risque | 24 | risk | REFONDUE_NON_VERIFIEE |
| /backtesting | Tester une stratégie | Lab backtest | 23 | backtest | VERIFIEE (partiel) |
| /strategies | Catalogue de stratégies | Catalogue | — | — | REFONDUE_NON_VERIFIEE |
| /learn | Mon parcours | Hub missions | hub | learning | VERIFIEE (partiel) |
| /learn/missions/:slug | Briefing de mission | Action-first | 25 | learning | REFONDUE_NON_VERIFIEE |
| /learn/sessions/:id | Session de mission | Cockpit | 26 | learning | REFONDUE_NON_VERIFIEE |
| /learn/sessions/:id/review | Bilan / time machine | Fork | 27 | learning | REFONDUE_NON_VERIFIEE |
| /stories | Histoires financières | Lecteur | 28 | stories | REFONDUE_NON_VERIFIEE |
| /actuarial | Assurance et actuariat | Hub outils | — | — | REFONDUE_NON_VERIFIEE |
| /actuarial/pricing | Calculer une prime | Studio | — | — | REFONDUE_NON_VERIFIEE |
| /actuarial/monte-carlo | Simuler les pertes | Lab MC | — | — | REFONDUE_NON_VERIFIEE |
| /actuarial/reserving | Estimer les provisions | Triangles | — | — | REFONDUE_NON_VERIFIEE |
| /actuarial/capital | Capital économique | Capital | — | — | REFONDUE_NON_VERIFIEE |
| /actuarial/alm | Gestion actif-passif | ALM | — | — | REFONDUE_NON_VERIFIEE |
| /stress-testing | Simuler une crise bancaire | Lab + pipeline | — | stress | REFONDUE_NON_VERIFIEE |
| /ai | Prévisions de marché | Workbench synthétique | 20 | — | REFONDUE_NON_VERIFIEE |
| /explainability | Comprendre les prévisions | Desk Shapley pédagogique | — | — | REFONDUE_NON_VERIFIEE |
| /challenges | Défis boursiers | Arène | — | — | REFONDUE_NON_VERIFIEE |
| /settings/* | Paramètres | Desk compte | — | — | REFONDUE_NON_VERIFIEE |
| /admin | Tableau de bord | Sidebar admin | — | admin | EN_REFONTE |
| /admin/users(+/:id) | Utilisateurs | Gestion | — | admin | EN_REFONTE |
| /admin/platform | Supervision des services | Supervision | — | — | EN_REFONTE |
| /admin/audit | Journal d'activité | Audit | — | — | EN_REFONTE |
| redirects / previews | Divers | — | — | — | ANALYSEE |

## Clarifications produit (cette session)
Routes API/techniques **conservées**. Seuls les **libellés utilisateur** et la hiérarchie nav ont été clarifiés.

## PostgreSQL
Voir `docs/project/READINESS_POSTGRESQL_PIF.md` — **`PIF` inchangée**.

## Verdict
**INCOMPLET — EXIGENCES, ROUTES, TESTS OU PRÉPARATIFS DE MIGRATION RESTANTS IDENTIFIÉS.**
