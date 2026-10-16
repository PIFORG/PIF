'use client';

import Link from 'next/link';
import { useState } from 'react';
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

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(emailOnlySchema),
  });

  const cooldown = useCooldown(60);

  async function onSubmit(values: Values) {
    setError(null);
    setSuccess(null);
    try {
      const res = await authApi.forgotPassword(values.email);
      setSuccess(
        res.message ||
          'If an account exists for that email, password reset instructions were sent.',
      );
      cooldown.start();
    } catch (err) {
      setError(describeApiError(err, 'Unable to start password reset.'));
    }
  }

  return (
    <AuthLayout
      title="Forgot password"
      lead="We will email a time-limited reset link if the account exists."
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
              : 'Send reset link'}
        </button>
      </form>
    </AuthLayout>
  );
}
