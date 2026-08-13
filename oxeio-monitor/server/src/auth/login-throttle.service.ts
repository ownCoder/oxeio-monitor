import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveThrottle, type ThrottleLimits } from './login-throttle.config';

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
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly attempts = new Map<string, Attempt>();
  private readonly limits: ThrottleLimits;

  constructor(config: ConfigService) {
    this.limits = resolveThrottle({
      maxFails: config.get<string>('LOGIN_MAX_FAILS'),
      lockMinutes: config.get<string>('LOGIN_LOCK_MINUTES'),
    });

    /**
     * ⚠️⚠️ বন্ধ থাকলে সেটা **চালুর সময়ই একবার** লেখা হয়। নইলে ছয় মাস পরে
     * কেউ "ব্রুট-ফোর্স সুরক্ষা আছে তো?" জিজ্ঞাসা করলে উত্তরটা খুঁজতে
     * `.env` পড়তে হতো — আর সবাই ধরে নিত আছে, কারণ কোডে তো আছে।
     */
    if (!this.limits.enabled) {
      this.logger.warn(
        'Login lockout is OFF (LOGIN_LOCK_MINUTES=0) — wrong passwords can be tried without limit',
      );
    }
  }

  /** ⚠️ prune-এর জানালা লক না থাকলেও দরকার, তাই আলাদা করে একটা ভিত্তি */
  private get pruneMs(): number {
    return this.limits.lockMs > 0 ? this.limits.lockMs : 5 * 60 * 1000;
  }

  /** ইমেইল + IP — একটাই ইমেইল বহু IP থেকে, বা একটাই IP বহু ইমেইলে, দুটোই ধরা পড়ে */
  private key(email: string, ip: string): string {
    return `${email.toLowerCase()}|${ip}`;
  }

  /** লক থাকলে 429 ছুড়বে */
  assertNotLocked(email: string, ip: string): void {
    if (!this.limits.enabled) return;

    this.prune();
    const a = this.attempts.get(this.key(email, ip));
    if (!a || a.lockedUntil <= Date.now()) return;

    const seconds = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    const minutes = Math.ceil(seconds / 60);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
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
    if (this.limits.enabled && a.fails >= this.limits.maxFails) {
      a.lockedUntil = now + this.limits.lockMs;
      a.fails = 0; // লক শেষ হলে আবার নতুন করে গোনা শুরু
    }
    this.attempts.set(k, a);
  }

  recordSuccess(email: string, ip: string): void {
    this.attempts.delete(this.key(email, ip));
  }

  /** পুরোনো এন্ট্রি জমতে দিই না — মেমরি লিক ঠেকাতে */
  private prune(): void {
    const cutoff = Date.now() - this.pruneMs * 2;
    for (const [k, a] of this.attempts) {
      if (a.lastSeen < cutoff && a.lockedUntil < Date.now()) {
        this.attempts.delete(k);
      }
    }
  }
}
