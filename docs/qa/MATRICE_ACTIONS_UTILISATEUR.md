# MATRICE_ACTIONS_UTILISATEUR

Date: 2026-11-15

## Inventaire code (handlers declares)
| Type | Nombre |
|---|---|
| `(click)=` | 126 |
| `routerLink=` | 77 |
| **Total inventorie** | **203** |

## Testes dans cette session (effet reel verifie)
| Route / zone | Element | Attendu | Resultat |
|---|---|---|---|
| /stories | Ouvrir episode Sarah | Viewer + unlock narration | OK navigateur |
| /stories | Pause / Lecture | pause/resume speech | OK CDP |
| /stories | Fermer | stop speech | OK CDP |
| /stories | Selecteur voix FR | Hortense/Julie/Paul | OK |
| Navbar | Menus Marchés/Négociation/Analyses/Apprentissage | dropdown (session precedente) | OK conserve |
| Bandeaux | Pause cotations / news | toggle pause | Present UI |
| Theme | Toggle clair/sombre | data-theme | Present UI |
| Profile | Menu compte | liens settings/admin | Present UI |

## Actions critiques encore a valider E2E bout-en-bout
- Ticket d ordre (BUY/SELL submit + API)
- Portefeuilles create/deposit
- Backtesting run
- IA prediction + XAI
- Actuariat pricing/MC/reserving/capital/ALM
- Stress bancaire calculs
- MarketQuest mission complete
- Admin users/audit mutations

**Inventoriees : 203 · Testees (effet reel cette session) : 8 · A retester exhaustivement : reste**