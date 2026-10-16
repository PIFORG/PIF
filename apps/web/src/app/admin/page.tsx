'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FormError } from '@/components/auth/FormError';
import * as adminApi from '@/lib/api/admin';
import { describeApiError } from '@/lib/api/errors';
import type { AdminOverview } from '@/lib/api/types';

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const overview = await adminApi.fetchAdminOverview();
        if (!cancelled) setData(overview);
      } catch (err) {
        if (!cancelled) {
          setError(describeApiError(err, 'Unable to load admin overview.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tiles: { label: string; value: number | undefined }[] = [
    { label: 'Total users', value: data?.users.total },
    { label: 'Active', value: data?.users.active },
    { label: 'Pending verification', value: data?.users.pending },
    { label: 'Suspended', value: data?.users.suspended },
    { label: 'Deactivated', value: data?.users.deactivated },
    { label: 'Verified emails', value: data?.users.verified },
    { label: 'Two-step verification on', value: data?.users.mfaEnabled },
  ];

  return (
    <section aria-labelledby="admin-overview-heading">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h2 id="admin-overview-heading" style={{ marginBottom: '0.35rem' }}>
            Platform overview
          </h2>
          <p style={{ margin: 0 }}>Live account metrics from the identity API.</p>
        </div>
        <Link href="/admin/users" className="btn btn-secondary">
          Manage users
        </Link>
      </div>

      <FormError message={error} />
      {loading ? <p role="status">Loading overview…</p> : null}

      {!loading && data ? (
        <>
          <div className="grid-stats">
            {tiles.map((tile) => (
              <article key={tile.label} className="stat-tile">
                <div className="label">{tile.label}</div>
                <div className="value">{tile.value ?? '—'}</div>
              </article>
            ))}
          </div>
          {data.eventTotals.items.length ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h3>Events in the last {data.eventTotals.windowDays} days</h3>
              <ul>
                {data.eventTotals.items.slice(0, 12).map((item) => (
                  <li key={`${item.eventType}-${item.outcome}`}>
                    {item.eventType} · {item.outcome} · {item.count}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section style={{ marginTop: '1.5rem' }}>
            <h3>Recent security events</h3>
            {data.recentEvents.length === 0 ? (
              <p>No recent events.</p>
            ) : (
              <ul>
                {data.recentEvents.map((event) => (
                  <li key={event.id}>
                    {event.eventType} · {event.outcome} ·{' '}
                    {new Date(event.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
