import { apiRequest } from './client';
import type {
  MessageResponse,
  MfaEnableResponse,
  MfaSetupResponse,
  MfaStatusResponse,
} from './types';

export async function mfaStatus(): Promise<MfaStatusResponse> {
  return apiRequest<MfaStatusResponse>('/auth/mfa/status', { method: 'GET' });
}

export async function setupMfa(input: {
  password: string;
  totpCode?: string;
}): Promise<MfaSetupResponse> {
  return apiRequest<MfaSetupResponse>('/auth/mfa/setup', {
    method: 'POST',
    body: input,
  });
}

export async function enableMfa(totpCode: string): Promise<MfaEnableResponse> {
  return apiRequest<MfaEnableResponse>('/auth/mfa/enable', {
    method: 'POST',
    body: { totpCode },
  });
}

export async function disableMfa(input: {
  password: string;
  totpCode?: string;
  recoveryCode?: string;
}): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/mfa/disable', {
    method: 'POST',
    body: input,
  });
}

export async function regenerateRecoveryCodes(input: {
  password: string;
  totpCode?: string;
}): Promise<MfaEnableResponse> {
  return apiRequest<MfaEnableResponse>('/auth/mfa/recovery-codes/regenerate', {
    method: 'POST',
    body: input,
  });
}
