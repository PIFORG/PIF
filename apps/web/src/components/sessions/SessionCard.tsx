'use client';

import type { AuthSession } from '@/lib/api/types';
import { describeDevice } from '@/lib/format/device';
import styles from './SessionCard.module.css';

interface SessionCardProps {
  session: AuthSession;
  onRevoke?: (id: string) => void;
  busy?: boolean;
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function SessionCard({ session, onRevoke, busy }: SessionCardProps) {
  const label = describeDevice(session.deviceLabel, session.userAgent);
  const raw = session.userAgent || session.deviceLabel || undefined;

  return (
    <article className={styles.card} aria-label={label}>
      <div className={styles.head}>
        <h3 className={styles.title} title={raw}>
          {label}
        </h3>
        {session.current ? (
          <span className="badge badge-active">This device</span>
        ) : null}
      </div>
      <dl className={styles.meta}>
        <div>
          <dt>Last seen</dt>
          <dd>{formatDate(session.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(session.createdAt)}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{formatDate(session.expiresAt)}</dd>
        </div>
      </dl>
      {!session.current && onRevoke ? (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => onRevoke(session.id)}
        >
          Revoke session
        </button>
      ) : null}
    </article>
  );
}
