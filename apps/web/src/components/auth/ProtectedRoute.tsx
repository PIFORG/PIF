'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { buildLoginHref } from '@/lib/auth/returnTo';
import type { UserRole, UserStatus } from '@/lib/api/types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  roles?: UserRole[];
  allowStatuses?: UserStatus[];
  requireEmailVerified?: boolean;
}

export function ProtectedRoute({
  children,
  roles,
  allowStatuses = ['ACTIVE', 'PENDING_VERIFICATION', 'PENDING_DELETION'],
  requireEmailVerified = false,
}: ProtectedRouteProps) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated' || !user) {
      router.replace(buildLoginHref(`${pathname}${window.location.search}`));
      return;
    }

    if (!allowStatuses.includes(user.status)) {
      router.replace('/unauthorized');
      return;
    }

    if (requireEmailVerified && !user.emailVerified) {
      router.replace('/resend-verification');
      return;
    }

    if (roles && !roles.includes(user.role)) {
      router.replace('/unauthorized');
    }
  }, [
    status,
    user,
    router,
    pathname,
    roles,
    allowStatuses,
    requireEmailVerified,
  ]);

  if (status === 'loading') {
    return (
      <div className="page-shell" role="status" aria-live="polite">
        <p>Checking session…</p>
      </div>
    );
  }

  if (!user) return null;
  if (!allowStatuses.includes(user.status)) return null;
  if (requireEmailVerified && !user.emailVerified) return null;
  if (roles && !roles.includes(user.role)) return null;

  return <>{children}</>;
}
