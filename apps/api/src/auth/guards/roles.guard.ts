import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthRequestUser } from '../decorators/current-user.decorator';

/**
 * Coarse role gate. When `auth.adminMfaRequired` is on, administrator routes additionally
 * require enrolled MFA. Enrollment itself lives under /auth/mfa/* (not role-gated), which is
 * the safe path for a freshly bootstrapped first admin.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const request = context.switchToHttp().getRequest<{ user?: AuthRequestUser }>();
    const user = request.user;
    if (!user || !roles.includes(user.role)) return false;

    if (
      user.role === UserRole.ADMIN &&
      !user.mfaEnabled &&
      this.config.get<boolean>('auth.adminMfaRequired') === true
    ) {
      throw new ForbiddenException({
        message: 'Administrator access requires two-step verification. Enable it in Settings → Security.',
        errorCode: 'ADMIN_MFA_REQUIRED',
      });
    }
    return true;
  }
}
