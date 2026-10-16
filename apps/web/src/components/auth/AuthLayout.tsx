import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/brand/BrandMark';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import styles from './AuthLayout.module.css';

interface AuthLayoutProps {
  title: string;
  lead?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

const ASSURANCES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'lock', title: 'Protected sign-in', body: 'Optional authenticator-app MFA with one-time recovery codes.' },
  { icon: 'sessions', title: 'You control every device', body: 'Review and sign out of sessions from your account settings.' },
  { icon: 'flask', title: 'Simulation only', body: 'Virtual capital and simulated markets. No real money is ever at risk.' },
];

/** Decorative market-grid illustration; carries no data. */
function AuthIllustration() {
  const candles = [
    [30, 52, 40, 60],
    [40, 58, 36, 62],
    [36, 46, 30, 52],
    [46, 64, 42, 70],
    [60, 54, 50, 66],
    [54, 72, 50, 78],
    [70, 82, 64, 88],
    [80, 74, 70, 86],
    [74, 92, 70, 98],
  ];
  return (
    <svg className={styles.illustration} viewBox="0 0 320 120" aria-hidden="true" focusable="false">
      {candles.map(([open, close, low, high], i) => {
        const x = 18 + i * 34;
        const up = close >= open;
        const top = 120 - Math.max(open, close);
        const bottom = 120 - Math.min(open, close);
        return (
          <g key={x} data-up={up ? 'true' : 'false'}>
            <line x1={x} x2={x} y1={120 - high} y2={120 - low} />
            <rect x={x - 7} y={top} width="14" height={Math.max(bottom - top, 2)} rx="2" />
          </g>
        );
      })}
      <path d="M18 74 L52 66 L86 78 L120 60 L154 58 L188 46 L222 34 L256 40 L290 26" className={styles.trend} />
    </svg>
  );
}

export function AuthLayout({ title, lead, children, footer }: AuthLayoutProps) {
  return (
    <div className={styles.shell}>
      <aside className={styles.brandPane} aria-label="About Market Trading Room Simulator">
        <Link href="/" className={styles.brandLink} aria-label="Market Trading Room Simulator — home">
          <BrandLockup size={34} />
        </Link>

        <div className={styles.statement}>
          <p className={styles.headline}>
            Financial markets, <span>without the real-world risk.</span>
          </p>
          <p className={styles.tagline}>
            Practise trading, portfolio construction and risk analysis in a simulated market room built for learning.
          </p>
          <AuthIllustration />
        </div>

        <ul className={styles.assurances}>
          {ASSURANCES.map((item) => (
            <li key={item.title}>
              <span className={styles.assuranceIcon}>
                <Icon name={item.icon} size={16} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <main className={styles.formPane} id="main-content">
        <div className={styles.formTop}>
          <Link href="/" className={styles.mobileBrand} aria-label="Market Trading Room Simulator — home">
            <BrandLockup size={28} />
          </Link>
          <ThemeToggle />
        </div>
        <div className={styles.formInner}>
          <h1 className={styles.formTitle}>{title}</h1>
          {lead ? <p className={styles.formLead}>{lead}</p> : null}
          {children}
          {footer ? <div className={styles.footerLinks}>{footer}</div> : null}
        </div>
        <p className={styles.legal}>Educational simulation. Not investment advice.</p>
      </main>
    </div>
  );
}
