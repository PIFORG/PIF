# VALIDATION_ROUTES_E2E

Date: 2026-11-15

## Routes applicatives (app.routes.ts)
Auth: login, register, verify-email, resend-verification, forgot-password, reset-password, confirm-email-change, unauthorized
Public: /
Investisseur: dashboard, markets, trading, portfolios, risk, backtesting, strategies, learn (+missions/sessions), stories, actuarial (+pricing/monte-carlo/reserving/capital/alm), stress-testing, ai, explainability, challenges, settings/*
Admin: /admin, platform, users, users/:id, audit

## Verifiees navigateur cette session
| Route | Role | Chargement | FR | Resultat |
|---|---|---|---|---|
| /stories | INVESTOR/ADMIN | OK | OK | Narration pause/resume OK |
| /dashboard | (ouvert en onglet) | OK | OK | Shell + bandeaux |

## Verifiees session precedente (conservees)
dashboard, markets, trading, portfolios, risk, ai, stories (nav)

## Non rejouees E2E complet cette session
Parcours trading→portefeuille, mission→review, IA→XAI, actuariat, banque, admin mutations, matrices 375/768/1024/1440

Verdict routes : **partiel**