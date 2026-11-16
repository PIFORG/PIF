# VALIDATION_AUDIO_FINSTORIES

Date: 2026-11-15 (session stabilisation)

## Moteur
- Service central `StoryNarrationService` (`idle|loading|ready|speaking|paused|completed|error|unsupported`)
- Lecteur (`story-player`) et feed (`story-feed`) branchés dessus
- `speechSynthesis` navigateur uniquement (pas d API TTS payante)
- Voix FR via `getVoices()` + repli hors Hortense/Julie/Paul

## Correctifs de cette session
1. Unlock au clic d ouverture + CTA « Activer la narration »
2. `speak()` différé 50 ms apres `cancel`
3. Watchdog `resume` si moteur reste en `paused`
4. Pause lecteur = `speechSynthesis.pause` ; reprise = `resume` (meme scene)
5. Changement de scene / mute / fermeture = `stop` + invalidation token
6. `spokenSceneId` empeche un resume apres jump pendant pause
7. Destroy Angular = `narration.stop()`

## Preuves unitaires
- `story-narration.service.spec.ts` : unlock, loading→speaking→completed, stop, supersede, pause/resume, empty text
- `story-player.component.spec.ts` + `story-feed.page.spec.ts` : OK
- Suite Angular complete : **323 tests / 45 fichiers** (exit 0)

## Preuves navigateur (localhost:4200/stories)
- Voix presentes : Hortense, Julie, Paul (fr-FR)
- Ouverture Sarah au clic → bouton « Couper la narration » (unmuted)
- CDP lecture : `speaking:true`, `paused:false`, caption FR affichee
- Pause UI → `speaking:true` + `paused:true`
- Reprise UI → `speaking:true` + `paused:false`
- Fermeture viewer → synthèse arretee
- Capture : `docs/refonte-proofs/08-finstories-narration-service.png`

## Limites honnetes
- Audibilite acoustique OS/peripherique : non mesuree par l agent (pas de micro/analyseur audio).
- `speaking===true` reste un signal moteur ; la preuve complete combine evenements + UI + pause/resume + arret a la fermeture.
- Overlay decision « A ou B » encore densement superpose visuellement (defaut design scene, hors moteur audio).