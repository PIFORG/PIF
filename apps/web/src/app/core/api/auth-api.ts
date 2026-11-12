import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';
import type {
  AuthTokensResponse,
  DashboardContext,
  ExperienceLevel,
  LoginResponse,
  MessageResponse,
  User,
  UserPreferences,
} from './types';

export interface RegisterInput {
  email: string;
  password: string;
  passwordConfirmation?: string;
  firstName: string;
  lastName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** Identity endpoints of apps/web/src/lib/api/auth.ts and users.ts. */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);

  register(input: RegisterInput): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
      credentialsMode: 'include',
    });
  }

  login(input: LoginInput): Promise<LoginResponse> {
    return this.api.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: input,
      auth: false,
      credentialsMode: 'include',
    });
  }

  completeMfaLogin(input: {
    mfaChallengeToken: string;
    totpCode?: string;
    recoveryCode?: string;
  }): Promise<AuthTokensResponse> {
    return this.api.request<AuthTokensResponse>('/auth/mfa/verify-login', {
      method: 'POST',
      body: input,
      auth: false,
      credentialsMode: 'include',
    });
  }

  async logout(): Promise<void> {
    try {
      await this.api.request<MessageResponse>('/auth/logout', {
        method: 'POST',
        auth: true,
        skipRefresh: true,
        credentialsMode: 'include',
      });
    } catch {
      // Local clearance still proceeds
    }
  }

  verifyEmail(token: string): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/verify-email', {
      method: 'POST',
      body: { token },
      auth: false,
      credentialsMode: 'include',
    });
  }

  resendVerification(email: string): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/resend-verification', {
      method: 'POST',
      body: { email },
      auth: false,
      credentialsMode: 'include',
    });
  }

  forgotPassword(email: string): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      auth: false,
      credentialsMode: 'include',
    });
  }

  resetPassword(input: { token: string; password: string; passwordConfirmation: string }): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/reset-password', {
      method: 'POST',
      body: input,
      auth: false,
      credentialsMode: 'include',
    });
  }

  fetchCurrentUser(): Promise<User> {
    return this.api.request<User>('/auth/me', { method: 'GET' });
  }

  updateProfile(input: { firstName?: string; lastName?: string; experienceLevel?: ExperienceLevel }): Promise<User> {
    return this.api.request<User>('/auth/me', { method: 'PATCH', body: input });
  }

  updatePreferences(input: Partial<UserPreferences>): Promise<UserPreferences> {
    return this.api.request<UserPreferences>('/auth/me/preferences', { method: 'PATCH', body: input });
  }

  fetchDashboardContext(): Promise<DashboardContext> {
    return this.api.request<DashboardContext>('/users/me/dashboard-context', { method: 'GET' });
  }

  changePassword(input: {
    currentPassword: string;
    newPassword: string;
    newPasswordConfirmation: string;
    totpCode?: string;
  }): Promise<AuthTokensResponse> {
    return this.api.request<AuthTokensResponse>('/auth/change-password', { method: 'POST', body: input });
  }

  requestEmailChange(input: { newEmail: string; password: string; totpCode?: string }): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/change-email/request', { method: 'POST', body: input });
  }

  confirmEmailChange(token: string): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/change-email/confirm', {
      method: 'POST',
      body: { token },
      auth: false,
    });
  }

  deactivateAccount(input: { password: string; confirmation: 'DEACTIVATE'; totpCode?: string }): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/me/deactivate', { method: 'POST', body: input });
  }

  deleteAccount(input: { password: string; confirmation: 'DELETE'; totpCode?: string }): Promise<MessageResponse> {
    return this.api.request<MessageResponse>('/auth/me', { method: 'DELETE', body: input });
  }
}
