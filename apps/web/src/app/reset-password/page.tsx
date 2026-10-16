'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import { PasswordField } from '@/components/auth/PasswordField';
import { PasswordStrengthHint } from '@/components/auth/PasswordStrengthHint';
import * as authApi from '@/lib/api/auth';
import { describeApiError } from '@/lib/api/errors';
import { PASSWORD_HINT, resetPasswordSchema } from '@/lib/validation/schemas';

type Values = z.infer<typeof resetPasswordSchema>;

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmedHandoff, setConfirmedHandoff] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const password = watch('password') ?? '';

  useEffect(() => {
    const raw = searchParams.get('token');
    if (raw) {
      setToken(raw);
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [searchParams]);

  async function onSubmit(values: Values) {
    if (!token) {
      setError('Missing reset token. Open the link from your email again.');
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const res = await authApi.resetPassword({
        token,
        password: values.password,
        passwordConfirmation: values.confirmPassword ?? values.password,
      });
      setSuccess(res.message || 'Password updated. You can sign in with the new password.');
      setToken(null);
    } catch (err) {
      setError(describeApiError(err, 'Password reset failed. The link may be expired.'));
    }
  }

  return (
    <AuthLayout
      title="Reset password"
      lead="Confirm the reset handoff, then choose a new password. The token is not consumed until you submit."
      footer={<Link href="/login">Back to sign in</Link>}
    >
      <FormError message={error} />
      <FormSuccess message={success} />

      {!token && !success ? (
        <p>No reset token was found. Request a new link from the forgot-password page.</p>
      ) : null}

      {token && !confirmedHandoff ? (
        <>
          <p>
            A password-reset token was received from your email link. Confirm to
            continue setting a new password.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => setConfirmedHandoff(true)}
          >
            Confirm reset handoff
          </button>
        </>
      ) : null}

      {token && confirmedHandoff && !success ? (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <PasswordField
            id="password"
            label="New password"
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordStrengthHint password={password} />
          <PasswordField
            id="confirmPassword"
            label="Confirm new password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Updating…' : 'Update password'}
          </button>
        </form>
      ) : null}

      {success ? (
        <Link href="/login" className="btn btn-primary" style={{ width: '100%' }}>
          Continue to sign in
        </Link>
      ) : null}
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" role="status">
          <p>Loading…</p>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
