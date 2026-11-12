# Legacy cleanup audit (P0)

## Active stack (verified)
- pps/api: Spring Boot / Maven (pom.xml, src/main/java) — no package.json, no Nest bootstrap on disk
- pps/web: Angular 22 — no Next.js/React dependencies in package.json
- Database: PostgreSQL; schema history retained under 	ools/db-harness/prisma/migrations as **SQL reference only**

## Removed / demoted in this pass
- pnpm-workspace.yaml, pnpm-lock.yaml (obsolete Nest-era package manager files; npm workspaces remain)
- Root script prisma:generate renamed to harness:generate (test harness only, not application runtime)

## Retained intentionally
- 	ools/db-harness: Prisma client used **only** by optional Node journey scripts against PIF_test. Not imported by Spring or Angular runtime.
- pps/api/contract/* + scripts/migration/*: optional parity/journey tooling; journeys that still call Prisma must use _test DB only.
- Official requirements PDFs and mathematical golden JSON fixtures
- Meaningful parity docs under docs/migration/ (historical evidence); rewrite status notes point to Spring/Angular as current

## Not found on disk (already gone)
- pps/api/nest-cli.json, Nest src/main.ts, Next 
ext.config.ts, React page.tsx

## External archive
- ackups/web-before-ui-redesign-*.zip: small UI backup — retain until visual redesign verified
- .tools/jdk-*: JDK tooling — retain
