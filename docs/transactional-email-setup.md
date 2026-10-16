# Transactional email setup

Two transports, chosen by `MAIL_TRANSPORT` in `apps/api/.env`:

| Mode | What happens | Where allowed |
|---|---|---|
| `preview` | The full RFC 5322 message is rendered by Nodemailer and written to `MAIL_PREVIEW_DIR` (default `apps/api/.mail-preview/`) as `.eml`, `.html`, `.txt` and `.json`. Nothing leaves the machine. | development and test only; refused at boot when `NODE_ENV=production` |
| `smtp` (default when unset) | Delivered through the configured SMTP relay with TLS, timeouts and bounded retries. | everywhere; required in production |

## 1. Local preview (no Docker, no account needed)

1. In `apps/api/.env` set `MAIL_TRANSPORT=preview` (already set in this workspace).
2. Start the API (`npm run dev:api`). The log shows: `Mail transport: PREVIEW - messages are written to …\apps\api\.mail-preview and are NOT delivered.`
3. Start the inbox viewer: `npm run mail:inbox`, then open <http://127.0.0.1:3025>.
4. Register at <http://localhost:3000/register> with any address (for example `you+demo@example.test`). The message appears at the top of the inbox. Click it, then click **Confirm email address** in the rendered email (it opens in a new tab), and press **Confirm email verification** on the page.

The viewer:

- binds to `127.0.0.1` only;
- rejects other peers and any `Host` header other than `127.0.0.1:3025` / `localhost:3025` (DNS-rebinding protection);
- accepts `GET` only and validates message ids (no path traversal);
- renders message HTML in a sandboxed frame (`Content-Security-Policy: sandbox`, no scripts) with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`;
- refuses to start when `NODE_ENV=production`.

`.mail-preview/` is git-ignored and outside any public web root. It contains live single-use links, so treat it like a local inbox. The newest 200 messages are kept.

The DB e2e suites force preview mode into a temporary folder, so tests never send real mail or write into your inbox.

## 2. Real SMTP delivery

Any SMTP provider works (Brevo, Mailgun, SendGrid, Postmark, Amazon SES, Microsoft 365, Google Workspace SMTP relay …). In `apps/api/.env`:

```
MAIL_TRANSPORT=smtp
SMTP_HOST=<provider SMTP host>
SMTP_PORT=587            # STARTTLS (use 465 with SMTP_SECURE=true for implicit TLS)
SMTP_SECURE=false
SMTP_USER=<provider SMTP username>
SMTP_PASS=<provider SMTP password or API key>
EMAIL_FROM="Market Trading Room Simulator <no-reply@your-verified-domain>"
# optional
MAIL_REPLY_TO=support@your-verified-domain
EMAIL_SUPPORT_URL=https://your-verified-domain/help
SMTP_REQUIRE_TLS=true    # default true in production
```

Edit the file locally; never paste credentials into chat, tickets or commits. Then:

```
npm run mail:verify                         # connects and authenticates (transporter.verify())
npm run mail:verify -- --to you@your-inbox  # also sends a "SMTP delivery check" message
```

Possible results, which are never conflated:

- `SMTP relay: connection and authentication verified.` means the relay is reachable and the credentials are valid.
- `SMTP ACCEPTED for yo***@domain` means the relay accepted the message. **This is not proof of delivery.**
- Delivered: confirm in the recipient's inbox (not spam), and check the `Authentication-Results` header for `spf=pass`, `dkim=pass` and `dmarc=pass`.

Restart the API after changing `.env`. At boot it runs the same verification and logs `Mail transport: SMTP relay connection and authentication verified`, or an error with the failure code. Broken mail configuration never stops sign-in or registration responses, but it is logged on every send.

### Sender identity and DNS

- `EMAIL_FROM` must use an address or domain you have verified with the provider. Never use a `gmail.com`, `outlook.com` or other free-mail address you do not control as the sender; providers reject or spam-folder such mail, and it is spoofing.
- **SPF:** add the provider's include to the domain's TXT record, for example `v=spf1 include:<provider-spf-domain> ~all`. Keep a single SPF record per domain.
- **DKIM:** publish the CNAME/TXT records the provider gives you and enable signing for the domain.
- **DMARC:** start with `_dmarc.your-domain TXT "v=DMARC1; p=none; rua=mailto:dmarc@your-domain"` and move to `quarantine`/`reject` once reports show alignment.
- Use a subdomain (for example `mail.your-domain`) if the main domain already sends marketing mail.

### Production guards (enforced at boot)

With `NODE_ENV=production` the API refuses to start when any of the following holds:

- `MAIL_TRANSPORT` is anything other than `smtp`;
- `SMTP_HOST` is loopback (`localhost`, `127.x`, `::1`, `0.0.0.0`);
- `SMTP_SECURE=false` together with `SMTP_REQUIRE_TLS=false` (plaintext SMTP);
- `SMTP_USER` is set without `SMTP_PASS`;
- the `EMAIL_FROM` domain is `localhost`, `.local`, `.test`, `.invalid` or `example.*`.

These are unit-tested in `env.validation.spec.ts`. TLS 1.2 is the minimum.

## 3. Running the tests

| Command | What it covers | Needs |
|---|---|---|
| `npm run verify` | typecheck, lint and unit tests (templates, transport, retries, service, env guards, auth service) | nothing |
| `npm run test:e2e` | API + PostgreSQL integration (email links verify/reset in the DB, single use, races, expiry, no token in audit) | `E2E_DATABASE_URL` pointing at a database whose name ends in `_test` (here `PIF_test`) |
| `npm run test:e2e:email` | headless Microsoft Edge through the real UI: register, inbox, link, confirm, reset, MFA notices, email change; writes screenshots to `docs/transactional-email/screenshots/` | API in preview mode, web, `npm run mail:inbox` |

To run the DB suite in PowerShell without printing the URL: set `$env:E2E_DATABASE_URL` to the dev URL with the database name replaced by `PIF_test`, then run `npm run test:e2e -w @mtrs/api`. The suite wipes `PIF_test` between tests and refuses any database whose name does not end in `_test`.

## 4. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Mail transport SMTP failed verification: ESOCKET` | nothing listening at `SMTP_HOST:SMTP_PORT`, or the port/TLS mode is wrong. Use 587 + `SMTP_SECURE=false`, or 465 + `true`. |
| `EAUTH` / `SMTP 535` | wrong username or password; for API-key providers the username is often a fixed string |
| `SMTP ACCEPTED` but nothing arrives | check spam; check SPF/DKIM/DMARC; check the provider's activity log; the sender may not be verified |
| Link opens `localhost:3000` in production | set `APP_FRONTEND_URL` to the public HTTPS origin (it must also be in `CORS_ORIGINS`) |
| Nothing in the preview inbox | confirm the API log says `PREVIEW`; resend and forgot-password honour a 60-second cooldown |
