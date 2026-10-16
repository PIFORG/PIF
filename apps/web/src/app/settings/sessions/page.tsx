'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import { StepUpFields, useStepUp } from '@/components/auth/StepUpFields';
import { SessionCard } from '@/components/sessions/SessionCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { describeApiError } from '@/lib/api/errors';
import * as sessionsApi from '@/lib/api/sessions';
import type { AuthSession } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function SessionsSettingsPage() {
  const { user, endLocalSession } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'others' | 'all' | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busyDialog, setBusyDialog] = useState(false);
  const stepUp = useStepUp(!!user?.mfaEnabled);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await sessionsApi.listSessions());
    } catch (err) {
      setError(describeApiError(err, 'Unable to load sessions.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRevoke(id: string) {
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      await sessionsApi.revokeSession(id);
      setSuccess('Session signed out.');
      await load();
    } catch (err) {
      setError(describeApiError(err, 'Unable to sign out that session.'));
    } finally {
      setBusyId(null);
    }
  }

  function open(next: 'others' | 'all') {
    stepUp.reset();
    setDialogError(null);
    setDialog(next);
  }

  async function revokeOthers() {
    const problem = stepUp.validate();
    if (problem) {
      setDialogError(problem);
      return;
    }
    setBusyDialog(true);
    setDialogError(null);
    try {
      const { password, totpCode } = stepUp.payload();
      await sessionsApi.revokeOtherSessions({ password, totpCode });
      setSuccess('Every other session was signed out.');
      setDialog(null);
      stepUp.reset();
      await load();
    } catch (err) {
      stepUp.setValues({ ...stepUp.values, password: '', totpCode: '' });
      setDialogError(describeApiError(err, 'Unable to sign out other sessions.'));
    } finally {
      setBusyDialog(false);
    }
  }

  async function logoutEverywhere() {
    setBusyDialog(true);
    setDialogError(null);
    try {
      await sessionsApi.logoutAll();
      setDialog(null);
      endLocalSession();
      router.replace('/login');
    } catch (err) {
      setDialogError(describeApiError(err, 'Unable to sign out everywhere.'));
    } finally {
      setBusyDialog(false);
    }
  }

  const others = sessions.filter((s) => !s.current).length;

  return (
    <section aria-labelledby="sessions-heading">
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
          <h2 id="sessions-heading" style={{ marginBottom: '0.35rem' }}>
            Active sessions
          </h2>
          <p style={{ margin: 0 }}>Browsers and devices currently signed in to your account.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => open('others')}
            disabled={others === 0}
          >
            Sign out other sessions
          </button>
          <button type="button" className="btn btn-danger" onClick={() => open('all')}>
            Sign out everywhere
          </button>
        </div>
      </div>

      <FormError message={error} />
      <FormSuccess message={success} />

      {loading ? <p role="status">Loading sessions…</p> : null}

      <div style={{ display: 'grid', gap: '0.9rem' }}>
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} onRevoke={onRevoke} busy={busyId === session.id} />
        ))}
      </div>

      {!loading && sessions.length === 0 ? <p role="status">No active sessions found.</p> : null}

      <ConfirmDialog
        open={dialog === 'others'}
        title="Sign out all other sessions?"
        description="You stay signed in here. Other browsers and devices will need to sign in again."
        confirmLabel="Sign out others"
        danger
        busy={busyDialog}
        error={dialogError}
        onCancel={() => !busyDialog && setDialog(null)}
        onConfirm={revokeOthers}
      >
        <StepUpFields
          idPrefix="revoke-others"
          mfaEnabled={!!user?.mfaEnabled}
          values={stepUp.values}
          onChange={stepUp.setValues}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'all'}
        title="Sign out everywhere?"
        description="Every session ends, including this one. You will need to sign in again on each device."
        confirmLabel="Sign out everywhere"
        danger
        busy={busyDialog}
        error={dialogError}
        onCancel={() => !busyDialog && setDialog(null)}
        onConfirm={logoutEverywhere}
      />
    </section>
  );
}
