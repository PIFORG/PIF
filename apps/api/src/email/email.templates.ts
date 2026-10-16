/**
 * Transactional email templates (HTML + plain text). Rules:
 *  - never include tokens except inside the single canonical action link;
 *  - state link expiry and single use exactly as configured;
 *  - never invent support channels: a help line is shown only when EMAIL_SUPPORT_URL is set;
 *  - security notices tell the reader what to do if it was not them, never "ignore this";
 *  - every claim about sessions or tokens must match what the calling service actually did;
 *  - email-client safe: tables, inline styles, system fonts, no scripts or remote assets.
 */

export interface TemplateParts {
  subject: string;
  preheader: string;
  text: string;
  html: string;
}

export interface BrandContext {
  appName: string;
  shortName?: string;
  /** Public web origin used for non-token links (sign in, security settings). */
  appUrl?: string;
  supportUrl?: string;
}

type Kind = 'request' | 'security' | 'info';

export const EMAIL_THEME = {
  canvas: '#081322',
  card: '#0B1422',
  panel: '#0F1C2E',
  border: '#1B2B40',
  heading: '#F4F8FF',
  body: '#B8C8DA',
  muted: '#8A9BB0',
  primary: '#2563EB',
  accent: '#38BDF8',
  attention: '#F5B544',
  font: 'Arial, Helvetica, sans-serif',
} as const;

const T = EMAIL_THEME;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortName(b: BrandContext): string {
  return b.shortName?.trim() || 'MTRS';
}

function appLink(b: BrandContext, path: string): string | undefined {
  return b.appUrl ? `${b.appUrl.replace(/\/$/, '')}${path}` : undefined;
}

function greeting(firstName?: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : 'Hello,';
}

const DEFAULT_NOTICE: Record<Kind, string> = {
  request: 'If you did not request this, no action is needed — nothing changes until the link is used.',
  security:
    'If this was not you, reset your password from the sign-in page right away and review your active sessions.',
  info: 'You are receiving this because an account was created with this email address.',
};

export function expiryLine(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `This link expires in ${hours} hour${hours === 1 ? '' : 's'} and can be used only once.`;
  }
  return `This link expires in ${minutes} minutes and can be used only once.`;
}

interface Action {
  url: string;
  label: string;
  /** Present only for single-use token links. */
  expiresMinutes?: number;
}

interface Fact {
  label: string;
  value: string;
}

interface Message {
  kind: Kind;
  eyebrow: string;
  subject: string;
  preheader: string;
  title: string;
  paragraphs: string[];
  facts?: Fact[];
  action?: Action;
  notice?: string;
  firstName?: string | null;
}

function footerLines(b: BrandContext, m: Message): string[] {
  const lines = [m.notice ?? DEFAULT_NOTICE[m.kind]];
  if (b.supportUrl) lines.push(`Need help? ${b.supportUrl}`);
  lines.push(
    `This is an automated message from ${shortName(b)} — ${b.appName}. Replies are not monitored.`,
    `${shortName(b)} is a simulated trading environment: no real money or securities are involved.`,
  );
  return lines;
}

function renderText(b: BrandContext, m: Message): string {
  const out = [greeting(m.firstName), '', ...m.paragraphs.flatMap((p) => [p, ''])];
  if (m.facts?.length) {
    out.push(...m.facts.map((f) => `${f.label}: ${f.value}`), '');
  }
  if (m.action) {
    out.push(`${m.action.label}:`, m.action.url, '');
    if (m.action.expiresMinutes !== undefined) out.push(expiryLine(m.action.expiresMinutes), '');
  }
  out.push('—', ...footerLines(b, m));
  return out.join('\n');
}

const P_STYLE = `margin:0 0 16px;font-family:${T.font};font-size:16px;line-height:1.6;color:${T.body};`;

function factsHtml(facts: Fact[]): string {
  const rows = facts
    .map(
      (f) => `<tr>
<td style="padding:10px 16px;font-family:${T.font};font-size:13px;color:${T.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(f.label)}</td>
<td style="padding:10px 16px;font-family:${T.font};font-size:14px;color:${T.heading};word-break:break-all;">${escapeHtml(f.value)}</td>
</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${T.panel}" style="background:${T.panel};border:1px solid ${T.border};border-radius:8px;margin:4px 0 20px;">${rows}</table>`;
}

function actionHtml(a: Action): string {
  const url = escapeHtml(a.url);
  const button = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
<tr><td align="center" bgcolor="${T.primary}" style="border-radius:8px;background:${T.primary};">
<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:${T.font};font-size:16px;font-weight:bold;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(a.label)}</a>
</td></tr></table>`;
  const expiry =
    a.expiresMinutes === undefined
      ? ''
      : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;">
<tr><td bgcolor="${T.panel}" style="background:${T.panel};border-left:3px solid ${T.attention};border-radius:4px;padding:12px 16px;font-family:${T.font};font-size:14px;line-height:1.5;color:${T.body};">${escapeHtml(expiryLine(a.expiresMinutes))}</td></tr></table>`;
  const fallback = `<p style="margin:0 0 6px;font-family:${T.font};font-size:13px;line-height:1.5;color:${T.muted};">Button not working? Copy this link into your browser:</p>
<p style="margin:0;font-family:${T.font};font-size:13px;line-height:1.5;word-break:break-all;"><a href="${url}" target="_blank" rel="noopener" style="color:${T.accent};text-decoration:underline;">${url}</a></p>`;
  return button + expiry + fallback;
}

function renderHtml(b: BrandContext, m: Message): string {
  const brandShort = escapeHtml(shortName(b));
  const preheaderPad = '&#8203;&nbsp;'.repeat(40);
  const body = [
    `<p style="${P_STYLE}">${escapeHtml(greeting(m.firstName))}</p>`,
    ...m.paragraphs.map((p) => `<p style="${P_STYLE}">${escapeHtml(p)}</p>`),
    m.facts?.length ? factsHtml(m.facts) : '',
    m.action ? actionHtml(m.action) : '',
  ].join('\n');
  const footer = footerLines(b, m)
    .map((line) => {
      if (b.supportUrl && line === `Need help? ${b.supportUrl}`) {
        const href = escapeHtml(b.supportUrl);
        return `<p style="margin:0 0 8px;">Need help? <a href="${href}" target="_blank" rel="noopener" style="color:${T.accent};">${href}</a></p>`;
      }
      return `<p style="margin:0 0 8px;">${escapeHtml(line)}</p>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<meta name="color-scheme" content="dark"/>
<meta name="supported-color-schemes" content="dark"/>
<title>${escapeHtml(m.subject)}</title>
<style>
@media only screen and (max-width:620px){
  .mtrs-card{padding:28px 20px !important;}
  .mtrs-title{font-size:24px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${T.canvas};" bgcolor="${T.canvas}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${T.canvas};">${escapeHtml(m.preheader)}${preheaderPad}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${T.canvas}" style="background:${T.canvas};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 4px 20px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td width="34" height="34" align="center" bgcolor="${T.primary}" style="width:34px;height:34px;background:${T.primary};border-radius:8px;font-family:${T.font};font-size:15px;font-weight:bold;color:#FFFFFF;">M</td>
<td style="padding-left:12px;font-family:${T.font};font-size:17px;font-weight:bold;letter-spacing:2px;color:${T.heading};">${brandShort}<span style="color:${T.accent};">.</span></td>
<td style="padding-left:12px;font-family:${T.font};font-size:12px;color:${T.muted};">${escapeHtml(b.appName)}</td>
</tr></table>
</td></tr>
<tr><td class="mtrs-card" bgcolor="${T.card}" style="background:${T.card};border:1px solid ${T.border};border-radius:12px;padding:40px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;"><tr><td width="48" height="3" bgcolor="${T.accent}" style="width:48px;height:3px;background:${T.accent};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
<p style="margin:0 0 10px;font-family:${T.font};font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${T.accent};">${escapeHtml(m.eyebrow)}</p>
<h1 class="mtrs-title" style="margin:0 0 24px;font-family:${T.font};font-size:27px;line-height:1.25;font-weight:bold;color:${T.heading};">${escapeHtml(m.title)}</h1>
${body}
</td></tr>
<tr><td style="padding:24px 8px 8px;font-family:${T.font};font-size:12px;line-height:1.6;color:${T.muted};">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function build(b: BrandContext, m: Message): TemplateParts {
  return { subject: m.subject, preheader: m.preheader, text: renderText(b, m), html: renderHtml(b, m) };
}

function maybeAction(url: string | undefined, label: string): Action | undefined {
  return url ? { url, label } : undefined;
}

export function verifyEmailTemplate(
  b: BrandContext,
  o: { firstName?: string | null; verifyUrl: string; expiresMinutes: number },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'request',
    eyebrow: 'Account verification',
    subject: `Verify your email for ${s}`,
    preheader: `Confirm your email address to activate your ${s} simulated trading workspace.`,
    title: 'Confirm your email address',
    paragraphs: [
      `Thanks for creating a ${b.appName} account. Confirm your email address to activate it and start using your virtual trading workspace.`,
      'Opening the link shows a confirmation page; your address is only confirmed when you press the button there.',
    ],
    action: { url: o.verifyUrl, label: 'Confirm email address', expiresMinutes: o.expiresMinutes },
    firstName: o.firstName,
  });
}

export function welcomeTemplate(b: BrandContext, o: { firstName?: string | null }): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'info',
    eyebrow: 'Account ready',
    subject: `Your ${s} account is ready`,
    preheader: 'Your email address is confirmed. Sign in to open your simulated market workspace.',
    title: `Welcome to ${s}`,
    paragraphs: [
      'Your email address is confirmed and your account is active.',
      'Everything in the workspace is simulated with virtual funds, so you can practise and learn without risking real money.',
    ],
    action: maybeAction(appLink(b, '/login'), `Sign in to ${s}`),
    notice: 'If you did not create this account, reset its password from the sign-in page and review its active sessions.',
    firstName: o.firstName,
  });
}

export function resetPasswordTemplate(
  b: BrandContext,
  o: { firstName?: string | null; resetUrl: string; expiresMinutes: number },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'request',
    eyebrow: 'Password reset',
    subject: `Reset your ${s} password`,
    preheader: 'Use this one-time link to choose a new password for your account.',
    title: 'Reset your password',
    paragraphs: [
      'We received a request to reset the password for your account.',
      'Resetting signs you out on every device and cancels any pending email change.',
    ],
    action: { url: o.resetUrl, label: 'Choose a new password', expiresMinutes: o.expiresMinutes },
    firstName: o.firstName,
  });
}

export function emailChangeConfirmTemplate(
  b: BrandContext,
  o: { firstName?: string | null; confirmUrl: string; newEmail: string; expiresMinutes: number },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'request',
    eyebrow: 'Email change',
    subject: `Confirm your new ${s} email address`,
    preheader: 'Confirm this address to make it the sign-in email for your account.',
    title: 'Confirm your new email address',
    paragraphs: [
      `You asked to use this address for your ${b.appName} account. Your current address stays active until you confirm.`,
      'Confirming signs you out on every device; sign in again with the new address.',
    ],
    facts: [{ label: 'New address', value: o.newEmail }],
    action: { url: o.confirmUrl, label: 'Confirm new email', expiresMinutes: o.expiresMinutes },
    firstName: o.firstName,
  });
}

export function emailChangeRequestedTemplate(
  b: BrandContext,
  o: { firstName?: string | null; maskedNewEmail: string },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Security notice',
    subject: `Email change requested for your ${s} account`,
    preheader: 'Nothing changes until the new address is confirmed.',
    title: 'Email change requested',
    paragraphs: [
      'A request was made to change your account email. Nothing changes until the new address is confirmed.',
      'If this was not you, reset your password now — that also cancels the pending change.',
    ],
    facts: [{ label: 'Requested address', value: o.maskedNewEmail }],
    action: maybeAction(appLink(b, '/settings/security'), 'Review security settings'),
    firstName: o.firstName,
  });
}

export function emailChangedOldAddressTemplate(
  b: BrandContext,
  o: { firstName?: string | null; maskedNewEmail: string },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Security notice',
    subject: `Your ${s} email address was changed`,
    preheader: 'This address no longer signs in to your account.',
    title: 'Email address changed',
    paragraphs: [
      'Your account email was changed. This address will no longer receive account messages, and all sessions were signed out.',
    ],
    facts: [{ label: 'New address', value: o.maskedNewEmail }],
    notice: `If you did not make this change, contact your ${s} administrator immediately — password reset links now go to the new address.`,
    firstName: o.firstName,
  });
}

export function emailChangedNewAddressTemplate(
  b: BrandContext,
  o: { firstName?: string | null },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Email change complete',
    subject: `Your ${s} email address is confirmed`,
    preheader: 'This address is now your sign-in email. Sign in again to continue.',
    title: 'New email address confirmed',
    paragraphs: [
      'This address is now the sign-in email for your account. For your security, every device was signed out; sign in again to continue.',
    ],
    action: maybeAction(appLink(b, '/login'), 'Sign in'),
    firstName: o.firstName,
  });
}

export function passwordChangedTemplate(
  b: BrandContext,
  o: { firstName?: string | null; via?: 'reset' | 'change' },
): TemplateParts {
  const s = shortName(b);
  const reset = o.via === 'reset';
  return build(b, {
    kind: 'security',
    eyebrow: 'Security notice',
    subject: `Your ${s} password was changed`,
    preheader: reset
      ? 'Your password was reset and every device was signed out.'
      : 'Your password was changed and other devices were signed out.',
    title: 'Password changed',
    paragraphs: [
      reset
        ? 'The password for your account was just reset with an emailed link. Every device was signed out and pending email-change links were cancelled.'
        : 'The password for your account was just changed. Other devices were signed out and pending email-change links were cancelled.',
    ],
    action: reset
      ? maybeAction(appLink(b, '/login'), 'Sign in')
      : maybeAction(appLink(b, '/settings/sessions'), 'Review active sessions'),
    firstName: o.firstName,
  });
}

export function accountLockedTemplate(
  b: BrandContext,
  o: { firstName?: string | null; lockMinutes: number },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Security notice',
    subject: `Sign-in to ${s} paused after failed attempts`,
    preheader: `New sign-ins are paused for ${o.lockMinutes} minutes after repeated failed attempts.`,
    title: 'Sign-in temporarily paused',
    paragraphs: [
      `We saw repeated failed sign-in attempts on your account, so new sign-ins are paused for ${o.lockMinutes} minutes. Devices that are already signed in are not affected.`,
      'If these attempts were not you, someone may know your email address. Consider choosing a new, unique password and enabling two-step verification.',
    ],
    action: maybeAction(appLink(b, '/forgot-password'), 'Reset your password'),
    firstName: o.firstName,
  });
}

export function sessionsRevokedTemplate(
  b: BrandContext,
  o: { firstName?: string | null; scope: 'others' | 'all' },
): TemplateParts {
  const s = shortName(b);
  const all = o.scope === 'all';
  return build(b, {
    kind: 'security',
    eyebrow: 'Security notice',
    subject: `Devices signed out of ${s}`,
    preheader: all ? 'Every device was signed out of your account.' : 'All other devices were signed out of your account.',
    title: 'Devices signed out',
    paragraphs: [
      all
        ? 'Every device, including the one used for this request, was signed out of your account.'
        : 'All other devices were signed out of your account. The device you used remains signed in.',
    ],
    action: all
      ? maybeAction(appLink(b, '/login'), 'Sign in')
      : maybeAction(appLink(b, '/settings/sessions'), 'Review active sessions'),
    firstName: o.firstName,
  });
}

export function mfaEnabledTemplate(b: BrandContext, o: { firstName?: string | null }): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Security notice',
    subject: `Two-step verification enabled on ${s}`,
    preheader: 'An authenticator code is now required when you sign in.',
    title: 'Two-step verification enabled',
    paragraphs: [
      'Two-step verification (authenticator app) is now required when you sign in. Keep your recovery codes somewhere safe and offline.',
      'Recovery codes are shown only once in the app and are never sent by email.',
    ],
    action: maybeAction(appLink(b, '/settings/security'), 'Review security settings'),
    firstName: o.firstName,
  });
}

export function mfaDisabledTemplate(b: BrandContext, o: { firstName?: string | null }): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Security notice',
    subject: `Two-step verification turned off on ${s}`,
    preheader: 'Your account no longer asks for an authenticator code at sign-in.',
    title: 'Two-step verification turned off',
    paragraphs: [
      'Two-step verification was turned off for your account and your recovery codes were invalidated. Other devices were signed out.',
    ],
    action: maybeAction(appLink(b, '/settings/security'), 'Review security settings'),
    firstName: o.firstName,
  });
}

export function mfaRecoveryCodesRegeneratedTemplate(
  b: BrandContext,
  o: { firstName?: string | null },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Security notice',
    subject: `New ${s} recovery codes were generated`,
    preheader: 'Your previous two-step verification recovery codes no longer work.',
    title: 'Recovery codes regenerated',
    paragraphs: [
      'A new set of two-step verification recovery codes was generated for your account. Your previous codes no longer work.',
      'Recovery codes are shown only once in the app and are never sent by email.',
    ],
    action: maybeAction(appLink(b, '/settings/security'), 'Review security settings'),
    firstName: o.firstName,
  });
}

export function accountDeactivatedTemplate(
  b: BrandContext,
  o: { firstName?: string | null; byAdministrator: boolean },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Account status',
    subject: `Your ${s} account was deactivated`,
    preheader: 'Sign-in is disabled and all devices were signed out.',
    title: 'Account deactivated',
    paragraphs: [
      o.byAdministrator
        ? 'An administrator deactivated your account. Sign-in is disabled and all devices were signed out.'
        : 'You deactivated your account. Sign-in is disabled and all devices were signed out. Reactivation requires an administrator.',
    ],
    firstName: o.firstName,
  });
}

export function accountSuspendedTemplate(
  b: BrandContext,
  o: { firstName?: string | null },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Account status',
    subject: `Your ${s} account was suspended`,
    preheader: 'Sign-in is disabled and all devices were signed out.',
    title: 'Account suspended',
    paragraphs: ['An administrator suspended your account. Sign-in is disabled and all devices were signed out.'],
    firstName: o.firstName,
  });
}

export function accountReactivatedTemplate(
  b: BrandContext,
  o: { firstName?: string | null; needsVerification?: boolean },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Account status',
    subject: `Your ${s} account was reactivated`,
    preheader: o.needsVerification
      ? 'Confirm your email address to finish reactivating your account.'
      : 'You can sign in again.',
    title: 'Account reactivated',
    paragraphs: [
      o.needsVerification
        ? 'An administrator reactivated your account. Your email address is not confirmed yet, so request a new verification link before signing in.'
        : 'An administrator reactivated your account. You can sign in again.',
    ],
    action: o.needsVerification
      ? maybeAction(appLink(b, '/resend-verification'), 'Request a verification link')
      : maybeAction(appLink(b, '/login'), 'Sign in'),
    firstName: o.firstName,
  });
}

export function accountDeletionScheduledTemplate(
  b: BrandContext,
  o: { firstName?: string | null },
): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'security',
    eyebrow: 'Account status',
    subject: `Your ${s} account is scheduled for deletion`,
    preheader: 'Sign-in is disabled and your personal details were removed.',
    title: 'Account deletion requested',
    paragraphs: [
      'You asked to delete your account. Sign-in is disabled, all devices were signed out, and your name and email address were removed from the account.',
      'This is the last message we will send to this address.',
    ],
    firstName: o.firstName,
  });
}

export function accountExistsTemplate(b: BrandContext, o: { firstName?: string | null }): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'request',
    eyebrow: 'Registration attempt',
    subject: `Someone tried to register with your ${s} email`,
    preheader: 'You already have an account, so no new account was created.',
    title: 'You already have an account',
    paragraphs: [
      'Someone tried to create a new account with this email address, but you already have one. No new account was created.',
      'If it was you, sign in instead — or use "Forgot password" on the sign-in page if you no longer remember it.',
    ],
    action: maybeAction(appLink(b, '/login'), 'Sign in'),
    firstName: o.firstName,
  });
}

/** Operator-triggered relay check (`npm run mail:verify -- --to ...`); carries no account data. */
export function smtpTestTemplate(b: BrandContext): TemplateParts {
  const s = shortName(b);
  return build(b, {
    kind: 'info',
    eyebrow: 'Delivery check',
    subject: `${s} SMTP delivery check`,
    preheader: 'If you can read this, the configured SMTP relay delivered a message to this inbox.',
    title: 'SMTP delivery check',
    paragraphs: [
      `This message was sent by an operator to confirm that ${b.appName} can deliver email through its configured SMTP relay.`,
      'It contains no account information and requires no action.',
    ],
    notice: 'You received this because an operator entered this address as the delivery-check recipient.',
  });
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
