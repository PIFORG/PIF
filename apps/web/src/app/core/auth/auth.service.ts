import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { ApiClient, broadcastLogin, broadcastLogout, subscribeAuthChannel } from '../api/api-client';
import { AuthApi, type LoginInput, type RegisterInput } from '../api/auth-api';
import { ApiError, type LoginResponse, type User } from '../api/types';
import { TokenStore } from './token-store';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

/** Session state shared by every page; the Angular counterpart of apps/web AuthProvider. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly authApi = inject(AuthApi);
  private readonly tokens = inject(TokenStore);

  private readonly userState = signal<User | null>(null);
  private readonly statusState = signal<AuthStatus>('loading');

  readonly user = this.userState.asReadonly();
  readonly status = this.statusState.asReadonly();
  private readonly reduceMotion = computed(() => !!this.userState()?.preferences?.reduceMotion);
  private readonly highContrast = computed(() => !!this.userState()?.preferences?.highContrast);

  constructor() {
    this.api.onSessionUser((next) => this.userState.set(next));

    effect(() => {
      const root = document.documentElement;
      root.dataset['reduceMotion'] = String(this.reduceMotion());
      root.dataset['highContrast'] = String(this.highContrast());
    });

    const unsubscribe = subscribeAuthChannel((message) => {
      if (message.type === 'logout') {
        this.tokens.clear();
        this.userState.set(null);
        this.statusState.set('unauthenticated');
        return;
      }
      if (message.type === 'login' && this.statusState() !== 'authenticated') {
        void this.restore()
          .then((me) => {
            if (!me) return;
            this.userState.set(me);
            this.statusState.set('authenticated');
          })
          .catch(() => undefined);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.api.onSessionUser(null);
    });

    void (async () => {
      try {
        const me = await this.restore();
        if (!me) {
          this.clearSession();
          return;
        }
        this.userState.set(me);
        this.statusState.set('authenticated');
      } catch {
        this.clearSession();
      }
    })();
  }

  get accessToken(): string | null {
    return this.tokens.get();
  }

  private clearSession(): void {
    this.tokens.clear();
    this.userState.set(null);
    this.statusState.set('unauthenticated');
  }

  setSession(accessToken: string, nextUser: User): void {
    this.tokens.set(accessToken);
    this.userState.set(nextUser);
    this.statusState.set('authenticated');
  }

  private async restore(): Promise<User | null> {
    const token = await this.api.refreshAccessToken();
    if (!token) return null;
    return this.authApi.fetchCurrentUser();
  }

  async refreshUser(): Promise<User | null> {
    try {
      const me = await this.authApi.fetchCurrentUser();
      this.userState.set(me);
      this.statusState.set('authenticated');
      return me;
    } catch (err) {
      // Only an authentication failure ends the session; a network blip must not sign out.
      if (err instanceof ApiError && err.status === 401) {
        this.clearSession();
      }
      return null;
    }
  }

  async login(input: LoginInput): Promise<LoginResponse> {
    const result = await this.authApi.login(input);
    if ('accessToken' in result && result.accessToken && result.user) {
      this.setSession(result.accessToken, result.user);
      broadcastLogin();
    }
    return result;
  }

  async completeMfa(mfaChallengeToken: string, code: string): Promise<User> {
    const trimmed = code.replace(/\s+/g, '');
    const isTotp = /^\d{6}$/.test(trimmed);
    const result = await this.authApi.completeMfaLogin({
      mfaChallengeToken,
      ...(isTotp ? { totpCode: trimmed } : { recoveryCode: trimmed.toUpperCase() }),
    });
    this.setSession(result.accessToken, result.user);
    broadcastLogin();
    return result.user;
  }

  async register(input: RegisterInput): Promise<void> {
    await this.authApi.register(input);
  }

  /** Clears local state only (the server already ended the session). */
  endLocalSession(): void {
    this.clearSession();
    broadcastLogout();
  }

  async logout(): Promise<void> {
    await this.authApi.logout();
    this.endLocalSession();
  }
}
