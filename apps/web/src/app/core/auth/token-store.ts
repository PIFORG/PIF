import { Injectable } from '@angular/core';

/**
 * In-memory access token store. Never persisted to localStorage/sessionStorage.
 * Refresh relies on the HttpOnly cookie `mtrs_refresh` sent with credentials: 'include'.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private accessToken: string | null = null;

  get(): string | null {
    return this.accessToken;
  }

  set(token: string | null): void {
    this.accessToken = token;
  }

  clear(): void {
    this.accessToken = null;
  }
}
