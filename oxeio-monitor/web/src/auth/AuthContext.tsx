import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { Me } from '../api/auth';
import { setUnauthorizedHandler } from '../api/client';
import { endSession, hasLogoutIntent, loadSession, saveLogoutIntent } from './session';
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
  /**
   * ⭐⭐ সার্ভারের সাথে কথাই বলা যায়নি — **সেশন শেষ নয়**।
   *
   * ⚠️ আগে দুটো অবস্থা এক করে ফেলা হতো: `me()` যে কারণেই ব্যর্থ হোক
   *    (৪০১ হোক, নাকি প্লেন নেই) লগইন পর্দা উঠত। ব্রাউজার ট্যাবে ওটা
   *    বিরল, কিন্তু হোমস্ক্রিনের PWA মোবাইল ডেটায় বারবার ঠান্ডা-চালু হয় —
   *    ওখানে এটাই নিত্য ঘটনা। ফল দুটোই খারাপ: মালিক ভাবতেন সেশন শেষ
   *    হয়ে গেছে (অথচ cookie দিব্যি বেঁচে), আর নেট ফিরে এলেও অ্যাপ নিজে
   *    থেকে ফিরত না। "জানি না"-কে "লগ আউট" বলা — নিষিদ্ধ রূপান্তরটারই
   *    আরেক মুখ।
   */
  offline: boolean;
  logoutStatus: 'none' | 'pending' | 'failed';
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [offline, setOffline] = useState(false);
  const [logoutStatus, setLogoutStatus] = useState<AuthState['logoutStatus']>(
    () => hasLogoutIntent() ? 'pending' : 'none',
  );
  const logoutIntent = useRef(hasLogoutIntent());
  const logoutInFlight = useRef(false);
  const refreshEpoch = useRef(0);
  const invalidateRefresh = useCallback(() => { ++refreshEpoch.current; }, []);

  const refresh = useCallback(async () => {
    if (logoutIntent.current) return;
    const epoch = ++refreshEpoch.current;
    const result = await loadSession();
    if (logoutIntent.current || epoch !== refreshEpoch.current) return;
    if (result.kind === 'authenticated') {
      setUser(result.user);
      setOffline(false);
    } else if (result.kind === 'signed-out') {
      setUser(null);
      setOffline(false);
    } else {
      // A server/network failure cannot establish that a session expired.
      setOffline(true);
    }
    setLoading(false);
  }, []);

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
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    logoutIntent.current = true;
    saveLogoutIntent(true);
    ++refreshEpoch.current;
    setLogoutStatus('pending');
    setUser(null);
    setLoading(false);
    setOffline(false);
    const ended = await endSession();
    logoutInFlight.current = false;
    if (ended) {
      saveLogoutIntent(false);
      logoutIntent.current = false;
      setLogoutStatus('none');
    } else {
      setLogoutStatus('failed');
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      ++refreshEpoch.current;
      setUser(null);
    });
    if (logoutIntent.current) void signOut();
    else void refresh();
    return invalidateRefresh;
  }, [refresh, signOut, invalidateRefresh]);

  useEffect(() => {
    const onOnline = (): void => {
      if (logoutIntent.current) void signOut();
      else void refresh();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh, signOut]);

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
    () => ({ user, loading, signIn, signOut, refresh, timedOut, offline, logoutStatus }),
    [user, loading, signIn, signOut, refresh, timedOut, offline, logoutStatus],
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
