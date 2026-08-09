import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id — I04।
 *
 * `Algorithm` enum ইচ্ছাকৃতভাবে import করা হয়নি: @node-rs/argon2 ওটাকে
 * `.d.ts`-এ `const enum` হিসেবে দেয়, যা মডিউলের বাইরে থেকে নিরাপদে ব্যবহার করা যায় না।
 * argon2id লাইব্রেরির ডিফল্ট, তাই আলাদা করে দেওয়ার দরকারও নেই।
 *
 * প্যারামিটার OWASP-এর সুপারিশ: m = 19 MiB · t = 2 · p = 1
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, ARGON2_OPTIONS);
    } catch {
      // হ্যাশ ভাঙা বা অন্য ফরম্যাটের হলে — ব্যর্থ ধরাই নিরাপদ
      return false;
    }
  }

  /**
   * owner যখন কারো পাসওয়ার্ড রিসেট করে (G33) — একবারই দেখানো হয়,
   * কোথাও plaintext-এ জমা থাকে না।
   */
  generateTempPassword(): string {
    return randomBytes(12).toString('base64url').slice(0, 14);
  }
}
