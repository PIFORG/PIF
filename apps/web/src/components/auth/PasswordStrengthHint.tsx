'use client';

import { passwordStrength } from '@/lib/validation/schemas';
import styles from './PasswordStrengthHint.module.css';

export function PasswordStrengthHint({ password }: { password: string }) {
  if (!password) return null;
  const { score, label } = passwordStrength(password);
  const pct = Math.max(12, (score / 5) * 100);

  return (
    <div className={styles.wrap} aria-live="polite">
      <div className={styles.track} aria-hidden>
        <div
          className={styles.fill}
          style={{ width: `${pct}%` }}
          data-score={score}
        />
      </div>
      <p className={styles.label}>
        Strength: <strong>{label}</strong>
      </p>
    </div>
  );
}
