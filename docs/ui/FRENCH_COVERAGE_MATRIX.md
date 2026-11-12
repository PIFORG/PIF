# French coverage matrix (routes)

Generated from `apps/web/src/app/app.routes.ts`. Status is presentation-language readiness for the francophone product UI.

Legend:

- **FR** — primary user-facing chrome and copy are French (or FR overlay for catalog content).
- **Partial** — mixed FR/EN; English remains in some panels, mentor/engine strings, or labels.
- **EN** — still predominantly English user-facing copy.
- Product names **MarketQuest** and **FinStories** stay as-is by design.

| Route | FR status | Notes |
| --- | --- | --- |
| `/login` | FR | Auth pages + `core/i18n/fr.ts` |
| `/register` | FR | |
| `/verify-email` | FR | |
| `/resend-verification` | FR | |
| `/forgot-password` | FR | |
| `/reset-password` | FR | |
| `/confirm-email-change` | FR | |
| `/unauthorized` | FR | |
| `/` (landing) | FR | Marketing landing |
| `/admin` | FR | Admin shell / overview |
| `/admin/users` | FR | |
| `/admin/users/:id` | FR | |
| `/admin/audit` | FR | |
| `/dashboard` | FR | Workspace overview |
| `/markets` | FR | Trading markets |
| `/trading` | FR | Trading desk |
| `/portfolios` | FR | |
| `/risk` | FR | Risk analytics page chrome |
| `/backtesting` | FR | |
| `/learn` | Partial | Hub chrome still has English spots; mission titles/summaries via `learning_fr.properties` + `LearningFr` |
| `/learn/missions/:slug` | Partial | Briefing title/summary/context FR; rules/tips/objectives/events keys added in `learning_fr.properties` (wire remaining fields in views as needed) |
| `/learn/sessions/:id` | Partial | Player chrome / mentor / dynamic objective details often still EN |
| `/learn/sessions/:id/review` | Partial | Time Machine UI labels still partly EN; compare note key present in `learning_fr.properties` |
| `/stories` | Partial | FinStories titles/summaries/scene captions FR via `LearningFr`; player chrome / TTS note: audio remains English |
| `/actuarial` | Partial | Overview mixed; some studio panels still EN |
| `/actuarial/pricing` | Partial | |
| `/actuarial/monte-carlo` | Partial | |
| `/actuarial/reserving` | Partial | |
| `/ai` | Partial | Preview module |
| `/challenges` | Partial | Preview module |
| `/explainability` | Partial | Preview module |
| `/strategies` | Partial | Preview module |
| `/stress-testing` | Partial | Preview module |
| `/settings/profile` | FR | |
| `/settings/security` | FR | |
| `/settings/sessions` | FR | |
| `**` (public not migrated) | Partial | Fallback |

## Overlay sources (no main PIF DB migration)

| Surface | Source of truth (IDs) | French display |
| --- | --- | --- |
| MarketQuest missions | `MissionCatalog` (stable slugs/ids) | `learning_fr.properties` via `LearningFr` |
| FinStories | `StoryCatalog` (stable slug/sceneId) | `learning_fr.properties` via `LearningFr` |
| API validation / auth errors | codes English | `messages.properties` / `messages_fr.properties` |
| Emails | `EmailTemplates.java` | Already French copy |

## Remaining English (expected)

- Rule-based mentor prose and assessment detail strings in the learning engine
- Simulator rejection messages
- Some Angular learning/stories/Time Machine chrome until templates are fully localized
- Browser TTS narration language (`en-US`) — mark honestly as English audio