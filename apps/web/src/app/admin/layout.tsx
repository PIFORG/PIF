'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeading } from '@/components/workspace/primitives';

const LINKS = [
  { href: '/admin', label: 'Platform' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/audit', label: 'Audit log' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <ProtectedRoute roles={['ADMIN']} requireEmailVerified>
      <AppShell>
        <div className="page-shell">
          <PageHeading
            eyebrow="Administration"
            title="Platform administration"
            description="Account oversight, role management and the security audit trail. Every action is recorded."
          />
          <nav className="subnav" aria-label="Administration">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="nav-link"
                aria-current={
                  pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href))
                    ? 'page'
                    : undefined
                }
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
