import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveThrottle } from '../src/auth/login-throttle.config';
import { LoginThrottleService } from '../src/auth/login-throttle.service';

/**
 * ⭐⭐ **G116 — এক IP থেকে বহু ইমেইল।**
 *
 * ⚠️⚠️ যে গর্তটা এই ফাইল পাহারা দেয়: থ্রটলের চাবি ছিল `email|ip`, তাই
 * আক্রমণকারী প্রতিটা চেষ্টায় **আলাদা ইমেইল** দিলে প্রতিটা চেষ্টা আলাদা
 * চাবিতে পড়ত, কোনো কাউন্টার সীমা ছুঁত না, আর **তালা কখনো পড়ত না**।
 * অথচ কোডের মন্তব্যে লেখা ছিল ঠিক উল্টোটা — "একটাই IP বহু ইমেইলে…
 * ধরা পড়ে"। নিচের প্রথম টেস্টটা সংশোধনের আগের কোডে **ফেল করত**।
 *
 * ⚠️ `LoginThrottleService` `ConfigService` চায়, কিন্তু ভেতরে কেবল তিনটে
 *    `.env` চাবি পড়ে — তাই পুরো Nest তোলার দরকার নেই, একটা ছোট নকলই যথেষ্ট।
 */
function serviceWith(env: Record<string, string> = {}): LoginThrottleService {
  const config = {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;

  return new LoginThrottleService(config);
}

/** লক হয়ে গেছে কি না — 429 ছুড়লে `true` */
function locked(svc: LoginThrottleService, email: string, ip: string): boolean {
  try {
    svc.assertNotLocked(email, ip);
    return false;
  } catch (err) {
    if (err instanceof HttpException) return true;
    throw err;
  }
}

describe('LoginThrottleService — IP-ভিত্তিক সীমা (G116)', () => {
  let svc: LoginThrottleService;

  beforeEach(() => {
    // ডিফল্ট: জোড়া ১০, IP ৫০ (দশের পাঁচ গুণ)
    svc = serviceWith();
  });

  it('⭐ এক IP থেকে বহু আলাদা ইমেইল — শেষে IP লক হয়', () => {
    const ip = '203.0.113.9';

    // ৪৯টা আলাদা ইমেইল, প্রতিটায় একবার করে ভুল — জোড়া-সীমা কখনো ছোঁয় না
    for (let i = 0; i < 49; i++) {
      svc.recordFailure(`victim${i}@oxeio.local`, ip);
    }
    expect(locked(svc, 'victim99@oxeio.local', ip)).toBe(false);

    // ৫০তম — IP-সীমা ছুঁয়ে গেল
    svc.recordFailure('victim49@oxeio.local', ip);

    // ⭐ এখন **যে কোনো** ইমেইলই ওই IP থেকে আটকে যাবে, এমনকি যেটা কখনো
    //    চেষ্টাই করা হয়নি — এটাই পুরো ফিক্সের মূল কথা
    expect(locked(svc, 'never-tried@oxeio.local', ip)).toBe(true);
  });

  it('⭐ অন্য IP অক্ষত থাকে — একজনের কারণে গোটা দুনিয়া লক হয় না', () => {
    const attacker = '203.0.113.9';
    for (let i = 0; i < 60; i++) {
      svc.recordFailure(`victim${i}@oxeio.local`, attacker);
    }

    expect(locked(svc, 'owner@oxeio.local', attacker)).toBe(true);
    expect(locked(svc, 'owner@oxeio.local', '198.51.100.4')).toBe(false);
  });

  it('জোড়া-সীমা আগের মতোই কাজ করে — একই ইমেইল, একই IP', () => {
    const ip = '198.51.100.4';
    for (let i = 0; i < 9; i++) svc.recordFailure('owner@oxeio.local', ip);
    expect(locked(svc, 'owner@oxeio.local', ip)).toBe(false);

    svc.recordFailure('owner@oxeio.local', ip);
    expect(locked(svc, 'owner@oxeio.local', ip)).toBe(true);

    // ⚠️ অন্য ইমেইল একই IP থেকে তখনো ঢুকতে পারে — IP-সীমা এখনো দূরে
    expect(locked(svc, 'other@oxeio.local', ip)).toBe(false);
  });

  /**
   * ⚠️⚠️ সফল লগইনে IP-কাউন্টার **মোছা হয় না**। নইলে হাজার চেষ্টার মাঝে
   * একটা সফল হলেই আক্রমণকারীর গোনা শূন্য হয়ে যেত — অর্থাৎ ঠিক যে মুহূর্তে
   * সে সফল হতে শুরু করেছে, তখনই তালাটা খুলে যেত।
   */
  it('⭐ সফল লগইন IP-র গোনা মোছে না, শুধু নিজের জোড়াটা মোছে', () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < 49; i++) svc.recordFailure(`victim${i}@oxeio.local`, ip);

    svc.recordSuccess('victim0@oxeio.local', ip);

    // একটা ভুলেই IP-সীমা ছোঁয়া উচিত — গোনা রিসেট হয়নি
    svc.recordFailure('victim50@oxeio.local', ip);
    expect(locked(svc, 'anyone@oxeio.local', ip)).toBe(true);
  });

  it('লকআউট বন্ধ থাকলে IP-সীমাও চুপ', () => {
    const off = serviceWith({ LOGIN_LOCK_MINUTES: '0' });
    const ip = '203.0.113.9';
    for (let i = 0; i < 200; i++) off.recordFailure(`v${i}@oxeio.local`, ip);

    expect(locked(off, 'anyone@oxeio.local', ip)).toBe(false);
  });

  it('`LOGIN_IP_MAX_FAILS` দিয়ে সীমাটা বদলানো যায়', () => {
    const tight = serviceWith({ LOGIN_IP_MAX_FAILS: '12' });
    const ip = '203.0.113.9';

    for (let i = 0; i < 11; i++) tight.recordFailure(`v${i}@oxeio.local`, ip);
    expect(locked(tight, 'anyone@oxeio.local', ip)).toBe(false);

    tight.recordFailure('v11@oxeio.local', ip);
    expect(locked(tight, 'anyone@oxeio.local', ip)).toBe(true);
  });
});

describe('resolveThrottle — IP-সীমার মান', () => {
  it('ডিফল্টে জোড়া-সীমার পাঁচ গুণ', () => {
    expect(resolveThrottle({}).ipMaxFails).toBe(50);
    expect(resolveThrottle({ maxFails: '4' }).ipMaxFails).toBe(20);
  });

  /**
   * ⚠️ IP-সীমা কখনো জোড়া-সীমার **চেয়ে ছোট** হতে পারে না — হলে IP আগে লক
   * হতো আর দুটো নবের মানেই উল্টে যেত।
   */
  it('জোড়া-সীমার চেয়ে ছোট দিলে ডিফল্টে ফেরে', () => {
    const t = resolveThrottle({ maxFails: '10', ipMaxFails: '3' });
    expect(t.ipMaxFails).toBe(50);
  });

  it('বড় `maxFails` দিলেও IP-সীমা তার নিচে নামে না', () => {
    const t = resolveThrottle({ maxFails: '100' });
    expect(t.ipMaxFails).toBeGreaterThanOrEqual(100);
  });

  it('অবৈধ মান ডিফল্টে ফেরে', () => {
    expect(resolveThrottle({ ipMaxFails: 'abc' }).ipMaxFails).toBe(50);
    expect(resolveThrottle({ ipMaxFails: '' }).ipMaxFails).toBe(50);
  });
});
