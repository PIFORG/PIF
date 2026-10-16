'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import { describeApiError, hasErrorCode } from '@/lib/api/errors';
import * as usersApi from '@/lib/api/users';
import { useAuth } from '@/lib/auth/AuthProvider';

function ConfirmEmailChangeContent() {
  const searchParams = useSearchParams();
  const { status, endLocalSession } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const raw = searchParams.get('token');
    if (raw) {
      setToken(raw);
      // Keep the token out of history, bookmarks and the address bar.
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [searchParams]);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await usersApi.confirmEmailChange(token);
      setToken(null);
      // The server signed out every session; drop this tab's copy as well.
      if (status === 'authenticated') endLocalSession();
      setSuccess('Your email address was changed. Sign in again with the new address.');
    } catch (err) {
      setError(
        hasErrorCode(err, 'TOKEN_INVALID', 'EMAIL_CHANGE_FAILED')
          ? 'This link is invalid, expired or already used, or the address is no longer available. Request a new email change from your security settings.'
          : describeApiError(err, 'The email change could not be confirmed.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Confirm your new email"
      lead="Confirming moves your account to this address. Nothing changes until you press the button."
      footer={<Link href="/login">Back to sign in</Link>}
    >
      <FormError message={error} />
      <FormSuccess message={success} />
      {success ? (
        <Link href="/login" className="btn btn-primary" style={{ width: '100%' }}>
          Continue to sign in
        </Link>
      ) : (
        <>
          <p>
            {token
              ? 'You will be signed out on every device after confirming.'
              : 'No confirmation token was found. Open the link from your email again.'}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={confirm}
            disabled={busy || !token}
          >
            {busy ? 'Confirming…' : 'Confirm new email'}
          </button>
        </>
      )}
    </AuthLayout>
  );
}

export default function ConfirmEmailChangePage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" role="status">
          <p>Loading…</p>
        </div>
      }
    >
      <ConfirmEmailChangeContent />
    </Suspense>
  );
}
