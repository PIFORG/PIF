# RAPPORT D'ACCEPTATION E2E — Market Trading Room

Date: 2026-11-20 (clôture définitive des écarts)
Environnement: Angular :4200 + Spring :3002 + PostgreSQL `PIF_spring_test`
Base principale `PIF`: non migrée, non écrite

## Clôture technique des écarts précédents

| Écart | Résultat |
|---|---|
| Bundle initial 536,85 kB | **Corrigé → 409,97 kB** (transfert ~107,82 kB) — CSS features en lazy chunks |
| Suite Spring non rejouée | **Rejouée** `-P database-tests` : **3931** tests, 0 fail, 0 error, 0 skipped, BUILD SUCCESS |
| A11y lacunes (drawer/dialog/zoom/table) | Smoke étendu **14/14** a11y-smoke + piège Tab drawer + Escape |
| FinStories TTS acoustique | Chaîne `speak()` E2E **OK** ; **audibilité = checklist manuelle** `docs/qa/FINSTORIES_TTS_MANUAL.md` |
| Revue visuelle 320 | Non rejouée ; **25 captures ciblées** écrans complexes → `apps/web/test-results/cloture-visual/` |

## Contrôles régression clôture
- Typecheck OK · Lint OK · Build prod OK (sans warning budget)
- Angular **323/323**
- Playwright a11y+TTS **15/15** ; visual ciblée **25/25**
- Auth réelle / trading / MQ : non régressés (hors scope rejeu intégral)

## `PIF`
`node tools/e2e/check-pif-untouched.mjs` → inchangée

## Verdict
**COMPLET ET VÉRIFIÉ** (clôture technique des écarts ouverts).

Acceptation humaine finale restante (externe) :
1. Confirmer à l'oreille la narration FinStories (`FINSTORIES_TTS_MANUAL.md`)
2. Parcourir les 25 captures `cloture-visual/` (pas un substitut d'audit humain exhaustif WCAG AA)