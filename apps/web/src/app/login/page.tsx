'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthFormField } from '@/components/auth/AuthFormField';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import { PasswordField } from '@/components/auth/PasswordField';
import { useAuth } from '@/lib/auth/AuthProvider';
import { sanitizeReturnTo } from '@/lib/auth/returnTo';
import { describeApiError, hasErrorCode } from '@/lib/api/errors';
import { ApiError, isLoginSuccess, isMfaRequired } from '@/lib/api/types';
import {
  loginSchema,
  mfaCodeSchema,
  type LoginValues,
} from '@/lib/validation/schemas';
import { z } from 'zod';

type MfaValues = z.infer<typeof mfaCodeSchema>;

function LoginForm() {
  const { login, completeMfa, status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  const mfaForm = useForm<MfaValues>({
    resolver: zodResolver(mfaCodeSchema),
  });

  useEffect(() => {
    if (status === 'authenticated' && !mfaToken) {
      router.replace(returnTo);
    }
  }, [status, mfaToken, router, returnTo]);

  async function onLogin(values: LoginValues) {
    setError(null);
    setInfo(null);
    setUnverifiedEmail(null);
    try {
      const result = await login(values);
      if (isLoginSuccess(result)) {
        router.replace(returnTo);
        return;
      }
      if (isMfaRequired(result)) {
        setMfaToken(result.mfaChallengeToken);
        setInfo('Enter your authenticator code or a recovery code to finish signing in.');
      }
    } catch (err) {
      loginForm.resetField('password');
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(values.email);
        setInfo(
          'Your email is not verified yet. Resend a verification link to continue.',
        );
        return;
      }
      setError(describeApiError(err, 'Sign-in failed.'));
    }
  }

  async function onMfa(values: MfaValues) {
    if (!mfaToken) return;
    setError(null);
    try {
      await completeMfa(mfaToken, values.code);
      router.replace(returnTo);
    } catch (err) {
      // Each challenge allows one attempt; any failure means starting sign-in again.
      setMfaToken(null);
      setInfo(null);
      mfaForm.reset();
      setError(
        hasErrorCode(err, 'MFA_INVALID', 'TOKEN_INVALID')
          ? 'That code was not accepted, or the sign-in attempt expired. Sign in again to get a new verification step.'
          : describeApiError(err, 'Verification failed. Sign in again.'),
      );
    }
  }

  if (status === 'authenticated' && !mfaToken) {
    return <AuthLayout title="Sign in" lead="You are already signed in. Redirecting…" />;
  }

  return (
    <AuthLayout
      title={mfaToken ? 'Two-step verification' : 'Sign in'}
      lead={
        mfaToken
          ? 'Confirm the code from your authenticator app or a recovery code.'
          : 'Welcome back. Sign in to your simulated market workspace.'
      }
      footer={
        mfaToken ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setMfaToken(null);
              setInfo(null);
              mfaForm.reset();
            }}
          >
            Back to password sign-in
          </button>
        ) : (
          <>
            <span>
              Need an account? <Link href="/register">Register</Link>
            </span>
            <span>
              <Link href="/forgot-password">Forgot password?</Link>
            </span>
          </>
        )
      }
    >
      <FormError message={error} />
      <FormSuccess message={info} />

      {unverifiedEmail ? (
        <p>
          <Link href={`/resend-verification?email=${encodeURIComponent(unverifiedEmail)}`}>
            Resend verification email
          </Link>
        </p>
      ) : null}

      {!mfaToken ? (
        <form key="password-step" onSubmit={loginForm.handleSubmit(onLogin)} noValidate>
          <AuthFormField
            label="Email"
            type="email"
            autoComplete="email"
            error={loginForm.formState.errors.email?.message}
            {...loginForm.register('email')}
          />
          <PasswordField
            label="Password"
            autoComplete="current-password"
            error={loginForm.formState.errors.password?.message}
            {...loginForm.register('password')}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loginForm.formState.isSubmitting}
          >
            {loginForm.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form key="mfa-step" onSubmit={mfaForm.handleSubmit(onMfa)} noValidate>
          <AuthFormField
            label="Authenticator or recovery code"
            hint="You get one attempt per sign-in."
            autoComplete="one-time-code"
            error={mfaForm.formState.errors.code?.message}
            {...mfaForm.register('code')}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={mfaForm.formState.isSubmitting}
          >
            {mfaForm.formState.isSubmitting ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLayout title="Sign in" lead="Loading…" />}>
      <LoginForm />
    </Suspense>
  );
}
