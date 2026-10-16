/**
 * Operator check for the configured mail transport.
 *
 *   npm run mail:verify                                  # connect + authenticate only
 *   npm run mail:verify -- --to you@your-domain.com      # also send a delivery-check message
 *
 * "SMTP accepted" means the relay took the message; it does not prove inbox delivery.
 * Confirm arrival (and SPF/DKIM/DMARC results in the message headers) in the recipient inbox.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { validateEnv } from '../config/env.validation';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { maskEmail } from '../email/email.templates';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }), EmailModule],
})
class MailCheckModule {}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = argValue('--to');
  const app = await NestFactory.createApplicationContext(MailCheckModule, { logger: ['error', 'warn'] });
  try {
    const email = app.get(EmailService);
    console.log(`Mail transport: ${email.mode}`);
    await email.verifyTransport();
    console.log(
      email.mode === 'smtp'
        ? 'SMTP relay: connection and authentication verified.'
        : `Preview folder is writable: ${email.previewDirectory}`,
    );
    if (to) {
      const result = await email.sendSmtpTest(to);
      if (result.state === 'failed') {
        console.error(`Delivery check failed after ${result.attempts} attempt(s).`);
        process.exitCode = 1;
      } else if (result.state === 'smtp-accepted') {
        console.log(
          `SMTP ACCEPTED for ${result.accepted.map(maskEmail).join(', ')} (message id ${result.messageId}). Check the inbox to confirm delivery.`,
        );
      } else {
        console.log(`CAPTURED locally as ${result.previewId} — nothing was sent over the network.`);
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const reason = [e?.code, e?.responseCode ? `SMTP ${e.responseCode}` : '', e?.message]
    .filter((p) => p && String(p).trim())
    .join(' ');
  console.error(`Mail transport check FAILED: ${reason || 'unknown error'}`);
  process.exit(1);
});
