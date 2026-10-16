'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import * as authApi from '@/lib/api/auth';
import { describeApiError } from '@/lib/api/errors';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const raw = searchParams.get('token');
    if (raw) {
      setToken(raw);
      // Strip token from URL without consuming it (POST happens on button click).
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [searchParams]);

  async function confirm() {
    if (!token) {
      setError('Missing verification token. Open the link from your email again.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authApi.verifyEmail(token);
      setSuccess(res.message || 'Email verified. You can sign in now.');
      setToken(null);
    } catch (err) {
      setError(describeApiError(err, 'Verification failed. The link may be expired.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      lead="Confirm ownership of your inbox. Verification runs only when you click the button below — never automatically on page load."
      footer={
        <>
          <Link href="/login">Back to sign in</Link>
          <Link href="/resend-verification">Resend verification email</Link>
        </>
      }
    >
      <FormError message={error} />
      <FormSuccess message={success} />
      {!success ? (
        <>
          <p>
            {token
              ? 'A verification token is ready. Click confirm to complete verification.'
              : 'No verification token was found in this page URL.'}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={confirm}
            disabled={busy || !token}
          >
            {busy ? 'Verifying…' : 'Confirm email verification'}
          </button>
        </>
      ) : (
        <Link href="/login" className="btn btn-primary" style={{ width: '100%' }}>
          Continue to sign in
        </Link>
      )}
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" role="status">
          <p>Loading verification…</p>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
