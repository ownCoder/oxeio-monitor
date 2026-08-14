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
      ipMaxFails: config.get<string>('LOGIN_IP_MAX_FAILS'),
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

  /**
   * ⭐⭐ **দুটো চাবি, দুটো আলাদা আক্রমণের জন্য** (G116)।
   *
   * ⚠️⚠️ এখানে আগে লেখা ছিল *"একটাই ইমেইল বহু IP থেকে, বা একটাই IP বহু
   *    ইমেইলে, দুটোই ধরা পড়ে"* — আর সেটা **মিথ্যা ছিল**। চাবি ছিল
   *    `email|ip`, অর্থাৎ দুটো ক্ষেত্রেই প্রতিটা চেষ্টা **আলাদা চাবিতে**
   *    পড়ত আর কোনো কাউন্টারই সীমা ছুঁত না। এক IP থেকে হাজার ইমেইল
   *    চেষ্টা করলে তালা কখনো পড়ত না।
   *
   *  · `email|ip` — একজনের পাসওয়ার্ড বারবার অনুমান (সীমা `maxFails`)
   *  · `ip` একা   — এক IP থেকে বহু ইমেইল (সীমা `ipMaxFails`, অনেক উঁচু)
   */
  private pairKey(email: string, ip: string): string {
    return `${email.toLowerCase()}|${ip}`;
  }

  /** ⚠️ উপসর্গটা জরুরি — নইলে `ip` চাবিটা কোনো `email|ip`-এর সাথে মিলে যেতে পারত */
  private ipKey(ip: string): string {
    return `ip:${ip}`;
  }

  /** লক থাকলে 429 ছুড়বে */
  assertNotLocked(email: string, ip: string): void {
    if (!this.limits.enabled) return;

    this.prune();
    const now = Date.now();

    /**
     * ⚠️ দুটোর মধ্যে **যেটার লক বেশি সময় বাকি** সেটাই দেখানো হয় — নইলে
     *    জোড়া-লক শেষ হয়ে গেলে ব্যবহারকারী "এখন চেষ্টা করুন" ভেবে আবার
     *    চেষ্টা করতেন, অথচ IP-লক তখনো চলছে, আর বার্তাটা মিথ্যা হতো।
     */
    const until = Math.max(
      this.attempts.get(this.pairKey(email, ip))?.lockedUntil ?? 0,
      this.attempts.get(this.ipKey(ip))?.lockedUntil ?? 0,
    );
    if (until <= now) return;

    const seconds = Math.ceil((until - now) / 1000);
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
    this.bump(this.pairKey(email, ip), this.limits.maxFails);
    this.bump(this.ipKey(ip), this.limits.ipMaxFails);
  }

  /** একটা চাবির গোনা এক বাড়ায়, আর সীমা ছুঁলে তালা বসায় */
  private bump(key: string, max: number): void {
    const now = Date.now();
    const a = this.attempts.get(key) ?? { fails: 0, lockedUntil: 0, lastSeen: now };

    a.fails += 1;
    a.lastSeen = now;
    if (this.limits.enabled && a.fails >= max) {
      a.lockedUntil = now + this.limits.lockMs;
      a.fails = 0; // লক শেষ হলে আবার নতুন করে গোনা শুরু
    }
    this.attempts.set(key, a);
  }

  /**
   * ⚠️⚠️ সফল লগইনে **কেবল জোড়া-চাবিটা** মোছা হয়, IP-র কাউন্টার নয়।
   *    নইলে আক্রমণকারী হাজার চেষ্টার মাঝে একটাও সফল হলে তার গোটা
   *    গোনাই শূন্য হয়ে যেত — অর্থাৎ যে মুহূর্তে সে সফল হতে শুরু করেছে,
   *    ঠিক তখনই তালাটা খুলে যেত।
   * ⭐ অফিসের ভাগ করা IP-তে এতে ক্ষতি নেই: সীমাটা পাঁচ গুণ উঁচু, আর
   *    `prune()` পুরোনো গোনা এমনিতেই সরিয়ে দেয়।
   */
  recordSuccess(email: string, ip: string): void {
    this.attempts.delete(this.pairKey(email, ip));
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
