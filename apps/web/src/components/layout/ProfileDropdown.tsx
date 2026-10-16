'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import styles from './ProfileDropdown.module.css';

export function ProfileDropdown() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  if (!user) return null;

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(items.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${user.firstName} ${user.lastName}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={styles.avatar} aria-hidden>
          {initials}
        </span>
        <span className={styles.meta}>
          <span className={styles.name}>
            {user.firstName} {user.lastName}
          </span>
          <span className={styles.email}>{user.email}</span>
        </span>
      </button>
      {open ? (
        <div className={styles.menu} role="menu" id={menuId} ref={menuRef} tabIndex={-1} onKeyDown={onMenuKeyDown}>
          <Link href="/settings/profile" role="menuitem" tabIndex={-1} className={styles.item} onClick={() => close(false)}>
            Profile
          </Link>
          <Link href="/settings/security" role="menuitem" tabIndex={-1} className={styles.item} onClick={() => close(false)}>
            Security
          </Link>
          <Link href="/settings/sessions" role="menuitem" tabIndex={-1} className={styles.item} onClick={() => close(false)}>
            Sessions
          </Link>
          {user.role === 'ADMIN' ? (
            <Link href="/admin" role="menuitem" tabIndex={-1} className={styles.item} onClick={() => close(false)}>
              Admin
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`${styles.item} ${styles.danger}`}
            onClick={async () => {
              setOpen(false);
              await logout();
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
