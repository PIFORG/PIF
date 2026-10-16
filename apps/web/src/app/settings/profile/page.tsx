'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthFormField } from '@/components/auth/AuthFormField';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import { AccountStatusBadge } from '@/components/layout/AccountStatusBadge';
import { describeApiError } from '@/lib/api/errors';
import * as usersApi from '@/lib/api/users';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  CHART_THEMES,
  profileSchema,
  TRAINING_DIFFICULTIES,
  type ProfileValues,
} from '@/lib/validation/schemas';

const THEME_LABELS: Record<(typeof CHART_THEMES)[number], string> = {
  trading_desk: 'Trading desk (default)',
  light: 'Light',
  dark: 'Dark',
};

const DIFFICULTY_LABELS: Record<(typeof TRAINING_DIFFICULTIES)[number], string> = {
  adaptive: 'Adaptive',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

function supportedValues(key: 'currency' | 'timeZone', extra: string[]): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const values = intl.supportedValuesOf?.(key) ?? [];
  return Array.from(new Set([...extra, ...values])).sort();
}

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function ProfileSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Filled after mount: the browser's ICU lists may differ from the server's.
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [timeZones, setTimeZones] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
  });

  const currentCurrency = user?.preferences?.preferredCurrency ?? 'USD';
  const currentTimeZone = user?.preferences?.timezone ?? 'UTC';

  useEffect(() => {
    setCurrencies(supportedValues('currency', [currentCurrency]));
    setTimeZones(supportedValues('timeZone', ['UTC', currentTimeZone]));
  }, [currentCurrency, currentTimeZone]);

  useEffect(() => {
    if (!user) return;
    const prefs = user.preferences;
    reset({
      firstName: user.firstName,
      lastName: user.lastName,
      experienceLevel: user.experienceLevel,
      preferredCurrency: prefs?.preferredCurrency ?? 'USD',
      timezone: prefs?.timezone ?? 'UTC',
      chartTheme: (CHART_THEMES as readonly string[]).includes(prefs?.chartTheme ?? '')
        ? (prefs?.chartTheme as ProfileValues['chartTheme'])
        : 'trading_desk',
      trainingDifficulty: (TRAINING_DIFFICULTIES as readonly string[]).includes(prefs?.trainingDifficulty ?? '')
        ? (prefs?.trainingDifficulty as ProfileValues['trainingDifficulty'])
        : 'adaptive',
      notifyEmailSecurity: prefs?.notifyEmailSecurity ?? true,
      notifyMarketDigest: prefs?.notifyMarketDigest ?? false,
      reduceMotion: prefs?.reduceMotion ?? false,
      highContrast: prefs?.highContrast ?? false,
    });
  }, [user, reset, currencies, timeZones]);

  if (!user) return null;

  async function onSubmit(values: ProfileValues) {
    setError(null);
    setSuccess(null);
    try {
      await usersApi.updateProfile({
        firstName: values.firstName,
        lastName: values.lastName,
        experienceLevel: values.experienceLevel,
      });
      await usersApi.updatePreferences({
        preferredCurrency: values.preferredCurrency.toUpperCase(),
        timezone: values.timezone,
        chartTheme: values.chartTheme,
        trainingDifficulty: values.trainingDifficulty,
        notifyEmailSecurity: values.notifyEmailSecurity,
        notifyMarketDigest: values.notifyMarketDigest,
        reduceMotion: values.reduceMotion,
        highContrast: values.highContrast,
      });
      await refreshUser();
      setSuccess('Profile updated.');
    } catch (err) {
      setError(describeApiError(err, 'Unable to update profile.'));
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <section className="card-panel" aria-labelledby="account-heading">
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 id="account-heading" style={{ margin: 0 }}>
            Account
          </h2>
          <AccountStatusBadge status={user.status} />
        </div>
        <dl className="definition-list">
          <div>
            <dt>Email</dt>
            <dd>
              {user.email}{' '}
              {user.emailVerified ? (
                <span className="badge badge-active">Verified</span>
              ) : (
                <>
                  <span className="badge badge-pending">Not verified</span>{' '}
                  <Link href="/resend-verification">Send a new link</Link>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt>Last sign-in</dt>
            <dd>{formatDate(user.lastLoginAt)}</dd>
          </div>
          <div>
            <dt>Two-step verification</dt>
            <dd>
              {user.mfaEnabled ? 'On' : 'Off'} · <Link href="/settings/security">Security settings</Link>
            </dd>
          </div>
        </dl>
      </section>

      <section className="card-panel" aria-labelledby="profile-heading">
        <h2 id="profile-heading">Profile and preferences</h2>
        <FormError message={error} />
        <FormSuccess message={success} />
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <AuthFormField id="firstName" label="First name" error={errors.firstName?.message} {...register('firstName')} />
          <AuthFormField id="lastName" label="Last name" error={errors.lastName?.message} {...register('lastName')} />
          <AuthFormField
            id="experienceLevel"
            as="select"
            label="Experience level"
            hint="Tailors learning content only. It is not an investment suitability assessment."
            error={errors.experienceLevel?.message}
            {...register('experienceLevel')}
          >
            <option value="BEGINNER">Beginner</option>
            <option value="INTERMEDIATE">Intermediate</option>
            <option value="ADVANCED">Advanced</option>
          </AuthFormField>
          <AuthFormField
            id="preferredCurrency"
            as="select"
            label="Display currency"
            hint="Used to display simulated amounts. No real money is involved."
            error={errors.preferredCurrency?.message}
            {...register('preferredCurrency')}
          >
            {(currencies.length ? currencies : [currentCurrency]).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </AuthFormField>
          <AuthFormField
            id="timezone"
            as="select"
            label="Time zone"
            error={errors.timezone?.message}
            {...register('timezone')}
          >
            {(timeZones.length ? timeZones : [currentTimeZone]).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </AuthFormField>
          <AuthFormField id="chartTheme" as="select" label="Chart theme" error={errors.chartTheme?.message} {...register('chartTheme')}>
            {CHART_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </AuthFormField>
          <AuthFormField
            id="trainingDifficulty"
            as="select"
            label="Training difficulty"
            error={errors.trainingDifficulty?.message}
            {...register('trainingDifficulty')}
          >
            {TRAINING_DIFFICULTIES.map((level) => (
              <option key={level} value={level}>
                {DIFFICULTY_LABELS[level]}
              </option>
            ))}
          </AuthFormField>
          <fieldset className="field" style={{ border: 'none', padding: 0 }}>
            <legend style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              Notifications and accessibility
            </legend>
            <p className="field-hint" style={{ marginTop: 0 }}>
              Alerts about your account&apos;s security (password, email, sign-in and two-step
              changes) are always sent. The email choices below are saved for future optional
              messages; none are sent yet.
            </p>
            <label style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input type="checkbox" {...register('notifyEmailSecurity')} />
              Optional security tips by email
            </label>
            <label style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input type="checkbox" {...register('notifyMarketDigest')} />
              Market digest emails
            </label>
            <label style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input type="checkbox" {...register('reduceMotion')} />
              Reduce motion
            </label>
            <label style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="checkbox" {...register('highContrast')} />
              High contrast
            </label>
          </fieldset>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>
    </div>
  );
}
