'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as authApi from '@/lib/api/auth';
import {
  broadcastLogin,
  broadcastLogout,
  onSessionUser,
  refreshAccessToken,
  subscribeAuthChannel,
} from '@/lib/api/client';
import type { LoginInput, RegisterInput } from '@/lib/api/auth';
import { ApiError, type LoginResponse, type User } from '@/lib/api/types';
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '@/lib/auth/tokenStore';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  accessToken: string | null;
  login: (input: LoginInput) => Promise<LoginResponse>;
  completeMfa: (mfaChallengeToken: string, code: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Clears local state only (the server already ended the session). */
  endLocalSession: () => void;
  refreshUser: () => Promise<User | null>;
  setSession: (accessToken: string, user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [tokenVersion, setTokenVersion] = useState(0);
  const statusRef = useRef<AuthStatus>('loading');
  statusRef.current = status;

  const clearSession = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setStatus('unauthenticated');
    setTokenVersion((v) => v + 1);
  }, []);

  const setSession = useCallback((accessToken: string, nextUser: User) => {
    setAccessToken(accessToken);
    setUser(nextUser);
    setStatus('authenticated');
    setTokenVersion((v) => v + 1);
  }, []);

  const restore = useCallback(async (): Promise<User | null> => {
    const token = await refreshAccessToken();
    if (!token) return null;
    return authApi.fetchCurrentUser();
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await authApi.fetchCurrentUser();
      setUser(me);
      setStatus('authenticated');
      return me;
    } catch (err) {
      // Only an authentication failure ends the session; a network blip must not sign out.
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        return null;
      }
      return null;
    }
  }, [clearSession]);

  useEffect(() => {
    onSessionUser((next) => setUser(next));
    return () => onSessionUser(null);
  }, []);

  const reduceMotion = !!user?.preferences?.reduceMotion;
  const highContrast = !!user?.preferences?.highContrast;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.reduceMotion = String(reduceMotion);
    root.dataset.highContrast = String(highContrast);
  }, [reduceMotion, highContrast]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const me = await restore();
        if (cancelled) return;
        if (!me) {
          clearSession();
          return;
        }
        setUser(me);
        setStatus('authenticated');
        setTokenVersion((v) => v + 1);
      } catch {
        if (!cancelled) clearSession();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearSession, restore]);

  useEffect(() => {
    return subscribeAuthChannel((message) => {
      if (message.type === 'logout') {
        clearAccessToken();
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      if (message.type === 'login' && statusRef.current !== 'authenticated') {
        void restore()
          .then((me) => {
            if (!me) return;
            setUser(me);
            setStatus('authenticated');
            setTokenVersion((v) => v + 1);
          })
          .catch(() => undefined);
      }
    });
  }, [restore]);

  const login = useCallback(
    async (input: LoginInput) => {
      const result = await authApi.login(input);
      if ('accessToken' in result && result.accessToken && result.user) {
        setSession(result.accessToken, result.user);
        broadcastLogin();
      }
      return result;
    },
    [setSession],
  );

  const completeMfa = useCallback(
    async (mfaChallengeToken: string, code: string) => {
      const trimmed = code.replace(/\s+/g, '');
      const isTotp = /^\d{6}$/.test(trimmed);
      const result = await authApi.completeMfaLogin({
        mfaChallengeToken,
        ...(isTotp ? { totpCode: trimmed } : { recoveryCode: trimmed.toUpperCase() }),
      });
      setSession(result.accessToken, result.user);
      broadcastLogin();
      return result.user;
    },
    [setSession],
  );

  const register = useCallback(async (input: RegisterInput) => {
    await authApi.register(input);
  }, []);

  const endLocalSession = useCallback(() => {
    clearSession();
    broadcastLogout();
  }, [clearSession]);

  const logout = useCallback(async () => {
    await authApi.logout();
    endLocalSession();
  }, [endLocalSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      accessToken: getAccessToken(),
      login,
      completeMfa,
      register,
      logout,
      endLocalSession,
      refreshUser,
      setSession,
    }),
    // tokenVersion forces accessToken re-read when session changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, status, tokenVersion, login, completeMfa, register, logout, endLocalSession, refreshUser, setSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
