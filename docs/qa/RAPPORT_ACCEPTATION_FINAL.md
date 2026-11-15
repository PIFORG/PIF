# RAPPORT_ACCEPTATION_FINAL — recovery 2026-11-15

## Verdict
**INCOMPLET — RÉGRESSIONS OU VALIDATIONS RESTANTES IDENTIFIÉES.**

## Réponses clés
1. Cassé: narration FinStories perçue muette; menus z-index; light trop « template »
2. Cause: muted défaut + Chromium speech; styles/layout
3. Boutons: mute/CTA narration + menus z-index
4. Actions: matrice P0 partielle (pas inventaire 100 %)
5. Voix FinStories: **restaurées** — `speechSynthesis.speaking=true` prouvé
6. Moteur: Web Speech API FR
7. Transitions: cancel + speak différé; watchdog resume
8. MarketQuest 10 missions: non rejouées E2E cette session
9. Light: tokens humanisés (canvas neutre, marine)
10–12. Écrans: shell + stories; dark inchangé structurellement
13. Routes testées navigateur: ~7+ smoke, pas 40
14–16. INVESTOR/ADMIN layouts OK; responsive partiel
17. FR: conservé
18. Angular: **312/312**
19. Spring: **3891/3891** (Failures=0 Errors=0)
20. FinStories unit: **25/25**
21. Moteurs financiers: non réécrits
22. **PIF inchangée**
23. Restant: inventaire boutons exhaustif, E2E MarketQuest/actuariat/banque, polish modules, captures avant/après complètes