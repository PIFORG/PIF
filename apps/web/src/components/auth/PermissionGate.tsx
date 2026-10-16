'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import type { UserRole } from '@/lib/api/types';

interface PermissionGateProps {
  roles: UserRole[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({
  roles,
  children,
  fallback = null,
}: PermissionGateProps) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
