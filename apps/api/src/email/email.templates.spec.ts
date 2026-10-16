import {
  accountDeactivatedTemplate,
  accountDeletionScheduledTemplate,
  accountExistsTemplate,
  accountLockedTemplate,
  accountReactivatedTemplate,
  accountSuspendedTemplate,
  EMAIL_THEME,
  emailChangeConfirmTemplate,
  emailChangedNewAddressTemplate,
  emailChangedOldAddressTemplate,
  emailChangeRequestedTemplate,
  mfaDisabledTemplate,
  mfaEnabledTemplate,
  mfaRecoveryCodesRegeneratedTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  sessionsRevokedTemplate,
  smtpTestTemplate,
  type TemplateParts,
  verifyEmailTemplate,
  welcomeTemplate,
} from './email.templates';

const brand = { appName: 'Market Trading Room Simulator' };
const fullBrand = { ...brand, shortName: 'MTRS', appUrl: 'https://app.mtrs-sim.com' };
const TOKEN_URL = 'https://app.mtrs-sim.com/verify-email?token=AbC123_tok';

const ALL: Array<[string, TemplateParts]> = [
  ['verify', verifyEmailTemplate(fullBrand, { firstName: 'Ada', verifyUrl: TOKEN_URL, expiresMinutes: 60 })],
  ['welcome', welcomeTemplate(fullBrand, { firstName: 'Ada' })],
  ['reset', resetPasswordTemplate(fullBrand, { firstName: 'Ada', resetUrl: TOKEN_URL, expiresMinutes: 30 })],
  [
    'email-change-confirm',
    emailChangeConfirmTemplate(fullBrand, {
      firstName: 'Ada',
      confirmUrl: TOKEN_URL,
      newEmail: 'new@mtrs-sim.com',
      expiresMinutes: 60,
    }),
  ],
  ['email-change-requested', emailChangeRequestedTemplate(fullBrand, { firstName: 'Ada', maskedNewEmail: 'ne***@x.com' })],
  ['email-changed-old', emailChangedOldAddressTemplate(fullBrand, { firstName: 'Ada', maskedNewEmail: 'ne***@x.com' })],
  ['email-changed-new', emailChangedNewAddressTemplate(fullBrand, { firstName: 'Ada' })],
  ['password-changed', passwordChangedTemplate(fullBrand, { firstName: 'Ada' })],
  ['password-reset-done', passwordChangedTemplate(fullBrand, { firstName: 'Ada', via: 'reset' })],
  ['locked', accountLockedTemplate(fullBrand, { firstName: 'Ada', lockMinutes: 15 })],
  ['sessions', sessionsRevokedTemplate(fullBrand, { firstName: 'Ada', scope: 'others' })],
  ['mfa-on', mfaEnabledTemplate(fullBrand, { firstName: 'Ada' })],
  ['mfa-off', mfaDisabledTemplate(fullBrand, { firstName: 'Ada' })],
  ['mfa-codes', mfaRecoveryCodesRegeneratedTemplate(fullBrand, { firstName: 'Ada' })],
  ['deactivated', accountDeactivatedTemplate(fullBrand, { firstName: 'Ada', byAdministrator: true })],
  ['suspended', accountSuspendedTemplate(fullBrand, { firstName: 'Ada' })],
  ['reactivated', accountReactivatedTemplate(fullBrand, { firstName: 'Ada' })],
  ['deletion', accountDeletionScheduledTemplate(fullBrand, { firstName: 'Ada' })],
  ['exists', accountExistsTemplate(fullBrand, { firstName: 'Ada' })],
  ['smtp-test', smtpTestTemplate(fullBrand)],
];

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('MTRS email design system', () => {
  it.each(ALL)('%s has subject, preheader, HTML and text parts', (_name, t) => {
    expect(t.subject.length).toBeGreaterThan(5);
    expect(t.subject).not.toMatch(/[\r\n]/);
    expect(t.preheader.length).toBeGreaterThan(10);
    expect(t.text.length).toBeGreaterThan(40);
    expect(t.html).toContain('<!DOCTYPE html>');
    expect(t.html).toContain('lang="en"');
  });

  it.each(ALL)('%s uses the dark MTRS palette, a 600px container and system fonts', (_name, t) => {
    expect(t.html).toContain(`background:${EMAIL_THEME.canvas}`);
    expect(t.html).toContain(`background:${EMAIL_THEME.card}`);
    expect(t.html).toContain('max-width:600px');
    expect(t.html).toContain('border-radius:12px');
    expect(t.html).toContain('Arial, Helvetica, sans-serif');
    expect(t.html).toContain('MTRS');
  });

  it.each(ALL)('%s is email-client safe: no scripts, remote assets, forms or web fonts', (_name, t) => {
    expect(t.html).not.toMatch(/<script|<link|<img|<form|<iframe|@import|@font-face|javascript:/i);
    expect(t.html).not.toMatch(/src="https?:/i);
  });

  it.each(ALL)('%s hides the preheader and carries it as the first body content', (_name, t) => {
    expect(t.html).toMatch(/<div style="display:none;[^"]*">/);
    expect(t.html.indexOf(t.preheader.slice(0, 20))).toBeLessThan(t.html.indexOf('<h1'));
  });

  it.each(ALL)('%s has at most one primary call to action', (_name, t) => {
    expect(countOf(t.html, `bgcolor="${EMAIL_THEME.primary}" style="border-radius:8px`)).toBeLessThanOrEqual(1);
  });

  it.each(ALL)('%s never ships third-party product branding', (_name, t) => {
    expect(`${t.subject}${t.preheader}${t.text}${t.html}`).not.toMatch(/taxgain/i);
  });

  it('places a token link only in the button and the fallback, and once in text', () => {
    const t = verifyEmailTemplate(fullBrand, { firstName: 'Ada', verifyUrl: TOKEN_URL, expiresMinutes: 60 });
    expect(countOf(t.html, 'token=AbC123_tok')).toBe(3); // button href, fallback href, fallback text
    expect(countOf(t.text, 'token=AbC123_tok')).toBe(1);
    expect(t.subject).not.toContain('token');
    expect(t.preheader).not.toContain('token');
  });

  it('shows expiry and single-use only on token links, never on plain navigation links', () => {
    expect(welcomeTemplate(fullBrand, { firstName: 'Ada' }).text).not.toContain('can be used only once');
    expect(mfaEnabledTemplate(fullBrand, { firstName: 'Ada' }).text).not.toContain('expires');
  });

  it('omits navigation CTAs when no public app URL is configured', () => {
    const t = welcomeTemplate(brand, { firstName: 'Ada' });
    expect(t.html).not.toContain(`bgcolor="${EMAIL_THEME.primary}" style="border-radius:8px`);
  });

  it('describes a reset and a signed-in change with the sign-out scope each actually has', () => {
    expect(passwordChangedTemplate(fullBrand, { firstName: 'Ada', via: 'reset' }).text).toContain(
      'Every device was signed out',
    );
    expect(passwordChangedTemplate(fullBrand, { firstName: 'Ada', via: 'change' }).text).toContain(
      'Other devices were signed out',
    );
  });

  it('does not tell an old address to use reset links that now go to the new address', () => {
    const t = emailChangedOldAddressTemplate(fullBrand, { firstName: 'Ada', maskedNewEmail: 'ne***@x.com' });
    expect(t.text).toContain('password reset links now go to the new address');
    expect(t.text).not.toContain('reset your password from the sign-in page');
  });

  it('does not promise sign-in after reactivation while the email is still unverified', () => {
    const t = accountReactivatedTemplate(fullBrand, { firstName: 'Ada', needsVerification: true });
    expect(t.text).not.toContain('You can sign in again');
    expect(t.text).toContain('https://app.mtrs-sim.com/resend-verification');
  });

  it('states that MFA secrets and recovery codes are never emailed', () => {
    for (const t of [mfaEnabledTemplate(fullBrand, {}), mfaRecoveryCodesRegeneratedTemplate(fullBrand, {})]) {
      expect(t.text).toContain('never sent by email');
    }
  });

  it('escapes user-controlled values in facts such as the requested address', () => {
    const t = emailChangeConfirmTemplate(fullBrand, {
      firstName: 'Ada',
      confirmUrl: TOKEN_URL,
      newEmail: '"><b>x</b>@evil.test',
      expiresMinutes: 60,
    });
    expect(t.html).not.toContain('<b>x</b>');
    expect(t.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('email templates', () => {
  it('states expiry and single use on action links', () => {
    const t = resetPasswordTemplate(brand, {
      firstName: 'Ada',
      resetUrl: 'https://app.example/reset-password?token=abc',
      expiresMinutes: 30,
    });
    expect(t.text).toContain('expires in 30 minutes and can be used only once');
    expect(t.html).toContain('expires in 30 minutes');
    expect(verifyEmailTemplate(brand, { verifyUrl: 'https://x/v', expiresMinutes: 60 }).text).toContain(
      'expires in 1 hour',
    );
  });

  it('greets by first name and falls back to a neutral greeting', () => {
    expect(passwordChangedTemplate(brand, { firstName: 'Ada' }).text.startsWith('Hi Ada,')).toBe(true);
    expect(passwordChangedTemplate(brand, { firstName: '  ' }).text.startsWith('Hello,')).toBe(true);
  });

  it('never invents a support channel and links one only when configured', () => {
    const plain = accountLockedTemplate(brand, { firstName: 'Ada', lockMinutes: 15 });
    expect(plain.text.toLowerCase()).not.toContain('contact support');
    expect(plain.html).not.toContain('Need help?');

    const withSupport = accountLockedTemplate(
      { ...brand, supportUrl: 'https://help.example/account' },
      { firstName: 'Ada', lockMinutes: 15 },
    );
    expect(withSupport.text).toContain('Need help? https://help.example/account');
  });

  it('tells security-notice readers what to do instead of "ignore this"', () => {
    const t = passwordChangedTemplate(brand, { firstName: 'Ada' });
    expect(t.text).toContain('If this was not you, reset your password');
    expect(t.text.toLowerCase()).not.toContain('ignore');
  });

  it('escapes user-controlled values in HTML', () => {
    const t = passwordChangedTemplate(brand, { firstName: '<img src=x onerror=alert(1)>' });
    expect(t.html).not.toContain('<img');
    expect(t.html).toContain('&lt;img');
  });

  it('reports the lock duration and that signed-in devices are unaffected', () => {
    const t = accountLockedTemplate(brand, { firstName: null, lockMinutes: 15 });
    expect(t.text).toContain('paused for 15 minutes');
    expect(t.text).toContain('already signed in are not affected');
  });
});
