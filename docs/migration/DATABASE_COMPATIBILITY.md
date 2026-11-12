# Database compatibility

## Principles (in force)

- **PostgreSQL stays unchanged.** The schema is owned by the Prisma migrations in `apps/api/prisma/migrations`. The Spring service creates, alters and drops nothing.
- **No ORM schema management.** Spring uses plain JDBC (`JdbcClient`): no JPA/Hibernate (so no `ddl-auto`), `spring.sql.init.mode=never`, and no Flyway or Liquibase. Introducing Flyway would need an explicit baseline of the existing Prisma history and your approval. It has not been done.
- **`_prisma_migrations` is read, never written.** Spring only selects from it at startup.
- **`PIF` has not been touched by the migration work.** No migration, seed, reset or test was run against it.

## Startup guards in the Spring service (`config/DatabaseStartupChecks.java`)

1. **Target guard:** the service refuses to start unless the database name ends with `_test`, or equals `PIF_SPRING_ALLOWED_DATABASE` exactly. Pointing Spring at `PIF` therefore needs a deliberate opt-in. Unit-tested in `ConfigAndGuardTest`.
2. **Schema check (read-only):** all 9 Prisma migrations the service was written against must be finished and not rolled back. Every column it reads or writes in `users`, `user_preferences`, `auth_sessions`, `auth_tokens`, `mfa_recovery_codes` and `audit_events` must exist. A mismatch stops the service instead of corrupting data.

`DATABASE_URL` uses the same `postgresql://…?schema=public` format as Prisma. It is converted in-process to JDBC settings and never logged.

## Test databases

| Database | Purpose | Prisma migrations | Used by |
| --- | --- | --- | --- |
| `PIF_spring_test` | Migration verification | All 9 applied (checked by the startup guard and `AuthDatabaseTest`) | Spring database tests, the differential contract test, browser checks (NestJS and Spring both pointed at it) |
| `PIF_test` | Existing NestJS e2e tests | as before | unchanged |
| `PIF` | Development data | unchanged | **not used by any migration tool** |

Every migration script checks the database name and refuses anything not ending in `_test`. The disposable accounts use reserved `.test` domains, one per tool so that one tool's cleanup never deletes another's accounts: `@spring-contract.test` (differential test), `@spring-db-test.test` (Java database tests) and `@spring-visual.test` (browser checks). Each tool deletes or recreates its own accounts.

## Type mapping (auth slice)

| PostgreSQL / Prisma | Java (Spring) | Verified by |
| --- | --- | --- |
| `uuid` | `java.util.UUID` | database tests; `revokeSessionsForLimit` binds a `uuid[]` |
| `timestamp(3)` without time zone, written in UTC by Prisma | `Instant` written and read as UTC whatever the JVM zone | `timestampsAreWrittenAsUtcRegardlessOfTheJvmTimeZone` (JVM run in Africa/Lagos) |
| `citext` (`users.email`) | `String`, looked up with `= ?::citext` | `RequestContractTest.loginNormalizesEmailLikeNest`; the differential run (accounts found by e-mail on both APIs) |
| `jsonb` (`audit_events.context`) | JSON text; a missing context is stored as JSON `null` like Prisma | `auditStoresJsonNullForAMissingContextAndDropsSensitiveKeys`; differential audit-row comparison |
| `bigint` (`mfa_last_accepted_step`) | `long` | `totpStepClaimsAreStrictlyMonotonic` |
| Prisma enums (`UserStatus`, `Role`, `AuthTokenType`, `AuditOutcome`) | strings cast to the enum type in SQL | database tests |
| `@updatedAt` columns | set explicitly in SQL (Prisma sets them client-side) | `preferencesUpsertKeepsUntouchedFieldsAndBumpsUpdatedAt` |

## Concurrency and shared-data behaviour

- Single-use tokens are consumed with one conditional `UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? RETURNING …`. A second consumer, from either API, gets nothing (`singleUseTokensAreConsumedExactlyOnceAndNeverAfterExpiry`).
- TOTP replay protection is a monotonic claim on `users.mfa_last_accepted_step`, so a code accepted by one API is rejected by the other. This is verified across APIs in the differential test.
- Issuing a new MFA challenge revokes the user's outstanding unused challenges, exactly like NestJS's `issueSingleUseToken` (`issuingAChallengeRevokesThePreviousUnusedOne`; differential "superseded challenge"). Refresh tokens rotate within their session; replaying a rotated one revokes the session on either API (differential `REFRESH_REUSE_DETECTED`).
- The session limit (`AUTH_MAX_SESSIONS`) revokes the oldest session and its refresh tokens, and writes `SESSION_LIMIT_REVOKED` to the audit log.

## Known differences

| Item | Detail |
| --- | --- |
| `GET /auth/me/preferences` with no preferences row | Both create the row. NestJS's Prisma upsert with an empty update also bumps `updated_at`; Spring's insert-if-missing does not. No reader depends on it |
| Financial and actuarial tables | Not read or written by Spring yet |

## Before any shared-database use

Running Spring against `PIF` (or production) requires:
1. your explicit approval;
2. setting `PIF_SPRING_ALLOWED_DATABASE`;
3. a routing rule that sends each path to exactly one backend, so no command is processed twice (see [CUTOVER_AND_ROLLBACK.md](CUTOVER_AND_ROLLBACK.md)). No dual writes are enabled anywhere.
