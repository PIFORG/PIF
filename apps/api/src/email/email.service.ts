import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import {
  accountDeactivatedTemplate,
  accountDeletionScheduledTemplate,
  accountExistsTemplate,
  accountLockedTemplate,
  accountReactivatedTemplate,
  accountSuspendedTemplate,
  type BrandContext,
  emailChangeConfirmTemplate,
  emailChangedNewAddressTemplate,
  emailChangedOldAddressTemplate,
  emailChangeRequestedTemplate,
  maskEmail,
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
import {
  type MailDeliveryResult,
  type MailTransport,
  PreviewMailTransport,
  SmtpMailTransport,
} from './mail-transport';

type Name = string | null | undefined;

const EMAIL_IN_TEXT = /[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+/g;

/** Relay error messages can echo recipient addresses; never let them reach logs unmasked. */
function redact(reason: string): string {
  return reason.replace(EMAIL_IN_TEXT, (m) => maskEmail(m));
}

function describeError(err: unknown): string {
  const e = err as { message?: string; code?: string; responseCode?: number };
  const parts = [e?.code, e?.responseCode ? `SMTP ${e.responseCode}` : undefined, e?.message].filter(
    (p): p is string => !!p && String(p).trim() !== '',
  );
  return redact(parts.join(' ') || 'unknown error');
}

/**
 * Sends transactional mail. Delivery failures are logged (recipient masked) and never
 * surface to the HTTP caller, so responses cannot be used to probe account existence.
 */
@Injectable()
export class EmailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailService.name);
  private readonly transport: MailTransport;

  constructor(private readonly config: ConfigService) {
    const mode = this.config.get<string>('mail.transport') ?? 'smtp';
    if (mode === 'preview') {
      if (this.config.get<string>('nodeEnv') === 'production') {
        throw new Error('MAIL_TRANSPORT=preview is not allowed in production');
      }
      const dir = path.resolve(process.cwd(), this.config.get<string>('mail.previewDir') ?? '.mail-preview');
      this.transport = new PreviewMailTransport(dir);
    } else {
      this.transport = new SmtpMailTransport({
        host: this.config.getOrThrow<string>('smtp.host'),
        port: this.config.getOrThrow<number>('smtp.port'),
        secure: this.config.getOrThrow<boolean>('smtp.secure'),
        requireTls: this.config.get<boolean>('smtp.requireTls') ?? false,
        user: this.config.get<string>('smtp.user'),
        pass: this.config.get<string>('smtp.pass'),
      });
    }
  }

  get mode() {
    return this.transport.mode;
  }

  get previewDirectory(): string | undefined {
    return this.transport instanceof PreviewMailTransport ? this.transport.directory : undefined;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('nodeEnv') === 'test') return;
    try {
      await this.transport.verify();
      if (this.transport instanceof PreviewMailTransport) {
        this.logger.warn(
          `Mail transport: PREVIEW - messages are written to ${this.transport.directory} and are NOT delivered. Run "npm run mail:inbox" to view them.`,
        );
      } else {
        this.logger.log('Mail transport: SMTP relay connection and authentication verified');
      }
    } catch (err) {
      this.logger.error(
        `Mail transport ${this.transport.mode.toUpperCase()} failed verification: ${describeError(err)}. Transactional email will not be sent until this is fixed.`,
      );
    }
  }

  /** Throws when the configured transport is unusable (used by the operator check script). */
  verifyTransport(): Promise<void> {
    return this.transport.verify();
  }

  private get brand(): BrandContext {
    return {
      appName: this.config.getOrThrow<string>('app.name'),
      shortName: 'MTRS',
      appUrl: this.config.getOrThrow<string>('app.frontendUrl'),
      supportUrl: this.config.get<string>('smtp.supportUrl'),
    };
  }

  private link(path: string, rawToken: string): string {
    const base = this.config.getOrThrow<string>('app.frontendUrl').replace(/\/$/, '');
    return `${base}${path}?token=${encodeURIComponent(rawToken)}`;
  }

  private async deliver(template: string, to: string, t: TemplateParts): Promise<MailDeliveryResult> {
    let result: MailDeliveryResult;
    try {
      result = await this.transport.send({
        template,
        from: this.config.getOrThrow<string>('smtp.from'),
        replyTo: this.config.get<string>('mail.replyTo'),
        to,
        subject: t.subject,
        text: t.text,
        html: t.html,
      });
    } catch (err) {
      result = { state: 'failed', reason: describeError(err), attempts: 1 };
    }
    const target = `template=${template} to=${maskEmail(to)}`;
    if (result.state === 'captured') {
      this.logger.log(`Email captured to local preview (not delivered): ${target} preview=${result.previewId}`);
    } else if (result.state === 'smtp-accepted') {
      this.logger.log(`Email accepted by SMTP relay (inbox delivery not confirmed): ${target}`);
    } else {
      this.logger.error(
        `Email delivery failed: ${target} attempts=${result.attempts} reason=${redact(result.reason)}`,
      );
    }
    return result;
  }

  private async send(template: string, to: string, t: TemplateParts): Promise<boolean> {
    const result = await this.deliver(template, to, t);
    return result.state !== 'failed';
  }

  sendVerification(to: string, firstName: Name, rawToken: string, expiresMinutes: number) {
    const verifyUrl = this.link('/verify-email', rawToken);
    return this.send('verify-email', to, verifyEmailTemplate(this.brand, { firstName, verifyUrl, expiresMinutes }));
  }

  sendWelcome(to: string, firstName: Name) {
    return this.send('welcome', to, welcomeTemplate(this.brand, { firstName }));
  }

  sendPasswordReset(to: string, firstName: Name, rawToken: string, expiresMinutes: number) {
    const resetUrl = this.link('/reset-password', rawToken);
    return this.send('reset-password', to, resetPasswordTemplate(this.brand, { firstName, resetUrl, expiresMinutes }));
  }

  sendEmailChangeConfirm(
    newEmail: string,
    firstName: Name,
    rawToken: string,
    expiresMinutes: number,
  ) {
    const confirmUrl = this.link('/confirm-email-change', rawToken);
    return this.send(
      'email-change-confirm',
      newEmail,
      emailChangeConfirmTemplate(this.brand, { firstName, confirmUrl, newEmail, expiresMinutes }),
    );
  }

  sendEmailChangeRequested(oldEmail: string, firstName: Name, newEmail: string) {
    return this.send(
      'email-change-requested',
      oldEmail,
      emailChangeRequestedTemplate(this.brand, { firstName, maskedNewEmail: maskEmail(newEmail) }),
    );
  }

  sendEmailChangedToOld(oldEmail: string, firstName: Name, newEmail: string) {
    return this.send(
      'email-changed-old',
      oldEmail,
      emailChangedOldAddressTemplate(this.brand, { firstName, maskedNewEmail: maskEmail(newEmail) }),
    );
  }

  sendEmailChangedToNew(newEmail: string, firstName: Name) {
    return this.send('email-changed-new', newEmail, emailChangedNewAddressTemplate(this.brand, { firstName }));
  }

  sendPasswordChanged(to: string, firstName: Name, via: 'reset' | 'change' = 'change') {
    return this.send('password-changed', to, passwordChangedTemplate(this.brand, { firstName, via }));
  }

  sendAccountLocked(to: string, firstName: Name, lockMinutes: number) {
    return this.send('account-locked', to, accountLockedTemplate(this.brand, { firstName, lockMinutes }));
  }

  sendSessionsRevoked(to: string, firstName: Name, scope: 'others' | 'all') {
    return this.send('sessions-revoked', to, sessionsRevokedTemplate(this.brand, { firstName, scope }));
  }

  sendMfaEnabled(to: string, firstName: Name) {
    return this.send('mfa-enabled', to, mfaEnabledTemplate(this.brand, { firstName }));
  }

  sendMfaDisabled(to: string, firstName: Name) {
    return this.send('mfa-disabled', to, mfaDisabledTemplate(this.brand, { firstName }));
  }

  sendMfaRecoveryCodesRegenerated(to: string, firstName: Name) {
    return this.send(
      'mfa-recovery-codes-regenerated',
      to,
      mfaRecoveryCodesRegeneratedTemplate(this.brand, { firstName }),
    );
  }

  sendAccountDeactivated(to: string, firstName: Name, byAdministrator: boolean) {
    return this.send(
      'account-deactivated',
      to,
      accountDeactivatedTemplate(this.brand, { firstName, byAdministrator }),
    );
  }

  sendAccountSuspended(to: string, firstName: Name) {
    return this.send('account-suspended', to, accountSuspendedTemplate(this.brand, { firstName }));
  }

  sendAccountReactivated(to: string, firstName: Name, needsVerification = false) {
    return this.send(
      'account-reactivated',
      to,
      accountReactivatedTemplate(this.brand, { firstName, needsVerification }),
    );
  }

  sendAccountDeletionScheduled(to: string, firstName: Name) {
    return this.send(
      'account-deletion-scheduled',
      to,
      accountDeletionScheduledTemplate(this.brand, { firstName }),
    );
  }

  sendAccountExists(to: string, firstName: Name) {
    return this.send('account-exists', to, accountExistsTemplate(this.brand, { firstName }));
  }

  sendSmtpTest(to: string): Promise<MailDeliveryResult> {
    return this.deliver('smtp-test', to, smtpTestTemplate(this.brand));
  }
}
