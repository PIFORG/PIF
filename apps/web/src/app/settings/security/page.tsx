'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthFormField } from '@/components/auth/AuthFormField';
import { FormError, FormSuccess } from '@/components/auth/FormError';
import { MfaEnrollment } from '@/components/auth/MfaEnrollment';
import { PasswordField } from '@/components/auth/PasswordField';
import { StepUpFields, useStepUp } from '@/components/auth/StepUpFields';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { describeApiError } from '@/lib/api/errors';
import * as mfaApi from '@/lib/api/mfa';
import * as sessionsApi from '@/lib/api/sessions';
import * as usersApi from '@/lib/api/users';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PASSWORD_HINT, changePasswordSchema, emailChangeSchema } from '@/lib/validation/schemas';

type PasswordValues = z.infer<typeof changePasswordSchema>;
type EmailValues = z.infer<typeof emailChangeSchema>;
type Dialog = 'disableMfa' | 'deactivate' | 'delete' | null;

const TOTP = /^\d{6}$/;

export default function SecuritySettingsPage() {
  const { user, refreshUser, setSession, endLocalSession } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busyDialog, setBusyDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [adminMfaRequired, setAdminMfaRequired] = useState(false);
  const mfaEnabled = !!user?.mfaEnabled;
  const stepUp = useStepUp(mfaEnabled);

  const passwordForm = useForm<PasswordValues>({ resolver: zodResolver(changePasswordSchema) });
  const emailForm = useForm<EmailValues>({ resolver: zodResolver(emailChangeSchema) });

  useEffect(() => {
    let cancelled = false;
    sessionsApi
      .listSessions()
      .then((s) => !cancelled && setSessionCount(s.length))
      .catch(() => undefined);
    usersApi
      .fetchDashboardContext()
      .then((ctx) => !cancelled && setAdminMfaRequired(ctx.requiredActions.includes('ENROLL_MFA_FOR_ADMIN')))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mfaEnabled]);

  if (!user) return null;

  function openDialog(next: Dialog) {
    stepUp.reset();
    setDeleteConfirmation('');
    setDialogError(null);
    setDialog(next);
  }

  function closeDialog() {
    if (busyDialog) return;
    stepUp.reset();
    setDialog(null);
  }

  async function onChangePassword(values: PasswordValues) {
    setError(null);
    setSuccess(null);
    if (mfaEnabled && !TOTP.test(values.totpCode ?? '')) {
      passwordForm.setError('totpCode', { message: 'Enter the 6-digit code from your authenticator app' });
      return;
    }
    try {
      const result = await usersApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        newPasswordConfirmation: values.confirmPassword,
        ...(mfaEnabled ? { totpCode: values.totpCode } : {}),
      });
      passwordForm.reset();
      setSession(result.accessToken, result.user);
      setSuccess(
        'Password changed. Every other device was signed out; this device continues with a new session.',
      );
    } catch (err) {
      passwordForm.resetField('currentPassword');
      passwordForm.resetField('totpCode');
      setError(describeApiError(err, 'Password change failed.'));
    }
  }

  async function onEmailChange(values: EmailValues) {
    setError(null);
    setSuccess(null);
    if (mfaEnabled && !TOTP.test(values.totpCode ?? '')) {
      emailForm.setError('totpCode', { message: 'Enter the 6-digit code from your authenticator app' });
      return;
    }
    try {
      const res = await usersApi.requestEmailChange({
        newEmail: values.newEmail,
        password: values.password,
        ...(mfaEnabled ? { totpCode: values.totpCode } : {}),
      });
      emailForm.reset();
      setSuccess(
        res.message ||
          'If the new address can be used, a confirmation link was sent to it. Your current address was notified.',
      );
    } catch (err) {
      emailForm.resetField('password');
      emailForm.resetField('totpCode');
      setError(describeApiError(err, 'Email change request failed.'));
    }
  }

  async function runDialogAction() {
    const problem = stepUp.validate({ allowRecoveryCode: dialog === 'disableMfa' });
    if (problem) {
      setDialogError(problem);
      return;
    }
    if (dialog === 'delete' && deleteConfirmation !== 'DELETE') {
      setDialogError('Type DELETE to confirm.');
      return;
    }
    setBusyDialog(true);
    setDialogError(null);
    try {
      if (dialog === 'disableMfa') {
        await mfaApi.disableMfa(stepUp.payload());
        setDialog(null);
        stepUp.reset();
        setSuccess('Two-step verification is off. Other devices were signed out.');
        await refreshUser();
        return;
      }
      const { password, totpCode } = stepUp.payload();
      if (dialog === 'deactivate') {
        await usersApi.deactivateAccount({ password, totpCode, confirmation: 'DEACTIVATE' });
      } else if (dialog === 'delete') {
        await usersApi.deleteAccount({ password, totpCode, confirmation: 'DELETE' });
      }
      setDialog(null);
      endLocalSession();
      router.replace('/login');
    } catch (err) {
      stepUp.setValues({ ...stepUp.values, password: '', totpCode: '', recoveryCode: '' });
      setDialogError(describeApiError(err, 'The action could not be completed.'));
    } finally {
      setBusyDialog(false);
    }
  }

  const stepUpFields = (allowRecoveryCode: boolean) => (
    <StepUpFields
      idPrefix={dialog ?? 'dialog'}
      mfaEnabled={mfaEnabled}
      values={stepUp.values}
      onChange={stepUp.setValues}
      allowRecoveryCode={allowRecoveryCode}
    />
  );

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <FormError message={error} />
      <FormSuccess message={success} />

      {adminMfaRequired ? (
        <p className="form-error-banner" role="status">
          Administrator tools stay locked until you turn on two-step verification below.
        </p>
      ) : null}

      <section className="card-panel" aria-labelledby="sessions-summary-heading">
        <h2 id="sessions-summary-heading">Signed-in devices</h2>
        <p>
          {sessionCount === null
            ? 'Loading active sessions…'
            : `${sessionCount} active session${sessionCount === 1 ? '' : 's'}.`}{' '}
          {user.lastLoginAt ? `Last sign-in ${new Date(user.lastLoginAt).toLocaleString()}.` : null}
        </p>
        <Link href="/settings/sessions" className="btn btn-secondary">
          Review sessions
        </Link>
      </section>

      <section className="card-panel" aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <form onSubmit={passwordForm.handleSubmit(onChangePassword)} noValidate>
          <PasswordField
            id="currentPassword"
            label="Current password"
            autoComplete="current-password"
            error={passwordForm.formState.errors.currentPassword?.message}
            {...passwordForm.register('currentPassword')}
          />
          <PasswordField
            id="newPassword"
            label="New password"
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            error={passwordForm.formState.errors.newPassword?.message}
            {...passwordForm.register('newPassword')}
          />
          <PasswordField
            id="confirmPassword"
            label="Confirm new password"
            autoComplete="new-password"
            error={passwordForm.formState.errors.confirmPassword?.message}
            {...passwordForm.register('confirmPassword')}
          />
          {mfaEnabled ? (
            <AuthFormField
              id="changePasswordTotp"
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              error={passwordForm.formState.errors.totpCode?.message}
              {...passwordForm.register('totpCode')}
            />
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={passwordForm.formState.isSubmitting}>
            {passwordForm.formState.isSubmitting ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>

      <section className="card-panel" aria-labelledby="email-heading">
        <h2 id="email-heading">Change email</h2>
        <p>Current email: {user.email}</p>
        <p className="field-hint">
          We send a confirmation link to the new address and a notice to the current one. The
          change only happens after you open the link; you will then be signed out everywhere.
        </p>
        <form onSubmit={emailForm.handleSubmit(onEmailChange)} noValidate>
          <AuthFormField
            id="newEmail"
            label="New email"
            type="email"
            autoComplete="email"
            error={emailForm.formState.errors.newEmail?.message}
            {...emailForm.register('newEmail')}
          />
          <PasswordField
            id="emailPassword"
            label="Confirm with password"
            autoComplete="current-password"
            error={emailForm.formState.errors.password?.message}
            {...emailForm.register('password')}
          />
          {mfaEnabled ? (
            <AuthFormField
              id="emailTotp"
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              error={emailForm.formState.errors.totpCode?.message}
              {...emailForm.register('totpCode')}
            />
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={emailForm.formState.isSubmitting}>
            {emailForm.formState.isSubmitting ? 'Sending…' : 'Request email change'}
          </button>
        </form>
      </section>

      <MfaEnrollment enabled={mfaEnabled} onChanged={refreshUser} />

      {mfaEnabled ? (
        <section className="card-panel" aria-labelledby="disable-mfa-heading">
          <h2 id="disable-mfa-heading">Turn off two-step verification</h2>
          <p>
            Requires your password and an authenticator code, or a recovery code if you lost
            your device. Other devices will be signed out.
          </p>
          <button type="button" className="btn btn-danger" onClick={() => openDialog('disableMfa')}>
            Turn off two-step verification
          </button>
        </section>
      ) : null}

      <section className="card-panel" aria-labelledby="lifecycle-heading">
        <h2 id="lifecycle-heading">Account lifecycle</h2>
        <p>
          <strong>Deactivate</strong> signs you out everywhere and blocks sign-in until an
          administrator restores access. <strong>Delete</strong> immediately removes your name
          and email from the account and permanently disables it; this cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog('deactivate')}>
            Deactivate account
          </button>
          <button type="button" className="btn btn-danger" onClick={() => openDialog('delete')}>
            Delete account
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={dialog === 'disableMfa'}
        title="Turn off two-step verification?"
        description="Sign-in will only need your password until you set it up again."
        confirmLabel="Turn off"
        danger
        busy={busyDialog}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={runDialogAction}
      >
        {stepUpFields(true)}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'deactivate'}
        title="Deactivate this account?"
        description="You will be signed out on every device and cannot sign in until an administrator restores access."
        confirmLabel="Deactivate"
        danger
        busy={busyDialog}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={runDialogAction}
      >
        {stepUpFields(false)}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'delete'}
        title="Delete this account?"
        description="Your name and email are removed immediately, every session ends and the account can never be used again."
        confirmLabel="Delete account"
        danger
        busy={busyDialog}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={runDialogAction}
      >
        {stepUpFields(false)}
        <AuthFormField
          id="deleteConfirmation"
          label="Type DELETE to confirm"
          autoComplete="off"
          value={deleteConfirmation}
          onChange={(e) => setDeleteConfirmation(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
}
