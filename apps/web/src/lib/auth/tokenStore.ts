/**
 * In-memory access token store. Never persisted to localStorage/sessionStorage.
 * Refresh relies on HttpOnly cookie `mtrs_refresh` with credentials: 'include'.
 */

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}
