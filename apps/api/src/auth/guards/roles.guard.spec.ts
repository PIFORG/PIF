import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function guard(adminMfaRequired: boolean) {
  const reflector = { getAllAndOverride: () => [UserRole.ADMIN] } as unknown as Reflector;
  const config = { get: () => adminMfaRequired } as unknown as ConfigService;
  return new RolesGuard(reflector, config);
}

function ctx(user: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard (L5)', () => {
  it('denies investors on admin routes', () => {
    expect(guard(false).canActivate(ctx({ role: UserRole.INVESTOR, mfaEnabled: true }))).toBe(false);
  });

  it('requires admin MFA enrollment when the policy is on', () => {
    expect(() => guard(true).canActivate(ctx({ role: UserRole.ADMIN, mfaEnabled: false }))).toThrow(
      ForbiddenException,
    );
    expect(guard(true).canActivate(ctx({ role: UserRole.ADMIN, mfaEnabled: true }))).toBe(true);
  });

  it('allows admins without MFA when the policy is off (development default)', () => {
    expect(guard(false).canActivate(ctx({ role: UserRole.ADMIN, mfaEnabled: false }))).toBe(true);
  });
});
