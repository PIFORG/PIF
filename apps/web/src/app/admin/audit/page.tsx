'use client';

import { useCallback, useEffect, useState } from 'react';
import { FormError } from '@/components/auth/FormError';
import * as adminApi from '@/lib/api/admin';
import { describeApiError } from '@/lib/api/errors';
import type { PaginatedAuditEvents } from '@/lib/api/types';

type Filters = {
  eventType: string;
  outcome: '' | 'SUCCESS' | 'FAILURE' | 'DENIED';
  subjectUserId: string;
  fromDate: string;
  toDate: string;
};

const EMPTY: Filters = { eventType: '', outcome: '', subjectUserId: '', fromDate: '', toDate: '' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIsoBoundary(date: string, endOfDay: boolean): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

function formatContext(context: Record<string, unknown> | null): string {
  if (!context) return '—';
  return Object.entries(context)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(', ');
}

export default function AdminAuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedAuditEvents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await adminApi.fetchAuditEvents({
          eventType: applied.eventType || undefined,
          outcome: applied.outcome,
          subjectUserId: applied.subjectUserId || undefined,
          from: toIsoBoundary(applied.fromDate, false),
          to: toIsoBoundary(applied.toDate, true),
          page,
          pageSize: 25,
        }),
      );
    } catch (err) {
      setError(describeApiError(err, 'Unable to load audit events.'));
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const eventType = draft.eventType.trim().toUpperCase();
    const subjectUserId = draft.subjectUserId.trim();
    if (eventType && !/^[A-Z][A-Z0-9_]{0,79}$/.test(eventType)) {
      setError('Event types use capital letters and underscores, e.g. LOGIN_FAILURE.');
      return;
    }
    if (subjectUserId && !UUID.test(subjectUserId)) {
      setError('Account ID must be a full UUID.');
      return;
    }
    if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
      setError('The start date must be before the end date.');
      return;
    }
    setPage(1);
    setApplied({ ...draft, eventType, subjectUserId });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section aria-labelledby="audit-heading">
      <h2 id="audit-heading" style={{ marginBottom: '0.35rem' }}>
        Audit log
      </h2>
      <p style={{ marginTop: 0 }}>
        Security and administration events, newest first. Personal details recorded with an
        event are not shown here.
      </p>

      <form
        onSubmit={apply}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1rem' }}
      >
        <label className="field">
          <span>Event type</span>
          <input
            value={draft.eventType}
            onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}
            placeholder="e.g. LOGIN_FAILURE"
            maxLength={80}
          />
        </label>
        <label className="field">
          <span>Outcome</span>
          <select
            value={draft.outcome}
            onChange={(e) => setDraft({ ...draft, outcome: e.target.value as Filters['outcome'] })}
          >
            <option value="">Any</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
            <option value="DENIED">Denied</option>
          </select>
        </label>
        <label className="field">
          <span>Account ID</span>
          <input
            value={draft.subjectUserId}
            onChange={(e) => setDraft({ ...draft, subjectUserId: e.target.value })}
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={draft.fromDate} onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={draft.toDate} onChange={(e) => setDraft({ ...draft, toDate: e.target.value })} />
        </label>
        <button type="submit" className="btn btn-secondary">
          Apply filters
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setDraft(EMPTY);
            setApplied(EMPTY);
            setPage(1);
          }}
        >
          Clear
        </button>
      </form>

      <FormError message={error} />
      <div aria-live="polite" aria-busy={loading}>
        {loading ? <p role="status">Loading events…</p> : null}
        {!loading && data && data.items.length === 0 ? <p>No events match these filters.</p> : null}
        {!loading && data && data.items.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <caption className="sr-only">Audit events</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Event</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Account</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Details</th>
                  <th scope="col">Correlation ID</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{event.eventType}</td>
                    <td>{event.outcome}</td>
                    <td>
                      <code>{event.subjectUserId ?? '—'}</code>
                    </td>
                    <td>
                      <code>{event.actorUserId ?? '—'}</code>
                    </td>
                    <td>{formatContext(event.context)}</td>
                    <td>
                      <code>{event.correlationId ?? '—'}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {!loading && data && data.total > 0 ? (
        <nav aria-label="Pagination" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages} ({data.total} events)
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
