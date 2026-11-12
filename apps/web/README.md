# Interface web PIF — Angular

Frontend canonique de **PIF MarketLab** (Market Trading Room).  
**Angular 22.2** · TypeScript ~6.0 · interface en **français**.

## Rôle

Application workspace : tableau de bord, marchés, salle des marchés, portefeuilles, MarketQuest, FinStories, laboratoire actuariel, paramètres et administration. Communique exclusivement avec l’API Spring Boot.

## Configuration

URL de l’API en développement : `src/environments/environment.ts`

```ts
apiUrl: 'http://localhost:3002/api'
```

En production : `environment.production.ts` utilise le chemin relatif `/api`.

## Démarrage

Depuis la racine du dépôt :

```bash
npm run dev:web
```

Ou dans ce dossier / workspace :

```bash
npm start
# http://localhost:4200
```

Prérequis : API joignable et `CORS_ORIGINS` incluant `http://localhost:4200`.

## Scripts

| Commande | Description |
| --- | --- |
| `npm start` | Serveur de développement (`ng serve`) |
| `npm test` | Tests unitaires (`ng test --watch=false`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc` app + specs |
| `npm run build` | Build de production |
| `npm run serve:host` | Hébergement statique + reverse-proxy `/api` |

Depuis la racine : `npm run build:web`, `npm run test:web`, `npm run lint`, `npm run typecheck`.

## Notes

- Aucun Next.js / React au runtime.
- Le nom produit affiché est **Market Trading Room** ; le reste de l’UX est en français.
