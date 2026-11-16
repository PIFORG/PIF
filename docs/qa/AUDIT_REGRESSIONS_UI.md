# AUDIT_REGRESSIONS_UI

## Cause racine (refonte dual-layout)
| Fonctionnalité | Avant | Après | Cause | Correctif |
|---|---|---|---|---|
| FinStories narration | Voix FR via speechSynthesis | Semblait muette | muted par défaut + Chrome cancel/speak | unmute au geste + watchdog + CTA |
| Navbar investisseur | Sidebar | Navbar OK (validée) | — | Préservée |
| Admin | AppShell imbriqué | Sidebar seule | AdminLayout sans AppShell | Préservé |
| Menus déroulants | z-index 50 | Risque sous graphiques | z-index | z-index 80 |
| Mode clair | Gris bleuté | Template-like | Tokens froids | Tokens crème neutre / marine |

## Non régression
- Séparation INVESTOR navbar / ADMIN sidebar conservée
- PIF non modifiée