import { api } from '../api/client';

/**
 * I06/I09-এর API কল।
 *
 * ⚠️ `src/api/auth.ts`-এ না লিখে এখানে — ওই ফাইলটা এই কাজের আওতার বাইরে।
 *    `login` এখানে আবার লেখা হয়েছে কারণ 2FA-র জন্য দুটো বাড়তি ফিল্ড আর
 *    একটা নতুন ধরনের উত্তর (`needsTotp`) দরকার। `me`/`logout` অপরিবর্তিত
 *    রয়ে গেছে `src/api/auth.ts`-এ।
 */

export interface LoginResponse {
  /** true হলে সেশন cookie **বসেনি** — কোড চেয়ে আবার পাঠাতে হবে */
  needsTotp?: true;
  mustChangePassword?: boolean;
  usedRecoveryCode?: boolean;
  recoveryCodesLeft?: number | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
  totp?: string;
  recoveryCode?: string;
}

export function login(creds: LoginCredentials): Promise<LoginResponse> {
  return api('/auth/login', {
    method: 'POST',
    body: creds,
    // ভুল পাসওয়ার্ড/কোডের 401 যেন গ্লোবাল লগআউট ট্রিগার না করে
    silent401: true,
  });
}

export interface SessionPolicy {
  idleTimeoutSec: number;
  warnBeforeSec: number;
}

/**
 * ⚠️ সংখ্যাগুলো ফ্রন্টএন্ডে হার্ডকোড না করে সার্ভার থেকে আনা হয় — নইলে
 *    একদিন সার্ভারে TTL বদলে গেলে ব্রাউজার ৩০ মিনিটে সতর্ক করত অথচ সেশন
 *    মরত ১৫ মিনিটে (বা উল্টো), আর কেউ ধরতেই পারত না।
 */
export function sessionPolicy(): Promise<SessionPolicy> {
  return api('/auth/session-policy', { silent401: true });
}

export interface TwoFactorStatus {
  enabled: boolean;
  /** QR বানানো হয়েছে কিন্তু কোড দিয়ে প্রমাণ করা হয়নি */
  pendingSetup: boolean;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
  /** `data:image/png;base64,…` */
  qrDataUrl: string;
}

export function twoFactorStatus(signal?: AbortSignal): Promise<TwoFactorStatus> {
  return api('/auth/2fa', { signal });
}

export function setupTwoFactor(): Promise<TwoFactorSetup> {
  return api('/auth/2fa/setup', { method: 'POST' });
}

export function enableTwoFactor(code: string): Promise<{ recoveryCodes: string[] }> {
  return api('/auth/2fa/enable', { method: 'POST', body: { code } });
}

export function disableTwoFactor(password: string): Promise<void> {
  return api('/auth/2fa/disable', { method: 'POST', body: { password } });
}

export function regenerateRecoveryCodes(
  password: string,
): Promise<{ recoveryCodes: string[] }> {
  return api('/auth/2fa/recovery-codes', { method: 'POST', body: { password } });
}
