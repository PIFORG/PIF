import { useId } from 'react';
import styles from './BrandMark.module.css';

interface EmblemProps {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Original Market Trading Room emblem: a rounded geometric shield holding two volume
 * columns and a market line that traces an "M", ending on an amber data point.
 * Self-contained colours so it reads on dark and light surfaces from 20 px to 200 px.
 */
export function MtrsEmblem({ size = 32, className, title }: EmblemProps) {
  const gradientId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#13305a" />
          <stop offset="1" stopColor="#081322" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${gradientId})`} />
      <rect x="2.75" y="2.75" width="42.5" height="42.5" rx="11.25" fill="none" stroke="#3b82f6" strokeOpacity="0.55" strokeWidth="1.5" />
      <rect x="13" y="24" width="5" height="12" rx="1.25" fill="#3b82f6" fillOpacity="0.45" />
      <rect x="29" y="20" width="5" height="16" rx="1.25" fill="#3b82f6" fillOpacity="0.45" />
      <path d="M9.5 33 L16 17.5 L23.5 27 L31.5 13.5 L37.5 21" fill="none" stroke="#7fc8ff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="37.5" cy="21" r="2.9" fill="#f5b544" />
    </svg>
  );
}

interface LockupProps {
  /** Hide the descriptor line, e.g. in a collapsed sidebar. */
  compact?: boolean;
  size?: number;
}

export function BrandLockup({ compact = false, size = 32 }: LockupProps) {
  return (
    <span className={styles.lockup}>
      <MtrsEmblem size={size} />
      {compact ? null : (
        <span className={styles.words}>
          <span className={styles.name}>Market Trading Room</span>
          <span className={styles.descriptor}>Simulator</span>
        </span>
      )}
    </span>
  );
}
