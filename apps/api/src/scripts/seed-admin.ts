/**
 * Opt-in administrator bootstrap.
 * Requires ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD in the environment.
 * Never commits credentials. Does not expose a public admin signup endpoint.
 */
import { NestFactory } from '@nestjs/core';
import { AuditOutcome, UserRole, UserStatus } from '@prisma/client';
import { AppModule } from '../app.module';
import { AuditService } from '../audit/audit.service';
import { hashPassword, validatePasswordPolicy } from '../common/crypto/password.util';
import { normalizeEmail } from '../common/crypto/email.util';
import { PrismaService } from '../prisma/prisma.service';

async function main() {
  const emailRaw = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const firstName = process.env.ADMIN_BOOTSTRAP_FIRST_NAME ?? 'Platform';
  const lastName = process.env.ADMIN_BOOTSTRAP_LAST_NAME ?? 'Admin';

  if (!emailRaw || !password) {
    console.error(
      'Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD before running seed:admin.',
    );
    process.exit(1);
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    console.error(policy.errors.join('; '));
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const email = normalizeEmail(emailRaw);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role === UserRole.ADMIN) {
      console.log('Admin account already exists for this email. No changes.');
    } else if (
      existing.status !== UserStatus.ACTIVE ||
      !existing.emailVerified ||
      existing.deletedAt
    ) {
      // An unverified account may have been registered by someone else to squat this address;
      // elevating it would hand them admin rights with a password they chose. A suspended or
      // deactivated account must not be silently reactivated either.
      console.error(
        'Refusing to elevate: the existing account for this email is not active and verified. ' +
          'Resolve it through the normal account flows first.',
      );
      await app.close();
      process.exit(1);
    } else {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: UserRole.ADMIN, securityVersion: { increment: 1 } },
      });
      await audit.record({
        eventType: 'ADMIN_ROLE_CHANGE',
        outcome: AuditOutcome.SUCCESS,
        subjectUserId: existing.id,
        context: { from: existing.role, to: UserRole.ADMIN, via: 'bootstrap' },
      });
      console.log('Existing active, verified user elevated to ADMIN (password unchanged).');
    }
  } else {
    const passwordHash = await hashPassword(password);
    const created = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        passwordChangedAt: new Date(),
        preferences: { create: {} },
      },
    });
    await audit.record({
      eventType: 'ADMIN_BOOTSTRAPPED',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: created.id,
      context: { via: 'bootstrap' },
    });
    console.log('Administrator account created. Enable MFA after first sign-in (recommended).');
  }

  await app.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
