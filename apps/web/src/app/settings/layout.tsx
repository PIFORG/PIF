'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeading } from '@/components/workspace/primitives';

const LINKS = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/security', label: 'Security' },
  { href: '/settings/sessions', label: 'Sessions' },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="page-shell">
          <PageHeading
            eyebrow="Account"
            title="Settings"
            description="Manage your profile, sign-in security and the devices signed in to your account."
          />
          <nav className="subnav" aria-label="Settings">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="nav-link"
                aria-current={pathname === link.href ? 'page' : undefined}
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
