'use client';

import { useCallback, useState } from 'react';
import { AuthFormField } from './AuthFormField';
import { PasswordField } from './PasswordField';

export interface StepUpValues {
  password: string;
  totpCode: string;
  recoveryCode: string;
  useRecoveryCode: boolean;
}

const EMPTY: StepUpValues = { password: '', totpCode: '', recoveryCode: '', useRecoveryCode: false };

/** State for a reauthentication form: password, plus a second factor when MFA is enabled. */
export function useStepUp(mfaEnabled: boolean) {
  const [values, setValues] = useState<StepUpValues>(EMPTY);
  const reset = useCallback(() => setValues(EMPTY), []);

  /** Returns a user-facing problem, or null when the values can be submitted. */
  function validate(opts: { allowRecoveryCode?: boolean } = {}): string | null {
    if (!values.password) return 'Enter your password to confirm.';
    if (!mfaEnabled) return null;
    if (opts.allowRecoveryCode && values.useRecoveryCode) {
      return values.recoveryCode.trim() ? null : 'Enter one of your recovery codes.';
    }
    return /^\d{6}$/.test(values.totpCode) ? null : 'Enter the 6-digit code from your authenticator app.';
  }

  function payload(): { password: string; totpCode?: string; recoveryCode?: string } {
    if (!mfaEnabled) return { password: values.password };
    if (values.useRecoveryCode) {
      return { password: values.password, recoveryCode: values.recoveryCode.trim().toUpperCase() };
    }
    return { password: values.password, totpCode: values.totpCode };
  }

  return { values, setValues, reset, validate, payload };
}

interface StepUpFieldsProps {
  idPrefix: string;
  mfaEnabled: boolean;
  values: StepUpValues;
  onChange: (next: StepUpValues) => void;
  allowRecoveryCode?: boolean;
  passwordLabel?: string;
}

export function StepUpFields({
  idPrefix,
  mfaEnabled,
  values,
  onChange,
  allowRecoveryCode = false,
  passwordLabel = 'Your password',
}: StepUpFieldsProps) {
  return (
    <>
      <PasswordField
        id={`${idPrefix}-password`}
        label={passwordLabel}
        autoComplete="current-password"
        value={values.password}
        onChange={(e) => onChange({ ...values, password: e.target.value })}
        required
      />
      {mfaEnabled && !values.useRecoveryCode ? (
        <AuthFormField
          id={`${idPrefix}-totp`}
          label="Authenticator code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={values.totpCode}
          onChange={(e) =>
            onChange({ ...values, totpCode: e.target.value.replace(/\D/g, '').slice(0, 6) })
          }
          required
        />
      ) : null}
      {mfaEnabled && values.useRecoveryCode ? (
        <AuthFormField
          id={`${idPrefix}-recovery`}
          label="Recovery code"
          autoComplete="off"
          spellCheck={false}
          value={values.recoveryCode}
          onChange={(e) => onChange({ ...values, recoveryCode: e.target.value })}
          required
        />
      ) : null}
      {mfaEnabled && allowRecoveryCode ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            onChange({ ...values, useRecoveryCode: !values.useRecoveryCode, totpCode: '', recoveryCode: '' })
          }
        >
          {values.useRecoveryCode ? 'Use authenticator code instead' : 'Lost your device? Use a recovery code'}
        </button>
      ) : null}
    </>
  );
}
