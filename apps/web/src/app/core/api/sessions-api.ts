import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';
import type { AuthSession, MessageResponse } from './types';

/** Session endpoints of apps/web/src/lib/api/sessions.ts. */
@Injectable({ providedIn: 'root' })
export class SessionsApi {
  private readonly api = inject(ApiClient);

  listSessions(): Promise<AuthSession[]> {
    return this.api.request<AuthSession[]>('/auth/sessions', { method: 'GET' });
  }

  revokeSession(sessionId: string): Promise<MessageResponse> {
    return this.api.request<MessageResponse>(`/auth/sessions/${sessionId}`, { method: 'DELETE' });
  }

  revokeOtherSessions(input: { password: string; totpCode?: string }): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/sessions', { method: 'DELETE', body: input });
  }

  /** Signs out every device, including this one. */
  logoutAll(): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/logout-all', { method: 'POST', credentialsMode: 'include' });
  }
}
