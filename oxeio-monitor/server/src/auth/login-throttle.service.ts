import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { LOGIN_LOCK_MIN, MAX_LOGIN_FAILS } from './auth.constants';

interface Attempt {
  fails: number;
  lockedUntil: number;
  lastSeen: number;
}

/**
 * I11 — ব্রুট-ফোর্স প্রতিরোধ।
 *
 * ইন-মেমরিতে রাখা হয়েছে: একটাই সার্ভার প্রসেস, ১৭ জন ইউজার — Redis বসানোর মানে হয় না।
 * ⚠️ সার্ভার রিস্টার্ট করলে কাউন্টার মুছে যায়। এটা মেনে নেওয়া ট্রেড-অফ;
 *    আক্রমণকারী সার্ভার রিস্টার্ট করাতে পারে না।
 */
@Injectable()
export class LoginThrottleService {
  private readonly attempts = new Map<string, Attempt>();
  private readonly lockMs = LOGIN_LOCK_MIN * 60 * 1000;

  /** ইমেইল + IP — একটাই ইমেইল বহু IP থেকে, বা একটাই IP বহু ইমেইলে, দুটোই ধরা পড়ে */
  private key(email: string, ip: string): string {
    return `${email.toLowerCase()}|${ip}`;
  }

  /** লক থাকলে 429 ছুড়বে */
  assertNotLocked(email: string, ip: string): void {
    this.prune();
    const a = this.attempts.get(this.key(email, ip));
    if (!a || a.lockedUntil <= Date.now()) return;

    const seconds = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `অনেকবার ভুল হয়েছে। ${Math.ceil(seconds / 60)} মিনিট পর আবার চেষ্টা করুন।`,
        retryAfterSeconds: seconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  recordFailure(email: string, ip: string): void {
    const k = this.key(email, ip);
    const now = Date.now();
    const a = this.attempts.get(k) ?? { fails: 0, lockedUntil: 0, lastSeen: now };

    a.fails += 1;
    a.lastSeen = now;
    if (a.fails >= MAX_LOGIN_FAILS) {
      a.lockedUntil = now + this.lockMs;
      a.fails = 0; // লক শেষ হলে আবার নতুন করে ৫ বার
    }
    this.attempts.set(k, a);
  }

  recordSuccess(email: string, ip: string): void {
    this.attempts.delete(this.key(email, ip));
  }

  /** পুরোনো এন্ট্রি জমতে দিই না — মেমরি লিক ঠেকাতে */
  private prune(): void {
    const cutoff = Date.now() - this.lockMs * 2;
    for (const [k, a] of this.attempts) {
      if (a.lastSeen < cutoff && a.lockedUntil < Date.now()) {
        this.attempts.delete(k);
      }
    }
  }
}
