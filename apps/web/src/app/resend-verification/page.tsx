'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthFormField } from '@/components/auth/AuthFormField';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import * as authApi from '@/lib/api/auth';
import { describeApiError } from '@/lib/api/errors';
import { useCooldown } from '@/lib/hooks/useCooldown';
import { emailOnlySchema } from '@/lib/validation/schemas';

type Values = z.infer<typeof emailOnlySchema>;

function ResendForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: {
      email: searchParams.get('email') ?? '',
    },
  });

  const cooldown = useCooldown(60);

  async function onSubmit(values: Values) {
    setError(null);
    setSuccess(null);
    try {
      const res = await authApi.resendVerification(values.email);
      setSuccess(
        res.message ||
          'If that email is registered and unverified, a new link has been sent.',
      );
      cooldown.start();
    } catch (err) {
      setError(describeApiError(err, 'Unable to resend verification email.'));
    }
  }

  return (
    <AuthLayout
      title="Resend verification"
      lead="Request a fresh email verification link. Older links stop working once a new one is sent."
      footer={<Link href="/login">Back to sign in</Link>}
    >
      <FormError message={error} />
      <FormSuccess message={success} />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <AuthFormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={isSubmitting || cooldown.active}
        >
          {isSubmitting
            ? 'Sending…'
            : cooldown.active
              ? `Send again in ${cooldown.remaining}s`
              : 'Send verification email'}
        </button>
      </form>
    </AuthLayout>
  );
}

export default function ResendVerificationPage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell" role="status">
          <p>Loading…</p>
        </div>
      }
    >
      <ResendForm />
    </Suspense>
  );
}
