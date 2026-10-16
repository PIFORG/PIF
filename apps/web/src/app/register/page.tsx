'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthFormField } from '@/components/auth/AuthFormField';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import { PasswordField } from '@/components/auth/PasswordField';
import { PasswordStrengthHint } from '@/components/auth/PasswordStrengthHint';
import { useAuth } from '@/lib/auth/AuthProvider';
import { describeApiError } from '@/lib/api/errors';
import { PASSWORD_HINT, registerSchema, type RegisterValues } from '@/lib/validation/schemas';

export default function RegisterPage() {
  const { register: registerUser, status } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  });

  const password = watch('password') ?? '';

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  async function onSubmit(values: RegisterValues) {
    setError(null);
    setSuccess(null);
    try {
      await registerUser({
        email: values.email,
        password: values.password,
        passwordConfirmation: values.confirmPassword,
        firstName: values.firstName,
        lastName: values.lastName,
      });
      setSuccess(
        'If this email can be registered, you will receive a verification message shortly.',
      );
    } catch (err) {
      setError(describeApiError(err, 'Registration failed. Please try again.'));
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      lead="Start practising with virtual capital. We verify your email before you enter the trading room."
      footer={
        <span>
          Already registered? <Link href="/login">Sign in</Link>
        </span>
      }
    >
      <FormError message={error} />
      <FormSuccess message={success} />

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <AuthFormField
          label="First name"
          autoComplete="given-name"
          error={errors.firstName?.message}
          {...register('firstName')}
        />
        <AuthFormField
          label="Last name"
          autoComplete="family-name"
          error={errors.lastName?.message}
          {...register('lastName')}
        />
        <AuthFormField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordStrengthHint password={password} />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create investor account'}
        </button>
      </form>
    </AuthLayout>
  );
}
