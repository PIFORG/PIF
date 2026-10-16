'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import { StepUpFields, useStepUp } from '@/components/auth/StepUpFields';
import { AccountStatusBadge } from '@/components/layout/AccountStatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import * as adminApi from '@/lib/api/admin';
import { describeApiError } from '@/lib/api/errors';
import type { AdminUserDetail, UserRole, UserStatus } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/AuthProvider';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
};

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user: me } = useAuth();
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [status, setStatus] = useState<UserStatus>('ACTIVE');
  const [reason, setReason] = useState('');
  const [role, setRole] = useState<UserRole>('INVESTOR');
  const [dialog, setDialog] = useState<'status' | 'role' | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stepUp = useStepUp(!!me?.mfaEnabled);
  const isSelf = me?.id === id;

  const apply = useCallback((detail: AdminUserDetail) => {
    setData(detail);
    setStatus(detail.user.status);
    setRole(detail.user.role);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const detail = await adminApi.fetchAdminUser(id);
        if (!cancelled) apply(detail);
      } catch (err) {
        if (!cancelled) setError(describeApiError(err, 'Unable to load this account.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, apply]);

  function openStatusDialog(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (reason.trim().length < 3) {
      setError('Give a reason of at least 3 characters. It is recorded in the audit log.');
      return;
    }
    setDialogError(null);
    setDialog('status');
  }

  function openRoleDialog(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    stepUp.reset();
    setDialogError(null);
    setDialog('role');
  }

  async function confirmStatus() {
    setBusy(true);
    setDialogError(null);
    try {
      const detail = await adminApi.updateAdminUserStatus(id, { status, reason: reason.trim() });
      apply(detail);
      setReason('');
      setDialog(null);
      setSuccess(
        status === 'ACTIVE' && detail.user.status === 'PENDING_VERIFICATION'
          ? 'Account reactivated. It stays pending until the user verifies their email.'
          : `Account status set to ${STATUS_LABELS[detail.user.status] ?? detail.user.status}. The user was notified by email.`,
      );
    } catch (err) {
      setDialogError(describeApiError(err, 'Status update failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRole() {
    const problem = stepUp.validate();
    if (problem) {
      setDialogError(problem);
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      const { password, totpCode } = stepUp.payload();
      const detail = await adminApi.updateAdminUserRole(id, { role, password, totpCode });
      apply(detail);
      setDialog(null);
      stepUp.reset();
      setSuccess('Role updated. The account must sign in again for the change to apply everywhere.');
    } catch (err) {
      stepUp.setValues({ ...stepUp.values, password: '', totpCode: '' });
      setDialogError(describeApiError(err, 'Role update failed.'));
    } finally {
      setBusy(false);
    }
  }

  const user = data?.user;
  const statusUnchanged = !!user && status === user.status;
  const roleUnchanged = !!user && role === user.role;

  return (
    <section aria-labelledby="admin-user-heading" aria-busy={loading}>
      <p>
        <Link href="/admin/users">← Back to users</Link>
      </p>
      <h2 id="admin-user-heading" style={{ marginBottom: '0.35rem' }}>
        {user ? `${user.firstName} ${user.lastName}` : 'Account detail'}
      </h2>
      {user ? (
        <p style={{ marginTop: 0 }}>
          {user.email} · <AccountStatusBadge status={user.status} /> · {user.role === 'ADMIN' ? 'Administrator' : 'Investor'}
          {user.emailVerified ? ' · email verified' : ' · email not verified'}
        </p>
      ) : null}
      {loading ? <p role="status">Loading account…</p> : null}

      <FormError message={error} />
      <FormSuccess message={success} />

      {isSelf && user ? (
        <p className="form-error-banner" role="status">
          This is your own account. Administrators cannot change their own status or role;
          use Settings for your own account.
        </p>
      ) : null}

      {user ? (
        <div className="grid-two" style={{ display: 'grid', gap: '1.25rem' }}>
          <form className="card-panel" onSubmit={openStatusDialog}>
            <h3>Account status</h3>
            <fieldset disabled={isSelf || busy} style={{ border: 'none', padding: 0, margin: 0 }}>
              <label className="field">
                <span>Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as UserStatus)} required>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="DEACTIVATED">Deactivated</option>
                </select>
              </label>
              <label className="field">
                <span>Reason (required, recorded in the audit log)</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={3}
                  maxLength={200}
                  required
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={statusUnchanged}>
                Change status…
              </button>
            </fieldset>
          </form>

          <form className="card-panel" onSubmit={openRoleDialog}>
            <h3>Role</h3>
            <p style={{ fontSize: '0.9rem' }}>
              Requires your password, plus an authenticator code if you use two-step
              verification. Demoting the last active administrator is blocked.
            </p>
            <fieldset disabled={isSelf || busy} style={{ border: 'none', padding: 0, margin: 0 }}>
              <label className="field">
                <span>Role</span>
                <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} required>
                  <option value="INVESTOR">Investor</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </label>
              <button type="submit" className="btn btn-primary" disabled={roleUnchanged}>
                Change role…
              </button>
            </fieldset>
          </form>

          <div className="card-panel">
            <h3>Security summary</h3>
            <p>
              {data?.security.locked ? 'Sign-in temporarily locked' : 'Not locked'} ·{' '}
              {data?.security.activeSessions ?? 0} active session(s) · two-step verification{' '}
              {user.mfaEnabled ? 'on' : 'off'}
            </p>
            <h3>Recent security events</h3>
            {data?.auditSummary?.length ? (
              <ul>
                {data.auditSummary.map((event) => (
                  <li key={event.id}>
                    {event.eventType} · {event.outcome} · {new Date(event.createdAt).toLocaleString()}
                    {event.byAdministrator ? ' · by an administrator' : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No recent audit events for this account.</p>
            )}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={dialog === 'status'}
        title={`Set status to ${STATUS_LABELS[status] ?? status}?`}
        description={
          status === 'ACTIVE'
            ? 'The user regains access (or returns to pending verification if their email is unverified) and is notified by email.'
            : 'Every session of this user ends immediately, outstanding links stop working, and the user is notified by email.'
        }
        confirmLabel="Change status"
        danger={status !== 'ACTIVE'}
        busy={busy}
        error={dialogError}
        onCancel={() => !busy && setDialog(null)}
        onConfirm={confirmStatus}
      />

      <ConfirmDialog
        open={dialog === 'role'}
        title={`Make this account ${role === 'ADMIN' ? 'an administrator' : 'an investor'}?`}
        description={
          role === 'ADMIN'
            ? 'Administrators can manage every account and read the audit log.'
            : 'The account loses access to administrator tools.'
        }
        confirmLabel="Change role"
        danger={role === 'ADMIN'}
        busy={busy}
        error={dialogError}
        onCancel={() => {
          if (busy) return;
          setDialog(null);
          stepUp.reset();
        }}
        onConfirm={confirmRole}
      >
        <StepUpFields
          idPrefix="role-change"
          mfaEnabled={!!me?.mfaEnabled}
          values={stepUp.values}
          onChange={stepUp.setValues}
        />
      </ConfirmDialog>
    </section>
  );
}
