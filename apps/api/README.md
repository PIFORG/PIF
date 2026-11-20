# API PIF — Spring Boot

Backend canonique de **PIF MarketLab** (Market Trading Room).  
**Java 25** · **Spring Boot 4.1.2** · JDBC · PostgreSQL.

## Rôle

Expose l’API HTTP sous le préfixe `/api` : authentification, marchés, portefeuilles, MarketQuest, FinStories, actuariat, administration. Aucun NestJS au runtime.

## Configuration

```bash
copy .env.example .env
# renseigner DATABASE_URL, secrets JWT / MFA, CORS_ORIGINS
```

Fichier chargé : `apps/api/.env` (pas le `.env` racine du monorepo).

Port par défaut : **3002** (`SPRING_API_PORT`).

En environnement autre que `production`, le démarrage crée le compte de test `test@gmail.com` / `Test123456`
s'il n'existe pas déjà. Il est inséré comme utilisateur `INVESTOR` actif et vérifié, puis la connexion passe par
le flux normal (mot de passe BCrypt, session et JWT). Un compte préexistant avec cette adresse n'est jamais modifié.
Le seed est désactivé lorsque `NODE_ENV=production`. Les nouvelles inscriptions conservent leur hash Argon2id.

## Démarrage

Depuis la racine du dépôt :

```bash
npm run dev:api
```

Ou dans ce dossier :

```bash
.\mvnw.cmd -DskipTests spring-boot:run
# Unix : ./mvnw -DskipTests spring-boot:run
```

Après build :

```bash
.\mvnw.cmd -DskipTests package
java -jar target\pif-api-spring-0.1.0-SNAPSHOT.jar
```

| Ressource | URL |
| --- | --- |
| Santé | http://localhost:3002/api/health |
| OpenAPI UI | http://localhost:3002/api/docs |
| OpenAPI JSON | http://localhost:3002/api/docs-json |

## Tests

```bash
.\mvnw.cmd -B -P database-tests test
# depuis la racine : npm run test:api
```

Utiliser une base PostgreSQL de test (`*_test`). **Ne pas** pointer les suites destructives vers la base principale `PIF`.

Les contrats / parcours sous `contract/` et `scripts/migration/` peuvent s’appuyer sur `tools/db-harness` (crypto / SQL de référence) — hors runtime applicatif.
