# Harness base de données PIF (crypto)

Utilitaires pour scripts de parcours et tests. **Pas de Prisma Client au runtime applicatif.**

| Élément | Rôle |
| --- | --- |
| `crypto/` | Helpers Argon2id et AES-GCM alignés sur Spring Boot |
| `prisma/` | Archive SQL historique des migrations (référence de schéma uniquement) |

```bash
cd tools/db-harness
npm install
```

Depuis la racine : `npm run harness:generate` (si exposé pour régénérer des artefacts de harness — hors API Angular/Spring).

Définir `DATABASE_URL` uniquement vers des bases isolées `*_test` lorsque des fixtures SQL sont nécessaires. **Jamais** vers la base principale `PIF` pour des opérations destructives.
