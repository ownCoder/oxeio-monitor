import { api } from './client';

export type Role = 'owner' | 'manager' | 'employee';

export interface Me {
  userId: number;
  email: string;
  fullName: string;
  role: Role;
  employeeId: number | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  /**
   * ⭐ ডিজাইন-টার্গেট জমা দিতে পারেন কি না *(২২ আগস্ট)*।
   *
   * ⚠️⚠️ সার্ভারের তৈরি উত্তর, কাঁচা `staffType` নয় — নিয়মটা ("owner ·
   * manager · অথবা researcher") ওয়েবে আবার লিখলে একদিন দুটো দু-রকম বলত,
   * আর কেউ মেনু দেখে ৪০৩ পেতেন।
   */
  canAddTargets: boolean;
  /**
   * ⭐ **বানান যাচাই করতে পারেন কি না** *(ADR-038, ২৫ আগস্ট ২০২৬)*।
   *
   * ⚠️ `canAddTargets`-এর থেকে আলাদা — সব গবেষক টার্গেট জমা দিতে পারেন,
   * কিন্তু বানান দেখেন কেবল যাঁকে মালিক টিক দিয়েছেন।
   */
  canProofread: boolean;
}

export function login(
  email: string,
  password: string,
): Promise<{ mustChangePassword: boolean }> {
  return api('/auth/login', {
    method: 'POST',
    body: { email, password },
    // ভুল পাসওয়ার্ডের 401 যেন গ্লোবাল লগআউট ট্রিগার না করে
    silent401: true,
  });
}

export function me(): Promise<Me> {
  return api('/auth/me', { silent401: true });
}

export function logout(): Promise<void> {
  return api('/auth/logout', { method: 'POST' });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return api('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
    silent401: true,
  });
}
