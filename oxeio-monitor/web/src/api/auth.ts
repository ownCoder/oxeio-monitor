import { api } from './client';

/**
 * ⭐⭐ **ভূমিকার একটাই সংজ্ঞা** — এখানকারটা `admin.ts`-এর `Role`-কেই
 * এগিয়ে দেয়, নিজে আবার লেখে না।
 *
 * ⚠️⚠️ ২৫ আগস্ট পর্যন্ত এখানে **নিজস্ব একটা নকল** ছিল
 * (`'owner' | 'manager' | 'employee'`), আর সেটাই ছিল আসল বিপদ:
 * `admin.ts`-এ `researcher` বসানোর পরেও সেশনের টাইপটা পুরোনো থেকে
 * গেল, তাই সাইডবার (যেটা **এই** টাইপটা ব্যবহার করে) নীরবে অসম্পূর্ণ
 * থাকত — আর `Record<Role, ...>`-এর কম্পাইল পাহারাটাও অর্ধেক কাজ করত।
 *
 * ⭐ একই সত্য দুই জায়গায় লেখা থাকলে একদিন একটা বদলায়, অন্যটা নয়।
 */
import type { Role } from './admin';
export type { Role };

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

/**
 * ⭐⭐ **গোটা দলের ডেটা কে দেখেন** — কেবল মালিক ও ম্যানেজার।
 *
 * ⚠️⚠️ শর্তটা **হ্যাঁ-তালিকা**, আর সেটাই এই ফাংশনের গোটা কারণ। ২৫ আগস্ট
 * পর্যন্ত পাঁচটা পর্দায় লেখা ছিল `role === 'employee'` — অর্থাৎ *"স্টাফ
 * নয় মানে সব দেখেন"*। ⭐ `researcher` রোল যোগ করার সময় ধরা পড়ল যে
 * নতুন যেকোনো রোল তখন **সবকিছুর দিকেই** পড়ত: সবার স্ক্রিনশট, সবার
 * রিপোর্ট, খোঁজার বাক্স। কোনো কম্পাইল-এরর হতো না।
 *
 * ⚠️ সার্ভারও ঠিক একই দিকে ঘোরানো হয়েছে (`resolveEmployeeScope`,
 * `assertCanSee`) — পর্দা একমাত্র রক্ষী নয়, প্রথম রক্ষী।
 */
export function seesEveryone(role: Role | undefined | null): boolean {
  return role === 'owner' || role === 'manager';
}

/**
 * ⭐ লগইনের পর — বা "পাওয়া যায়নি" থেকে — কে কোথায় নামেন।
 *
 * ⚠️ গবেষক `/me`-তে নামলে প্রথম যা দেখতেন তা চারটে **ঘণ্টার** টাইল,
 * একটাও তাঁর কাজের নয় (২৪ আগস্ট)। ⚠️ ডিজাইনার Design Pool-এ নামলে
 * দেখতেন গোটা দলের কাজ — তাঁর জিনিস নয়।
 */
export function homePathFor(role: Role | undefined | null): string {
  if (seesEveryone(role)) return '/';
  return role === 'researcher' ? '/targets/all' : '/me';
}
