# ÉCHO — Sécurité

| Exigence | Mise en œuvre | Preuve |
|---|---|---|
| Rôle INVESTOR | `@Roles("INVESTOR")` sur `EchoController` (intercepteur existant) | contrôleur |
| Isolation conversations / décisions / alertes | toutes les requêtes SQL filtrent `user_id = ?` ; un id étranger renvoie 404 (pas d'oracle) | `EchoDatabaseTest.usersAreIsolated`, E2E P11 |
| Isolation portefeuilles / missions | ÉCHO passe l'`AuthUser` aux services métier, qui vérifient la propriété ; un `portfolioId` de contexte étranger est ignoré | `usersAreIsolated` (contexte d'Alice ignoré pour Bob) |
| Contexte navigateur ≠ autorisation | `ClientContext` : identifiants re-validés côté serveur, symbole filtré par regex, champs tronqués | `EchoConversationService.ClientContext` |
| Pas d'ordre autonome | aucun outil d'écriture dans `EchoFinancialTools.ALLOWLIST` ; les demandes impératives (« achète 10 … ») sont refusées | `preTradeFlagsConcentrationAndNeverPlacesAnOrder` (nombre d'ordres inchangé), E2E P4 |
| Outils en allowlist | 26 outils nommés, lecture seule, arguments bornés (plages d'historique 1M/3M/6M, ≤ 20 ordres, ≤ 50 exécutions, ≤ 5 portefeuilles pour les alertes) | `EchoFinancialTools` |
| Pas de SQL / HTTP arbitraire | aucun outil générique ; aucune entrée utilisateur concaténée dans du SQL | revue de code |
| Injection de prompt | moteur déterministe : aucun texte (question, actualité) n'est interprété comme instruction ; actualités affichées comme `OBSERVED` citées ; demandes visant d'autres utilisateurs, secrets, mots de passe, SQL, « ignore les instructions » → `REFUSED` | `usersAreIsolated` (leak), E2E P3 |
| Limitation de débit | `@Throttle` 60/min (30/min pour `ask` et `pretrade`), alertes throttlées 30 s | contrôleur, `EchoAlertService` |
| Données envoyées à l'extérieur | aucune : pas de fournisseur externe ; la reconnaissance vocale est celle du navigateur (Chrome peut l'exécuter sur ses serveurs — mentionné à l'utilisateur, déclenchement manuel uniquement) | `EchoVoiceService` |
| Secrets / mots de passe / jetons | jamais stockés ; messages limités à 1 000 caractères (8 000 en base) | migration |
| Mémoire transparente | désactivée par défaut, consultation, correction (`PATCH`), suppression unitaire et totale, rétention bornée | `memoryRequiresConsentAndReviewIsGrounded`, E2E P5 |
| Suppression utilisateur | `ON DELETE CASCADE` sur `users` pour toutes les tables `echo_*` | migration |
| Micro | push-to-talk, une seule phrase, `continuous=false`, indicateur visible, transcription affichée **sans envoi automatique** | `EchoVoiceService.listenOnce`, panneau |
