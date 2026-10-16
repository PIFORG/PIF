import { apiRequest } from './client';
import type {
  AdminOverview,
  AdminUserDetail,
  PaginatedAuditEvents,
  PaginatedUsers,
  UserRole,
  UserStatus,
} from './types';

export interface AdminUsersQuery {
  q?: string;
  status?: UserStatus | '';
  role?: UserRole | '';
  emailVerified?: 'true' | 'false' | '';
  page?: number;
  pageSize?: number;
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  return apiRequest<AdminOverview>('/admin/overview', { method: 'GET' });
}

export async function fetchAdminUsers(
  query: AdminUsersQuery = {},
): Promise<PaginatedUsers> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.role) params.set('role', query.role);
  if (query.emailVerified) params.set('emailVerified', query.emailVerified);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const qs = params.toString();
  return apiRequest<PaginatedUsers>(`/admin/users${qs ? `?${qs}` : ''}`, {
    method: 'GET',
  });
}

export interface AdminAuditQuery {
  eventType?: string;
  outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED' | '';
  actorUserId?: string;
  subjectUserId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchAuditEvents(query: AdminAuditQuery = {}): Promise<PaginatedAuditEvents> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiRequest<PaginatedAuditEvents>(`/admin/audit-events${qs ? `?${qs}` : ''}`, {
    method: 'GET',
  });
}

export async function fetchAdminUser(id: string): Promise<AdminUserDetail> {
  return apiRequest<AdminUserDetail>(`/admin/users/${id}`, { method: 'GET' });
}

export async function updateAdminUserStatus(
  id: string,
  body: { status: UserStatus; reason: string },
): Promise<AdminUserDetail> {
  return apiRequest<AdminUserDetail>(`/admin/users/${id}/status`, {
    method: 'PATCH',
    body,
  });
}

export async function updateAdminUserRole(
  id: string,
  body: { role: UserRole; password: string; totpCode?: string },
): Promise<AdminUserDetail> {
  return apiRequest<AdminUserDetail>(`/admin/users/${id}/role`, {
    method: 'PATCH',
    body,
  });
}
