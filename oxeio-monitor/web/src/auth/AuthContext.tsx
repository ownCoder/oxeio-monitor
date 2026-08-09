import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import * as authApi from '../api/auth';
import type { Me } from '../api/auth';
import { setUnauthorizedHandler } from '../api/client';

interface AuthState {
  user: Me | null;
  /** প্রথম `/auth/me` কল শেষ হওয়ার আগে রুট সিদ্ধান্ত নেওয়া যাবে না */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await authApi.me());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // যেকোনো রিকোয়েস্টে সেশন শেষ হলে (৩০ মিনিট নিষ্ক্রিয়তা — I09)
    // সাথে সাথেই লগইন পর্দায় ফিরে যাওয়া
    setUnauthorizedHandler(() => setUser(null));
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await authApi.login(email, password);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, refresh }),
    [user, loading, signIn, signOut, refresh],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
