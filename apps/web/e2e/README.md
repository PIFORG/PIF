# E2E auth artifacts

Generated locally by `npm run e2e:provision` into `apps/web/e2e/.auth/` (gitignored):

- `credentials.local.json` — emails/passwords for INVESTOR_E2E and ADMIN_E2E
- `investor.storage.json` / `admin.storage.json` — Playwright storageState

Never commit those files. Provisioning refuses any database that does not end with `_test`.