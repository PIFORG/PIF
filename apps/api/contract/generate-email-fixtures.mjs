// Renders every transactional email with the NestJS API's own template code so the Java port can be
// checked byte for byte. Only synthetic names, addresses and links are used; nothing is sent.
//
// Usage (from the repository root, after `npm run build` in apps/api):
//   node apps/api-spring/contract/generate-email-fixtures.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../api');
const require = createRequire(join(apiDir, 'package.json'));
const t = require(join(apiDir, 'dist/email/email.templates.js'));

const brands = [
  {
    appName: 'Market Trading Room Simulator',
    shortName: 'MTRS',
    appUrl: 'http://localhost:3000/',
    supportUrl: 'https://support.example.test/help?topic=a&lang="en"',
  },
  { appName: 'Desk <b>&</b> "Lab"', shortName: '   ', appUrl: undefined, supportUrl: undefined },
  { appName: 'Plain', shortName: undefined, appUrl: 'https://app.example.test', supportUrl: undefined },
];
const names = ['Ada', null, '   ', '<script>“Zoë” & O\'Brien</script>', ' \u00a0Jean-Luc\u2003'];
const link = (path) => `https://app.example.test${path}?token=${encodeURIComponent('ab+/=?&<>"\'' + 'f'.repeat(54))}`;

const cases = [];
const add = (fn, brand, args) => {
  const b = brands[brand];
  let parts;
  switch (fn) {
    case 'verifyEmail':
      parts = t.verifyEmailTemplate(b, { firstName: args.firstName, verifyUrl: args.url, expiresMinutes: args.minutes });
      break;
    case 'welcome':
      parts = t.welcomeTemplate(b, { firstName: args.firstName });
      break;
    case 'resetPassword':
      parts = t.resetPasswordTemplate(b, { firstName: args.firstName, resetUrl: args.url, expiresMinutes: args.minutes });
      break;
    case 'emailChangeConfirm':
      parts = t.emailChangeConfirmTemplate(b, {
        firstName: args.firstName,
        confirmUrl: args.url,
        newEmail: args.email,
        expiresMinutes: args.minutes,
      });
      break;
    case 'emailChangeRequested':
      parts = t.emailChangeRequestedTemplate(b, { firstName: args.firstName, maskedNewEmail: args.email });
      break;
    case 'emailChangedOldAddress':
      parts = t.emailChangedOldAddressTemplate(b, { firstName: args.firstName, maskedNewEmail: args.email });
      break;
    case 'emailChangedNewAddress':
      parts = t.emailChangedNewAddressTemplate(b, { firstName: args.firstName });
      break;
    case 'passwordChanged':
      parts = t.passwordChangedTemplate(b, { firstName: args.firstName, via: args.via ?? undefined });
      break;
    case 'accountLocked':
      parts = t.accountLockedTemplate(b, { firstName: args.firstName, lockMinutes: args.minutes });
      break;
    case 'sessionsRevoked':
      parts = t.sessionsRevokedTemplate(b, { firstName: args.firstName, scope: args.scope });
      break;
    case 'mfaEnabled':
      parts = t.mfaEnabledTemplate(b, { firstName: args.firstName });
      break;
    case 'mfaDisabled':
      parts = t.mfaDisabledTemplate(b, { firstName: args.firstName });
      break;
    case 'mfaRecoveryCodesRegenerated':
      parts = t.mfaRecoveryCodesRegeneratedTemplate(b, { firstName: args.firstName });
      break;
    case 'accountDeactivated':
      parts = t.accountDeactivatedTemplate(b, { firstName: args.firstName, byAdministrator: args.flag });
      break;
    case 'accountSuspended':
      parts = t.accountSuspendedTemplate(b, { firstName: args.firstName });
      break;
    case 'accountReactivated':
      parts = t.accountReactivatedTemplate(b, { firstName: args.firstName, needsVerification: args.flag });
      break;
    case 'accountDeletionScheduled':
      parts = t.accountDeletionScheduledTemplate(b, { firstName: args.firstName });
      break;
    case 'accountExists':
      parts = t.accountExistsTemplate(b, { firstName: args.firstName });
      break;
    case 'smtpTest':
      parts = t.smtpTestTemplate(b);
      break;
    default:
      throw new Error(fn);
  }
  cases.push({ fn, brand, args, expected: parts });
};

for (let brand = 0; brand < brands.length; brand++) {
  for (const firstName of names) {
    for (const minutes of [60, 30, 1, 90, 120]) {
      add('verifyEmail', brand, { firstName, url: link('/verify-email'), minutes });
      add('resetPassword', brand, { firstName, url: link('/reset-password'), minutes });
      add('emailChangeConfirm', brand, {
        firstName,
        url: link('/confirm-email-change'),
        email: 'new.address+tag@example.test',
        minutes,
      });
      add('accountLocked', brand, { firstName, minutes });
    }
    add('emailChangeConfirm', brand, { firstName, url: link('/x'), email: '<b>"q"</b>@example.test', minutes: 60 });
    for (const email of ['ne***@example.test', '<i>***@x.test']) {
      add('emailChangeRequested', brand, { firstName, email });
      add('emailChangedOldAddress', brand, { firstName, email });
    }
    for (const via of [null, 'reset', 'change']) add('passwordChanged', brand, { firstName, via });
    for (const scope of ['others', 'all']) add('sessionsRevoked', brand, { firstName, scope });
    for (const flag of [true, false]) {
      add('accountDeactivated', brand, { firstName, flag });
      add('accountReactivated', brand, { firstName, flag });
    }
    for (const fn of [
      'welcome',
      'emailChangedNewAddress',
      'mfaEnabled',
      'mfaDisabled',
      'mfaRecoveryCodesRegenerated',
      'accountSuspended',
      'accountDeletionScheduled',
      'accountExists',
    ]) {
      add(fn, brand, { firstName });
    }
  }
  add('smtpTest', brand, {});
}

const masks = ['ada@example.test', 'a@b.test', 'AB@x.test', 'no-at-sign', '@lead.test', 'zoë.ü@ex.test'].map((email) => ({
  email,
  masked: t.maskEmail(email),
}));
const escapes = ['plain', `<a href="x">'&'</a>`, '&amp;'].map((s) => ({ s, escaped: t.escapeHtml(s) }));
const expiry = [1, 30, 59, 60, 61, 90, 120, 1440].map((m) => ({ minutes: m, line: t.expiryLine(m) }));

const out = {
  generatedBy: 'apps/api-spring/contract/generate-email-fixtures.mjs (apps/api dist/email/email.templates.js, node '
    + process.version + ')',
  brands: brands.map((b) => ({
    appName: b.appName,
    shortName: b.shortName ?? null,
    appUrl: b.appUrl ?? null,
    supportUrl: b.supportUrl ?? null,
  })),
  cases,
  masks,
  escapes,
  expiry,
};
const target = resolve(here, '../src/test/resources/fixtures/email-templates.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log('Wrote', target, `(${cases.length} rendered emails)`);
