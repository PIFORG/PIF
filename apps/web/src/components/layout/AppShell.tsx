'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandLockup } from '@/components/brand/BrandMark';
import { ProfileDropdown } from '@/components/layout/ProfileDropdown';
import { Icon } from '@/components/ui/Icon';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { fetchServiceHealth, type ServiceHealth } from '@/lib/api/health';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  findNavItem,
  isItemActive,
  MOBILE_PRIMARY,
  navForRole,
  STATUS_LABEL,
  type NavGroup,
} from '@/lib/navigation/workspaceNav';
import styles from './AppShell.module.css';

const COLLAPSE_KEY = 'mtrs-sidebar-collapsed';

function NavGroups({
  groups,
  pathname,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.id} className={styles.group}>
          <p className={styles.groupLabel} id={`nav-${group.id}`}>
            {group.label}
          </p>
          <ul className={styles.list} aria-labelledby={`nav-${group.id}`}>
            {group.items.map((item) => {
              const active = isItemActive(item, pathname);
              const pending = item.status !== 'LIVE_INTEGRATED';
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={styles.link}
                    aria-current={active ? 'page' : undefined}
                    title={pending ? `${item.label} — ${STATUS_LABEL[item.status].toLowerCase()}, backend pending` : collapsed ? item.label : undefined}
                    onClick={onNavigate}
                  >
                    <Icon name={item.icon} className={styles.linkIcon} />
                    <span className={styles.linkLabel}>{item.label}</span>
                    {pending ? (
                      <span className={styles.preview}>
                        <Icon name="clock" size={12} />
                        <span className="sr-only">{STATUS_LABEL[item.status]} — backend not available yet</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

function useServiceHealth(): ServiceHealth | null {
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () => fetchServiceHealth().then((h) => !cancelled && setHealth(h));
    void check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return health;
}

const HEALTH_TEXT: Record<ServiceHealth, string> = {
  online: 'Services online',
  degraded: 'Database unavailable',
  offline: 'API unreachable',
};

function ClockChip({ timeZone }: { timeZone?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!now) return null;
  let text: string;
  try {
    text = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(now);
  } catch {
    text = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(now);
  }
  return (
    <span className={`${styles.chip} ${styles.clock} num`} title={timeZone ? `Your time zone: ${timeZone}` : 'Device time'}>
      <Icon name="clock" size={14} />
      <time dateTime={now.toISOString()}>{text}</time>
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const health = useServiceHealth();
  const groups = navForRole(user?.role);
  const location = findNavItem(pathname);

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === 'true');
    } catch {
      // Preference unavailable; keep the expanded sidebar.
    }
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab' || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('a, button'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        // Not persisted.
      }
      return next;
    });
  }

  const mobileItems = groups
    .flatMap((group) => group.items)
    .filter((item) => MOBILE_PRIMARY.includes(item.href));

  return (
    <div className={styles.shell} data-collapsed={collapsed ? 'true' : 'false'}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <aside className={styles.sidebar} aria-label="Workspace">
        <div className={styles.sidebarTop}>
          <Link href="/dashboard" className={styles.brand} aria-label="Market Trading Room — Overview">
            <BrandLockup compact={collapsed} size={30} />
          </Link>
        </div>
        <nav className={styles.nav} aria-label="Primary">
          <NavGroups groups={groups} pathname={pathname} collapsed={collapsed} />
        </nav>
        <div className={styles.sidebarFoot}>
          {collapsed ? null : (
            <>
              <p className={styles.sidebarLegend} aria-hidden="true">
                <span className={styles.preview}>
                  <Icon name="clock" size={11} />
                </span>
                Preview — backend pending
              </p>
              <p className={styles.footNote}>
                <Icon name="lock" size={14} /> Simulated environment. No real money or real orders.
              </p>
            </>
          )}
          <button
            type="button"
            className={styles.collapse}
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={16} />
            {collapsed ? null : <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className={styles.column}>
        <header className={styles.topbar}>
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuButton}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="workspace-drawer"
          >
            <Icon name="menu" />
          </button>
          <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
            <ol>
              <li>{location?.group.label ?? 'Workspace'}</li>
              <li aria-current="page">{location?.item.label ?? 'Overview'}</li>
            </ol>
          </nav>
          <div className={styles.topActions}>
            <span className={`${styles.chip} ${styles.env}`} title="All trading and portfolio activity is simulated">
              Simulated
            </span>
            {health ? (
              <span className={styles.chip} data-health={health} role="status">
                <span className={styles.dot} aria-hidden />
                <span className={styles.healthText}>{HEALTH_TEXT[health]}</span>
              </span>
            ) : null}
            <ClockChip timeZone={user?.preferences?.timezone} />
            <ThemeToggle />
            <ProfileDropdown />
          </div>
        </header>

        <main id="main-content" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>

      {drawerOpen ? (
        <div className={styles.drawerLayer}>
          <button
            type="button"
            className={styles.drawerBackdrop}
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            id="workspace-drawer"
            ref={drawerRef}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className={styles.drawerHead}>
              <BrandLockup size={28} />
              <button
                type="button"
                className={styles.menuButton}
                onClick={() => {
                  setDrawerOpen(false);
                  menuButtonRef.current?.focus();
                }}
                aria-label="Close navigation"
              >
                <Icon name="close" />
              </button>
            </div>
            <nav aria-label="Primary (mobile)" className={styles.nav}>
              <NavGroups groups={groups} pathname={pathname} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
            </nav>
          </div>
        </div>
      ) : null}

      <nav className={styles.bottomNav} aria-label="Quick navigation">
        {mobileItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.bottomLink}
            aria-current={isItemActive(item, pathname) ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
