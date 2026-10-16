'use client';

import { useCallback, useEffect, useState } from 'react';
import { FormError } from '@/components/auth/FormError';
import { AdminUserTable } from '@/components/admin/AdminUserTable';
import * as adminApi from '@/lib/api/admin';
import { describeApiError } from '@/lib/api/errors';
import type { PaginatedUsers, UserRole, UserStatus } from '@/lib/api/types';

const SEARCH_DEBOUNCE_MS = 350;

export default function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [emailVerified, setEmailVerified] = useState<'true' | 'false' | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedUsers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = q.trim();
      setAppliedQ((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.fetchAdminUsers({
        q: appliedQ || undefined,
        status,
        role,
        emailVerified,
        page,
        pageSize: 20,
      });
      setData(result);
    } catch (err) {
      setError(describeApiError(err, 'Unable to load users.'));
    } finally {
      setLoading(false);
    }
  }, [appliedQ, status, role, emailVerified, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section aria-labelledby="admin-users-heading">
      <h2 id="admin-users-heading" style={{ marginBottom: '0.35rem' }}>
        User accounts
      </h2>
      <p style={{ marginTop: 0 }}>Search, filter and open accounts for administrative actions.</p>

      <form
        className="toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQ(q.trim());
          setPage(1);
        }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}
      >
        <label className="field" style={{ flex: '1 1 200px' }}>
          <span className="sr-only">Search name or email</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email"
            maxLength={120}
          />
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as UserStatus | '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_VERIFICATION">Pending verification</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DEACTIVATED">Deactivated</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by role</span>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as UserRole | '');
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            <option value="INVESTOR">Investor</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by email verification</span>
          <select
            value={emailVerified}
            onChange={(e) => {
              setEmailVerified(e.target.value as 'true' | 'false' | '');
              setPage(1);
            }}
          >
            <option value="">Any verification</option>
            <option value="true">Email verified</option>
            <option value="false">Email not verified</option>
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      <FormError message={error} />
      <div aria-live="polite" aria-busy={loading}>
        {loading ? <p role="status">Loading users…</p> : null}
        {!loading && data ? <AdminUserTable users={data.items} /> : null}
        {!loading && data && data.total === 0 ? <p>No accounts match these filters.</p> : null}
      </div>

      {!loading && data && data.total > 0 ? (
        <nav
          aria-label="Pagination"
          style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages} ({data.total} total)
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
