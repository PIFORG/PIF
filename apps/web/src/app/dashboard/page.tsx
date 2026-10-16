'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AllocationBar, LineChart, Sparkline } from '@/components/charts/Charts';
import { AccountStatusBadge } from '@/components/layout/AccountStatusBadge';
import { AppShell } from '@/components/layout/AppShell';
import { Icon, type IconName } from '@/components/ui/Icon';
import {
  Change,
  DemoModeLabel,
  EmptyState,
  KpiCard,
  PageHeading,
  Panel,
  PanelSkeleton,
  StatusBadge,
} from '@/components/workspace/primitives';
import { describeApiError } from '@/lib/api/errors';
import * as sessionsApi from '@/lib/api/sessions';
import type { AuthSession, DashboardContext, DashboardModule, User } from '@/lib/api/types';
import * as usersApi from '@/lib/api/users';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  SAMPLE_CURRENCY,
  SAMPLE_DATA_NOTICE,
  sampleAllocation,
  sampleBenchmarkCurve,
  sampleEquityCurve,
  sampleMarketValue,
  samplePositions,
  sampleRisk,
  sampleSummary,
  sampleUnrealised,
  sampleWatchlist,
} from '@/lib/demo/sampleWorkspace';
import { describeDevice } from '@/lib/format/device';
import { formatDateTime, formatMoney, formatNumber, formatPercent } from '@/lib/format/finance';
import styles from './dashboard.module.css';

function greetingForHour(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const MODULE_ROUTES: Record<string, { href: string; icon: IconName; blurb: string }> = {
  portfolio: { href: '/portfolios', icon: 'portfolio', blurb: 'Virtual portfolios, positions and performance.' },
  orders: { href: '/trading', icon: 'trading', blurb: 'Simulated order entry and execution history.' },
  learning: { href: '/learn', icon: 'academy', blurb: 'Guided lessons, quizzes and progress.' },
  ai: { href: '/ai', icon: 'ai', blurb: 'Model insights with confidence and limitations.' },
  stress: { href: '/stress-testing', icon: 'bank', blurb: 'Shock scenarios on a sample bank balance sheet.' },
  actuarial: { href: '/actuarial', icon: 'actuarial', blurb: 'Mortality, reserves and premium pricing.' },
  admin: { href: '/admin', icon: 'platform', blurb: 'Users, roles and the security audit log.' },
};

const EXPERIENCE_LABEL: Record<User['experienceLevel'], string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
};

function PendingValue() {
  return (
    <span className={styles.pendingValue}>
      —<span className="sr-only">not available yet</span>
    </span>
  );
}

function ReadinessPanel({ user }: { user: User }) {
  const items = [
    {
      done: user.emailVerified,
      title: 'Verify your email',
      detail: user.emailVerified ? `Verified · ${user.email}` : 'Required to unlock all account capabilities.',
      href: '/resend-verification',
      action: 'Resend link',
    },
    {
      done: user.mfaEnabled,
      title: 'Turn on two-step verification',
      detail: user.mfaEnabled ? 'Authenticator app enabled.' : 'Protect sign-in with an authenticator app.',
      href: '/settings/security',
      action: 'Set up',
    },
    {
      done: !!user.preferences,
      title: 'Display preferences',
      detail: user.preferences
        ? `${user.preferences.preferredCurrency} · ${user.preferences.timezone}`
        : 'Choose your currency and time zone.',
      href: '/settings/profile',
      action: 'Review',
    },
  ];
  const completed = items.filter((i) => i.done).length;

  return (
    <Panel
      id="readiness"
      title="Account readiness"
      description="Live from your account."
      badge={<StatusBadge status="LIVE_INTEGRATED" />}
    >
      <div className={styles.progress}>
        <div className={styles.progressTrack}>
          <span style={{ width: `${(completed / items.length) * 100}%` }} />
        </div>
        <span className="num">
          {completed} of {items.length} complete
        </span>
      </div>
      <ul className={styles.checklist}>
        {items.map((item) => (
          <li key={item.title} data-done={item.done ? 'true' : 'false'}>
            <span className={styles.checkIcon}>
              <Icon name={item.done ? 'check' : 'alert'} size={14} />
            </span>
            <span className={styles.checkText}>
              <strong>
                {item.title}
                <span className="sr-only">{item.done ? ' — done' : ' — to do'}</span>
              </strong>
              <span>{item.detail}</span>
            </span>
            {!item.done ? (
              <Link href={item.href} className="btn btn-secondary btn-sm">
                {item.action}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SessionsPanel({ sessions, error, timeZone }: { sessions: AuthSession[] | null; error: string | null; timeZone?: string }) {
  return (
    <Panel
      id="devices"
      title="Signed-in devices"
      badge={<StatusBadge status="LIVE_INTEGRATED" />}
      actions={
        <Link href="/settings/sessions" className="btn btn-ghost btn-sm">
          Manage
        </Link>
      }
    >
      {error ? (
        <EmptyState tone="error" title="Sessions unavailable" description={error} />
      ) : !sessions ? (
        <PanelSkeleton rows={3} />
      ) : sessions.length === 0 ? (
        <EmptyState icon="sessions" title="No active sessions" />
      ) : (
        <ul className={styles.sessionList}>
          {sessions.slice(0, 3).map((s) => (
            <li key={s.id}>
              <span className={styles.sessionIcon}>
                <Icon name="sessions" size={16} />
              </span>
              <span className={styles.sessionText}>
                <strong title={s.userAgent ?? undefined}>{describeDevice(s.deviceLabel, s.userAgent)}</strong>
                <span>Last active {formatDateTime(s.lastSeenAt, timeZone)}</span>
              </span>
              {s.current ? <span className="badge badge-info">This device</span> : null}
            </li>
          ))}
          {sessions.length > 3 ? (
            <li className={styles.sessionMore}>
              +{sessions.length - 3} more · <Link href="/settings/sessions">view all</Link>
            </li>
          ) : null}
        </ul>
      )}
    </Panel>
  );
}

function ModulesPanel({ context, error, user }: { context: DashboardContext | null; error: string | null; user: User }) {
  const modules = context?.modules.filter((m) => m.id !== 'admin' || user.role === 'ADMIN') ?? [];
  return (
    <Panel
      id="modules"
      title="Workstation modules"
      description="Availability comes from the platform. Preview modules open their designed screen and explain what is pending."
    >
      {error ? (
        <EmptyState tone="error" title="Modules unavailable" description={error} />
      ) : !context ? (
        <PanelSkeleton rows={4} />
      ) : (
        <ul className={styles.modules}>
          {modules.map((mod: DashboardModule) => {
            const route = MODULE_ROUTES[mod.id];
            const status = mod.available ? 'LIVE_INTEGRATED' : 'DESIGNED_PENDING_BACKEND';
            const body = (
              <>
                <span className={styles.moduleIcon}>
                  <Icon name={route?.icon ?? 'overview'} size={18} />
                </span>
                <span className={styles.moduleText}>
                  <strong>{mod.label}</strong>
                  <span>{route?.blurb ?? 'Module details coming soon.'}</span>
                </span>
                {mod.permitted ? (
                  <StatusBadge status={status} />
                ) : (
                  <span className="badge badge-muted">
                    <Icon name="lock" size={12} /> Not permitted
                  </span>
                )}
              </>
            );
            return (
              <li key={mod.id}>
                {mod.permitted && route ? (
                  <Link href={route.href} className={styles.module}>
                    {body}
                  </Link>
                ) : (
                  <div className={styles.module} aria-disabled="true" title="Your role does not include this module.">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  const [context, setContext] = useState<DashboardContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sample, setSample] = useState(false);

  useEffect(() => {
    let cancelled = false;
    usersApi
      .fetchDashboardContext()
      .then((ctx) => !cancelled && setContext(ctx))
      .catch((err) => !cancelled && setError(describeApiError(err, 'Unable to load your workspace.')));
    return () => {
      cancelled = true;
    };
  }, [user?.role, user?.mfaEnabled]);

  useEffect(() => {
    let cancelled = false;
    sessionsApi
      .listSessions()
      .then((list) => !cancelled && setSessions(list))
      .catch((err) => !cancelled && setSessionsError(describeApiError(err, 'Unable to load your sessions.')));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  const summary = sampleSummary();
  const timeZone = user.preferences?.timezone;

  return (
    <AppShell>
      <div className="page-shell">
        <PageHeading
          eyebrow={greetingForHour()}
          title={`Welcome back, ${user.firstName}`}
          description={
            <span className={styles.identity}>
              <AccountStatusBadge status={user.status} />
              <span className="badge badge-muted">{user.role === 'ADMIN' ? 'Administrator' : 'Investor'}</span>
              <span className="badge badge-muted">{EXPERIENCE_LABEL[user.experienceLevel]}</span>
              {context?.experienceLevelNotice ? <span>{context.experienceLevelNotice}</span> : null}
            </span>
          }
          actions={
            <button
              type="button"
              className={sample ? 'btn btn-secondary' : 'btn btn-primary'}
              aria-pressed={sample}
              onClick={() => setSample((v) => !v)}
            >
              <Icon name="flask" size={16} />
              {sample ? 'Exit sample workspace' : 'Explore sample workspace'}
            </button>
          }
        />

        {!user.emailVerified ? (
          <div className="form-error-banner" role="status">
            Verify your email to unlock full account capabilities. <Link href="/resend-verification">Resend verification</Link>
          </div>
        ) : null}

        {context?.requiredActions.includes('ENROLL_MFA_FOR_ADMIN') ? (
          <div className="form-error-banner" role="status">
            Administrator tools are locked until you turn on two-step verification.{' '}
            <Link href="/settings/security">Set it up now</Link>
          </div>
        ) : null}

        {sample ? (
          <div className={styles.sampleBanner} role="status">
            <DemoModeLabel>Sample workspace</DemoModeLabel>
            <p>{SAMPLE_DATA_NOTICE}</p>
          </div>
        ) : null}

        <div className={styles.kpis}>
          <KpiCard
            label="Simulated portfolio value"
            icon="portfolio"
            value={sample ? formatMoney(summary.equity, SAMPLE_CURRENCY) : <PendingValue />}
            change={sample ? <Change value={summary.totalReturnPct} /> : undefined}
            hint={sample ? 'since start · sample' : 'Portfolio engine not connected'}
          />
          <KpiCard
            label="Day change"
            icon="markets"
            tone={sample ? (summary.dayChange >= 0 ? 'positive' : 'negative') : 'default'}
            value={sample ? <Change value={summary.dayChange} kind="money" currency={SAMPLE_CURRENCY} /> : <PendingValue />}
            change={sample ? <Change value={summary.dayChangePct} /> : undefined}
            hint={sample ? 'sample' : 'No simulated positions yet'}
          />
          <KpiCard
            label="1-day VaR (95%)"
            icon="risk"
            tone={sample ? 'warning' : 'default'}
            value={sample ? formatPercent(sampleRisk.var95) : <PendingValue />}
            hint={sample ? `Volatility ${formatPercent(sampleRisk.annualVolatility, { digits: 1 })} · sample` : 'Risk engine not connected'}
          />
          <KpiCard
            label="Active sessions"
            icon="sessions"
            value={sessions ? String(sessions.length) : sessionsError ? <PendingValue /> : <span className="skeleton" style={{ height: 24, width: 40 }} />}
            hint={
              <>
                Live ·{' '}
                {user.mfaEnabled ? 'two-step verification on' : <Link href="/settings/security">enable two-step</Link>}
              </>
            }
          />
        </div>

        <div className={styles.layout}>
          <div className={styles.mainCol}>
            <Panel
              id="performance"
              title="Performance"
              description={sample ? 'Sample portfolio against a sample benchmark, 64 sessions.' : 'Your simulated equity curve.'}
              badge={sample ? <DemoModeLabel /> : <StatusBadge status="DESIGNED_PENDING_BACKEND" />}
              demo={sample}
            >
              {sample ? (
                <LineChart
                  height={240}
                  summary={`Sample data. Fictitious portfolio rises from ${formatMoney(sampleEquityCurve[0].value, SAMPLE_CURRENCY)} to ${formatMoney(summary.equity, SAMPLE_CURRENCY)} over 64 sessions, ahead of a fictitious benchmark.`}
                  formatY={(v) => formatMoney(v, SAMPLE_CURRENCY, { compact: true })}
                  xLabels={['Session 1', 'Session 64']}
                  series={[
                    { label: 'Sample portfolio', values: sampleEquityCurve.map((p) => p.value), tone: 'brand', area: true },
                    { label: 'Sample benchmark', values: sampleBenchmarkCurve.map((p) => p.value), tone: 'muted', dashed: true },
                  ]}
                />
              ) : (
                <EmptyState
                  icon="markets"
                  title="No simulated portfolio yet"
                  description="Your equity curve will appear here once the portfolio engine is connected. Explore the sample workspace to see how this screen works."
                  action={
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSample(true)}>
                      <Icon name="flask" size={14} /> Show sample workspace
                    </button>
                  }
                />
              )}
            </Panel>

            <div className={styles.twoUp}>
              <Panel
                id="watchlist"
                title="Watchlist"
                badge={sample ? <DemoModeLabel /> : undefined}
                demo={sample}
                actions={
                  <Link href="/markets" className="btn btn-ghost btn-sm">
                    Markets
                  </Link>
                }
              >
                {sample ? (
                  <table className={`data-table ${styles.compactTable}`}>
                    <caption className="sr-only">Sample watchlist of fictitious instruments</caption>
                    <thead>
                      <tr>
                        <th scope="col">Symbol</th>
                        <th scope="col">Trend</th>
                        <th scope="col" className="num">
                          Last
                        </th>
                        <th scope="col" className="num">
                          Change
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleWatchlist.map((q) => (
                        <tr key={q.symbol}>
                          <td>
                            <span className="mono">{q.symbol}</span>
                          </td>
                          <td>
                            <Sparkline values={q.spark} width={72} height={22} label={`${q.symbol} sample trend`} />
                          </td>
                          <td className="num">{formatNumber(q.last)}</td>
                          <td className="num">
                            <Change value={q.change} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyState icon="markets" title="Market data not connected" description="Quotes appear when the market data service is available." />
                )}
              </Panel>

              <Panel id="allocation" title="Allocation" badge={sample ? <DemoModeLabel /> : undefined} demo={sample}>
                {sample ? (
                  <AllocationBar items={sampleAllocation} label="Sample allocation by asset class" />
                ) : (
                  <EmptyState icon="portfolio" title="No allocation yet" description="Asset-class weights appear once you hold simulated positions." />
                )}
              </Panel>
            </div>
          </div>

          <div className={styles.sideCol}>
            <ReadinessPanel user={user} />
            <SessionsPanel sessions={sessions} error={sessionsError} timeZone={timeZone} />
            <Panel id="learning" title="Learning path" badge={<StatusBadge status="DESIGNED_PENDING_BACKEND" />}>
              <EmptyState
                icon="academy"
                title="Academy content is on its way"
                description={`Lessons will be tailored to your ${EXPERIENCE_LABEL[user.experienceLevel].toLowerCase()} level.`}
                action={
                  <Link href="/learn" className="btn btn-ghost btn-sm">
                    Preview the Academy
                  </Link>
                }
              />
            </Panel>
          </div>
        </div>

        {sample ? (
          <Panel id="positions" title="Positions" badge={<DemoModeLabel />} demo className={styles.fullWidth}>
            <div className="table-wrap">
              <table className="data-table">
                <caption className="sr-only">Sample positions in fictitious instruments</caption>
                <thead>
                  <tr>
                    <th scope="col">Instrument</th>
                    <th scope="col">Class</th>
                    <th scope="col" className="num">
                      Qty
                    </th>
                    <th scope="col" className="num">
                      Avg price
                    </th>
                    <th scope="col" className="num">
                      Last
                    </th>
                    <th scope="col" className="num">
                      Market value
                    </th>
                    <th scope="col" className="num">
                      Unrealised P&amp;L
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {samplePositions.map((p) => (
                    <tr key={p.symbol}>
                      <td>
                        <span className="mono">{p.symbol}</span>{' '}
                        <span className={styles.muted}>{p.name}</span>
                      </td>
                      <td>{p.assetClass}</td>
                      <td className="num">{p.quantity}</td>
                      <td className="num">{formatNumber(p.avgPrice)}</td>
                      <td className="num">{formatNumber(p.lastPrice)}</td>
                      <td className="num">{formatMoney(sampleMarketValue(p), SAMPLE_CURRENCY)}</td>
                      <td className="num">
                        <Change value={sampleUnrealised(p)} kind="money" currency={SAMPLE_CURRENCY} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}

        <ModulesPanel context={context} error={error} user={user} />
      </div>
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
