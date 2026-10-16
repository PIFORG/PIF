import { apiRequest } from './client';
import type { AuthSession, MessageResponse } from './types';

export async function listSessions(): Promise<AuthSession[]> {
  return apiRequest<AuthSession[]>('/auth/sessions', { method: 'GET' });
}

export async function revokeSession(sessionId: string): Promise<MessageResponse> {
  return apiRequest<MessageResponse>(`/auth/sessions/${sessionId}`, {
    method: 'DELETE',
  });
}

export async function revokeOtherSessions(input: {
  password: string;
  totpCode?: string;
}): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/sessions', {
    method: 'DELETE',
    body: input,
  });
}

/** Signs out every device, including this one. */
export async function logoutAll(): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/logout-all', {
    method: 'POST',
    credentialsMode: 'include',
  });
}
