'use client';

import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import * as mfaApi from '@/lib/api/mfa';
import { describeApiError, hasErrorCode } from '@/lib/api/errors';
import type { MfaStatusResponse } from '@/lib/api/types';
import { AuthFormField } from './AuthFormField';
import { FormError, FormSuccess } from './FormError';
import { PasswordField } from './PasswordField';
import { StepUpFields, useStepUp } from './StepUpFields';
import styles from './MfaEnrollment.module.css';

const setupSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

const confirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit authenticator code'),
});

type SetupValues = z.infer<typeof setupSchema>;
type ConfirmValues = z.infer<typeof confirmSchema>;

interface MfaEnrollmentProps {
  enabled: boolean;
  onChanged: () => unknown;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className={styles.codes} role="region" aria-label="New recovery codes">
      <p>
        <strong>Save these recovery codes now.</strong> Each works once if you lose your
        authenticator. They will not be shown again, and any older codes no longer work.
      </p>
      <ul>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-secondary" onClick={onDone}>
        I have stored these codes
      </button>
    </div>
  );
}

export function MfaEnrollment({ enabled, onChanged }: MfaEnrollmentProps) {
  const [enrolling, setEnrolling] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [expiresInMinutes, setExpiresInMinutes] = useState<number | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [status, setStatus] = useState<MfaStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const regenStepUp = useStepUp(true);

  const setupForm = useForm<SetupValues>({ resolver: zodResolver(setupSchema) });
  const confirmForm = useForm<ConfirmValues>({ resolver: zodResolver(confirmSchema) });

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await mfaApi.mfaStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (enabled) void loadStatus();
    else setStatus(null);
  }, [enabled, loadStatus]);

  function cancelEnrollment() {
    setEnrolling(false);
    setSecret(null);
    setOtpauthUrl(null);
    setExpiresInMinutes(null);
    confirmForm.reset();
  }

  async function startEnroll(values: SetupValues) {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await mfaApi.setupMfa({ password: values.password });
      setSecret(res.secret);
      setOtpauthUrl(res.otpauth);
      setExpiresInMinutes(res.expiresInMinutes ?? null);
      setEnrolling(true);
      setupForm.reset();
      confirmForm.reset();
    } catch (err) {
      setupForm.resetField('password');
      setError(describeApiError(err, 'Unable to start two-step verification setup.'));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(values: ConfirmValues) {
    setError(null);
    setBusy(true);
    try {
      const res = await mfaApi.enableMfa(values.code);
      setRecoveryCodes(res.recoveryCodes);
      setSuccess('Two-step verification is now on.');
      cancelEnrollment();
      await onChanged();
    } catch (err) {
      if (hasErrorCode(err, 'MFA_SETUP_EXPIRED', 'MFA_SETUP_REQUIRED')) cancelEnrollment();
      setError(describeApiError(err, 'That code was not accepted. Check the time on your device and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    const problem = regenStepUp.validate();
    if (problem) {
      setRegenError(problem);
      return;
    }
    setBusy(true);
    setRegenError(null);
    try {
      const { password, totpCode } = regenStepUp.payload();
      const res = await mfaApi.regenerateRecoveryCodes({ password, totpCode });
      setRecoveryCodes(res.recoveryCodes);
      setRegenOpen(false);
      regenStepUp.reset();
      setSuccess('New recovery codes generated.');
      await loadStatus();
    } catch (err) {
      regenStepUp.setValues({ ...regenStepUp.values, password: '', totpCode: '' });
      setRegenError(describeApiError(err, 'Unable to generate new recovery codes.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-panel" aria-labelledby="mfa-heading">
      <h2 id="mfa-heading">Two-step verification</h2>
      <p>
        Status: <strong>{enabled ? 'On' : 'Off'}</strong>
        {enabled && status ? (
          <>
            {' '}
            · {status.remainingRecoveryCodes} unused recovery code
            {status.remainingRecoveryCodes === 1 ? '' : 's'}
          </>
        ) : null}
      </p>
      {enabled && status && status.remainingRecoveryCodes <= 2 ? (
        <p className="form-error-banner" role="status">
          You are running low on recovery codes. Generate a new set so you are not locked out
          if you lose your device.
        </p>
      ) : null}
      <FormError message={error} />
      <FormSuccess message={success} />

      {recoveryCodes ? <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} /> : null}

      {!enabled && !enrolling ? (
        <form onSubmit={setupForm.handleSubmit(startEnroll)} noValidate>
          <p>Protect sign-in with a code from an authenticator app.</p>
          <PasswordField
            id="mfaSetupPassword"
            label="Confirm your password to begin"
            autoComplete="current-password"
            error={setupForm.formState.errors.password?.message}
            {...setupForm.register('password')}
          />
          <button type="submit" className="btn btn-secondary" disabled={busy}>
            {busy ? 'Starting…' : 'Set up authenticator'}
          </button>
        </form>
      ) : null}

      {enrolling ? (
        <div>
          <ol>
            <li>Add this account to your authenticator app using the secret or link below.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          {secret ? (
            <p>
              Secret: <code aria-label="Authenticator secret">{secret}</code>
            </p>
          ) : null}
          {otpauthUrl ? (
            <p className={styles.otpauth}>
              <a href={otpauthUrl}>Open in authenticator app</a>
            </p>
          ) : null}
          {expiresInMinutes ? (
            <p className="field-hint">This setup expires in {expiresInMinutes} minutes.</p>
          ) : null}
          <form onSubmit={confirmForm.handleSubmit(onConfirm)} noValidate>
            <AuthFormField
              id="mfaEnableCode"
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              error={confirmForm.formState.errors.code?.message}
              {...confirmForm.register('code')}
            />
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Turning on…' : 'Turn on two-step verification'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={cancelEnrollment} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {enabled ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setRegenError(null);
            setRegenOpen(true);
          }}
        >
          Generate new recovery codes
        </button>
      ) : null}

      <ConfirmDialog
        open={regenOpen}
        title="Generate new recovery codes?"
        description="Your current recovery codes stop working immediately."
        confirmLabel="Generate codes"
        busy={busy}
        error={regenError}
        onCancel={() => {
          setRegenOpen(false);
          regenStepUp.reset();
        }}
        onConfirm={regenerate}
      >
        <StepUpFields
          idPrefix="regen"
          mfaEnabled
          values={regenStepUp.values}
          onChange={regenStepUp.setValues}
        />
      </ConfirmDialog>
    </section>
  );
}
