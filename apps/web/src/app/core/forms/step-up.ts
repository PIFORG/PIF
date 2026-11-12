import { signal } from '@angular/core';

export interface StepUpValues {
  password: string;
  totpCode: string;
  recoveryCode: string;
  useRecoveryCode: boolean;
}

const EMPTY: StepUpValues = { password: '', totpCode: '', recoveryCode: '', useRecoveryCode: false };

/** State for a reauthentication form (apps/web useStepUp): password, plus a second factor when MFA is enabled. */
export class StepUp {
  readonly values = signal<StepUpValues>(EMPTY);

  constructor(private readonly mfaEnabled: () => boolean) {}

  reset(): void {
    this.values.set(EMPTY);
  }

  patch(change: Partial<StepUpValues>): void {
    this.values.update((current) => ({ ...current, ...change }));
  }

  /** Returns a user-facing problem, or null when the values can be submitted. */
  validate(opts: { allowRecoveryCode?: boolean } = {}): string | null {
    const values = this.values();
    if (!values.password) return 'Saisissez votre mot de passe pour confirmer.';
    if (!this.mfaEnabled()) return null;
    if (opts.allowRecoveryCode && values.useRecoveryCode) {
      return values.recoveryCode.trim() ? null : 'Saisissez l\'un de vos codes de récupération.';
    }
    return /^\d{6}$/.test(values.totpCode)
      ? null
      : 'Saisissez le code à 6 chiffres de votre application d\'authentification.';
  }

  payload(): { password: string; totpCode?: string; recoveryCode?: string } {
    const values = this.values();
    if (!this.mfaEnabled()) return { password: values.password };
    if (values.useRecoveryCode) {
      return { password: values.password, recoveryCode: values.recoveryCode.trim().toUpperCase() };
    }
    return { password: values.password, totpCode: values.totpCode };
  }
}
