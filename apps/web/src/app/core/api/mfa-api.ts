import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';
import type { MessageResponse, MfaEnableResponse, MfaSetupResponse, MfaStatusResponse } from './types';

/** Authenticator enrolment endpoints of apps/web/src/lib/api/mfa.ts. */
@Injectable({ providedIn: 'root' })
export class MfaApi {
  private readonly api = inject(ApiClient);

  mfaStatus(): Promise<MfaStatusResponse> {
    return this.api.request<MfaStatusResponse>('/auth/mfa/status', { method: 'GET' });
  }

  setupMfa(input: { password: string; totpCode?: string }): Promise<MfaSetupResponse> {
    return this.api.request<MfaSetupResponse>('/auth/mfa/setup', { method: 'POST', body: input });
  }

  enableMfa(totpCode: string): Promise<MfaEnableResponse> {
    return this.api.request<MfaEnableResponse>('/auth/mfa/enable', { method: 'POST', body: { totpCode } });
  }

  disableMfa(input: { password: string; totpCode?: string; recoveryCode?: string }): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/mfa/disable', { method: 'POST', body: input });
  }

  regenerateRecoveryCodes(input: { password: string; totpCode?: string }): Promise<MfaEnableResponse> {
    return this.api.request<MfaEnableResponse>('/auth/mfa/recovery-codes/regenerate', { method: 'POST', body: input });
  }
}
