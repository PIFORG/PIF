import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { directionOf, formatPercent, formatSignedMoney } from '@/lib/format/finance';
import { STATUS_LABEL, type RouteStatus } from '@/lib/navigation/workspaceNav';
import styles from './workspace.module.css';

/* ---------- Page heading ---------- */

interface PageHeadingProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  status?: RouteStatus;
  actions?: ReactNode;
}

export function PageHeading({ eyebrow, title, description, status, actions }: PageHeadingProps) {
  return (
    <header className={styles.heading}>
      <div className={styles.headingText}>
        {eyebrow || status ? (
          <div className={styles.headingMeta}>
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            {status ? <StatusBadge status={status} /> : null}
          </div>
        ) : null}
        <h1 className={styles.title}>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.headingActions}>{actions}</div> : null}
    </header>
  );
}

/* ---------- Status / data-source labels ---------- */

const STATUS_ICON: Record<RouteStatus, IconName> = {
  LIVE_INTEGRATED: 'check',
  DEMO_EXPLICITLY_LABELLED: 'flask',
  DESIGNED_PENDING_BACKEND: 'clock',
};

const STATUS_TITLE: Record<RouteStatus, string> = {
  LIVE_INTEGRATED: 'Connected to the MTRS API',
  DEMO_EXPLICITLY_LABELLED: 'Shows labelled sample data only',
  DESIGNED_PENDING_BACKEND: 'Designed screen; the backend for this module is not available yet',
};

export function StatusBadge({ status }: { status: RouteStatus }) {
  return (
    <span className={styles.status} data-status={status} title={STATUS_TITLE[status]}>
      <Icon name={STATUS_ICON[status]} size={12} />
      {status === 'DESIGNED_PENDING_BACKEND' ? 'Preview · backend pending' : STATUS_LABEL[status]}
    </span>
  );
}

/** Marks any surface that renders sample fixtures. Always visible, never colour-only. */
export function DemoModeLabel({ children = 'Sample data' }: { children?: ReactNode }) {
  return (
    <span className={styles.demo}>
      <Icon name="flask" size={12} />
      {children}
    </span>
  );
}

/* ---------- Panel ---------- */

interface PanelProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Visually marks the panel as sample content. */
  demo?: boolean;
  id?: string;
}

export function Panel({ title, description, actions, badge, children, className, demo, id }: PanelProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      className={`${styles.panel}${className ? ` ${className}` : ''}`}
      data-demo={demo ? 'true' : undefined}
      aria-labelledby={headingId}
    >
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <div className={styles.panelTitleRow}>
            <h2 className={styles.panelTitle} id={headingId}>
              {title}
            </h2>
            {badge}
          </div>
          {description ? <p className={styles.panelDescription}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.panelActions}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ---------- KPI ---------- */

interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  change?: ReactNode;
  icon?: IconName;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
}

export function KpiCard({ label, value, hint, change, icon, tone = 'default' }: KpiCardProps) {
  return (
    <div className={styles.kpi} data-tone={tone}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiLabel}>{label}</span>
        {icon ? <Icon name={icon} size={16} className={styles.kpiIcon} /> : null}
      </div>
      <div className={styles.kpiValue}>{value}</div>
      {change || hint ? (
        <div className={styles.kpiFoot}>
          {change}
          {hint ? <span className={styles.kpiHint}>{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Signed change (never colour-only) ---------- */

export function Change({ value, kind = 'percent', currency }: { value: number; kind?: 'percent' | 'money'; currency?: string }) {
  const direction = directionOf(value);
  const text = kind === 'percent' ? formatPercent(value, { signed: true }) : formatSignedMoney(value, currency);
  const spoken = direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'unchanged';
  return (
    <span className={`${styles.change} num`} data-direction={direction}>
      {direction === 'flat' ? null : <Icon name={direction === 'up' ? 'arrow-up' : 'arrow-down'} size={12} />}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">
        {spoken} {text.replace(/^[+\u2212]/, '')}
      </span>
    </span>
  );
}

/* ---------- Empty / error states ---------- */

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'error';
}

export function EmptyState({ icon = 'info', title, description, action, tone = 'default' }: EmptyStateProps) {
  return (
    <div className={styles.empty} data-tone={tone} role={tone === 'error' ? 'alert' : undefined}>
      <span className={styles.emptyIcon}>
        <Icon name={tone === 'error' ? 'alert' : icon} size={20} />
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      {description ? <p className={styles.emptyText}>{description}</p> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.skeletonStack} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ height: 14, width: `${88 - i * 14}%` }} />
      ))}
    </div>
  );
}
