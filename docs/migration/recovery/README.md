# Legacy NestJS / Next.js recovery

The full NestJS + Next.js source is **not** kept inside the active repository after Gate M.

## External archive (authoritative)

**Path:** `C:\Users\housi\Archives\PIF-legacy-recovery-20261112\`

| Artifact | Notes |
| --- | --- |
| `legacy-nest-next-20261112-004826.zip` | 376 entries, ~0.71 MB, **no `.env` secrets** |
| SHA256 | `DAE53975DE25B89A4C41DBC72BAD54A3887B8217DA93BC243873327C5EA7A06A` |
| `extract-verify/` | Proof the ZIP expands to `api/` + `web/` |
| `live-tree-snapshot/` | Full Nest/Next (+ Spring/Angular safety copy) at Gate M time |
| `removed-from-active-tree/api` | NestJS tree removed from the repo |
| `removed-from-active-tree/web` | Next.js tree removed from the repo |
| `MANIFEST.md` | Recovery instructions |

Restore (offline): copy archived `api` → `apps/api` and `web` → `apps/web` only if you intentionally need the legacy reference; restore `.env` from your secrets store; `npm install`.

Prisma schema/migrations for the existing PostgreSQL history remain as **reference** under `tools/db-harness/prisma/` (test harness only; not a Nest runtime).

Production database `PIF` was never written by Spring migration tests (`PIF_spring_test` only).
