# Market Trading Room Simulator

Market trading room simulation platform. This repository currently delivers the **User Identity, Authentication, Authorization, Profile, Sessions, MFA, Security and Administration** foundation that future portfolio, trading, risk, learning, AI and stress-testing modules will attach to.

## Stack

- **API:** NestJS + TypeScript + Prisma + PostgreSQL
- **Web:** Next.js (App Router) + React + TypeScript
- **Security:** Argon2id, short-lived JWT access tokens, rotating opaque refresh cookies, TOTP MFA, audit events
- **Local mail:** Mailpit

## Quick start

```bash
docker compose up -d postgres mailpit
cp .env.example apps/api/.env
# Edit apps/api/.env — replace placeholder secrets with long random values
cp .env.example apps/web/.env.local   # or set NEXT_PUBLIC_* only

npm install
npm run prisma:generate
npm run prisma:migrate:dev -w @mtrs/api

# Optional secure admin bootstrap (set ADMIN_BOOTSTRAP_* in apps/api/.env first)
npm run seed:admin -w @mtrs/api

npm run dev:api   # http://localhost:3001/api
npm run dev:web   # http://localhost:3000
```

Mailpit UI: http://localhost:8025

## Documentation

- [Implementation plan](docs/identity-implementation-plan.md)
- [Requirements matrix](docs/identity-requirements-matrix.md)
- [Security decisions](docs/identity-security-decisions.md)
- [API contract samples](docs/identity-api-contract.md)

## Tests

```bash
npm run test -w @mtrs/api
npm run test:e2e -w @mtrs/api
```

## Security notes

- Never commit real secrets; use `.env.example` names only.
- Refresh tokens are opaque HttpOnly cookies — not JWTs and not stored in `localStorage`.
- Public registration cannot assign `ADMIN`.
