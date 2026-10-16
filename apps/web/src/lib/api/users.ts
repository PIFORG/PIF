import { apiRequest } from './client';
import type {
  AuthTokensResponse,
  DashboardContext,
  ExperienceLevel,
  MessageResponse,
  User,
  UserPreferences,
} from './types';

export async function updateProfile(input: {
  firstName?: string;
  lastName?: string;
  experienceLevel?: ExperienceLevel;
}): Promise<User> {
  return apiRequest<User>('/auth/me', {
    method: 'PATCH',
    body: input,
  });
}

export async function updatePreferences(
  input: Partial<UserPreferences>,
): Promise<UserPreferences> {
  return apiRequest<UserPreferences>('/auth/me/preferences', {
    method: 'PATCH',
    body: input,
  });
}

export async function fetchDashboardContext(): Promise<DashboardContext> {
  return apiRequest<DashboardContext>('/users/me/dashboard-context', { method: 'GET' });
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
  totpCode?: string;
}): Promise<AuthTokensResponse> {
  return apiRequest<AuthTokensResponse>('/auth/change-password', {
    method: 'POST',
    body: input,
  });
}

export async function requestEmailChange(input: {
  newEmail: string;
  password: string;
  totpCode?: string;
}): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/change-email/request', {
    method: 'POST',
    body: input,
  });
}

export async function confirmEmailChange(token: string): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/change-email/confirm', {
    method: 'POST',
    body: { token },
    auth: false,
  });
}

export async function deactivateAccount(input: {
  password: string;
  confirmation: 'DEACTIVATE';
  totpCode?: string;
}): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/me/deactivate', {
    method: 'POST',
    body: input,
  });
}

export async function deleteAccount(input: {
  password: string;
  confirmation: 'DELETE';
  totpCode?: string;
}): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/me', {
    method: 'DELETE',
    body: input,
  });
}
