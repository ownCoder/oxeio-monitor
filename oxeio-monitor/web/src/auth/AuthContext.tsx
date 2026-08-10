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
import { IdleWarning } from './IdleWarning';
import { login as loginRequest, type LoginCredentials } from './twoFactorApi';
import { useIdleLogout } from './useIdleLogout';

/** লগইন চেষ্টার ফল — পাসওয়ার্ড ঠিক হলেও কাজ শেষ না-ও হতে পারে (I06) */
export interface SignInResult {
  /** true হলে কোড চেয়ে আবার `signIn` ডাকতে হবে */
  needsTotp: boolean;
  /** রিকভারি কোড দিয়ে ঢুকেছে — কটা বাকি সেটা জানানো দরকার */
  usedRecoveryCode: boolean;
  recoveryCodesLeft: number | null;
}

interface AuthState {
  user: Me | null;
  /** প্রথম `/auth/me` কল শেষ হওয়ার আগে রুট সিদ্ধান্ত নেওয়া যাবে না */
  loading: boolean;
  signIn: (creds: LoginCredentials) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * I09 — নিষ্ক্রিয়তায় নিজে থেকে বেরিয়ে যাওয়ার পর true। লগইন পর্দা
   * এটা দেখেই "ভুল পাসওয়ার্ড" নয়, "সময় শেষ" বার্তাটা দেখায়।
   */
  timedOut: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);

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
    async (creds: LoginCredentials): Promise<SignInResult> => {
      const res = await loginRequest(creds);

      // ⚠️ `needsTotp` মানে কোনো cookie বসেনি — এখানে `refresh()` ডাকলে
      //    ৪০১ খেয়ে ব্যবহারকারী আবার শূন্য থেকে শুরু করত।
      if (res.needsTotp) {
        return { needsTotp: true, usedRecoveryCode: false, recoveryCodesLeft: null };
      }

      setTimedOut(false);
      await refresh();
      return {
        needsTotp: false,
        usedRecoveryCode: res.usedRecoveryCode === true,
        recoveryCodesLeft: res.recoveryCodesLeft ?? null,
      };
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

  /**
   * I09 — সময় ফুরালে সার্ভারেও cookie মুছে দেওয়া হয়।
   * ⚠️ শুধু `setUser(null)` করলে cookie ব্রাউজারে থেকে যেত; তারপর পাতা
   *    রিফ্রেশ করলে `/auth/me` সফল হয়ে ব্যবহারকারী আবার ভেতরে ঢুকে যেত —
   *    অর্থাৎ অটো-লগআউট আসলে কিছুই করত না।
   */
  const expire = useCallback(() => {
    setTimedOut(true);
    void signOut();
  }, [signOut]);

  const idle = useIdleLogout(user !== null, expire);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, refresh, timedOut }),
    [user, loading, signIn, signOut, refresh, timedOut],
  );

  return (
    <AuthContext value={value}>
      {children}
      {/*
        ⚠️ সতর্কবার্তাটা প্রোভাইডারেই বসে, কোনো একটা পাতায় নয় — তাহলে
           যে পাতাতেই ব্যবহারকারী থাকুক, বার্তাটা পায়। `Layout`-এ বসালে
           লগইন/পাসওয়ার্ড বদলের পর্দাগুলো বাদ পড়ত।
      */}
      {user !== null && idle.phase === 'warning' && (
        <IdleWarning
          secondsLeft={Math.ceil(idle.msLeft / 1000)}
          onStay={idle.stayLoggedIn}
          onLogoutNow={expire}
        />
      )}
    </AuthContext>
  );
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
