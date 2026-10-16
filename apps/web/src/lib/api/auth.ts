import { apiRequest } from './client';
import type {
  AuthTokensResponse,
  LoginResponse,
  MessageResponse,
  User,
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

export async function register(input: RegisterInput): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/register', {
    method: 'POST',
    body: input,
    auth: false,
    credentialsMode: 'include',
  });
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: input,
    auth: false,
    credentialsMode: 'include',
  });
}

export async function completeMfaLogin(input: {
  mfaChallengeToken: string;
  totpCode?: string;
  recoveryCode?: string;
}): Promise<AuthTokensResponse> {
  return apiRequest<AuthTokensResponse>('/auth/mfa/verify-login', {
    method: 'POST',
    body: input,
    auth: false,
    credentialsMode: 'include',
  });
}

export async function logout(): Promise<void> {
  try {
    await apiRequest<MessageResponse>('/auth/logout', {
      method: 'POST',
      auth: true,
      skipRefresh: true,
      credentialsMode: 'include',
    });
  } catch {
    // Local clearance still proceeds
  }
}

export async function verifyEmail(token: string): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/verify-email', {
    method: 'POST',
    body: { token },
    auth: false,
    credentialsMode: 'include',
  });
}

export async function resendVerification(email: string): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/resend-verification', {
    method: 'POST',
    body: { email },
    auth: false,
    credentialsMode: 'include',
  });
}

export async function forgotPassword(email: string): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/forgot-password', {
    method: 'POST',
    body: { email },
    auth: false,
    credentialsMode: 'include',
  });
}

export async function resetPassword(input: {
  token: string;
  password: string;
  passwordConfirmation: string;
}): Promise<MessageResponse> {
  return apiRequest<MessageResponse>('/auth/reset-password', {
    method: 'POST',
    body: input,
    auth: false,
    credentialsMode: 'include',
  });
}

export async function fetchCurrentUser(): Promise<User> {
  return apiRequest<User>('/auth/me', { method: 'GET' });
}
