import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import type { User, UserRole, UserStatus } from '../api/types';
import { AuthService } from './auth.service';
import { buildLoginHref } from './return-to';

export interface AccessRule {
  roles?: UserRole[];
  allowStatuses?: UserStatus[];
  requireEmailVerified?: boolean;
}

const DEFAULT_STATUSES: UserStatus[] = ['ACTIVE', 'PENDING_VERIFICATION', 'PENDING_DELETION'];

/** Same decision order as ProtectedRouteComponent; null means the user may enter. */
export function accessRedirect(user: User | null, url: string, rule: AccessRule): string | null {
  if (!user) return buildLoginHref(url.split('#')[0]);
  if (!(rule.allowStatuses ?? DEFAULT_STATUSES).includes(user.status)) return '/unauthorized';
  if (rule.requireEmailVerified && !user.emailVerified) return '/resend-verification';
  if (rule.roles && !rule.roles.includes(user.role)) return '/unauthorized';
  return null;
}

/**
 * Once the session state is known, allows or redirects before anything renders. While the session is still being
 * restored it lets the route activate, so ProtectedRouteComponent shows "Checking session…" (as apps/web does) and
 * applies the same rule when restore finishes. UX only: the API authorizes every request itself.
 */
export function accessGuard(rule: AccessRule): CanActivateFn {
  return (_route, state): boolean | UrlTree => {
    const auth = inject(AuthService);
    if (auth.status() === 'loading') return true;
    const target = accessRedirect(auth.user(), state.url, rule);
    return target === null ? true : inject(Router).parseUrl(target);
  };
}

/** apps/web admin/layout.tsx: administrators with a verified email only. */
export const adminGuard = accessGuard({ roles: ['ADMIN'], requireEmailVerified: true });
