import { describe, expect, it } from 'vitest';

import { resolveThrottle } from '../src/auth/login-throttle.config';

/**
 * লগইন লকআউটের মাপ `.env` থেকে পড়া।
 *
 * ⚠️⚠️ এই ফাংশনের ভুল **সবচেয়ে খারাপ ধরনের** — লগইন হলো ভেতরে ঢোকার
 * একমাত্র দরজা। খুব কড়া হলে মালিক নিজের সিস্টেম থেকে বেরিয়ে যান; নীরবে
 * বন্ধ হয়ে গেলে কেউ জানেই না যে সুরক্ষাটা আর নেই। তাই সীমানার কেসগুলোই
 * এখানে বেশি।
 */
describe('resolveThrottle', () => {
  it('কিছু না দিলে নরম ডিফল্ট — ১০ বার, ২ মিনিট', () => {
    const t = resolveThrottle({});

    expect(t.enabled).toBe(true);
    expect(t.maxFails).toBe(10);
    expect(t.lockMs).toBe(2 * 60 * 1000);
  });

  it('দেওয়া মান মানা হয়', () => {
    const t = resolveThrottle({ maxFails: '20', lockMinutes: '5' });

    expect(t.maxFails).toBe(20);
    expect(t.lockMs).toBe(5 * 60 * 1000);
  });

  /** ⭐⭐ মালিক যেটা চেয়েছেন — লকআউট পুরোপুরি বন্ধ */
  it('শূন্য মিনিট মানে লকআউট বন্ধ', () => {
    const t = resolveThrottle({ lockMinutes: '0' });

    expect(t.enabled).toBe(false);
    expect(t.lockMs).toBe(0);
  });

  /**
   * ⚠️⚠️ `Number('')` শূন্য দেয়। খালি স্ট্রিংকে শূন্য ধরলে `.env`-এ শুধু
   * `LOGIN_LOCK_MINUTES=` লেখা থাকলেই সুরক্ষাটা **নীরবে** বন্ধ হয়ে যেত —
   * কেউ ওটা বন্ধ করতে চায়নি, কিন্তু কেউ টেরও পেত না।
   */
  it('খালি মান মানে বন্ধ নয়, ডিফল্ট', () => {
    expect(resolveThrottle({ lockMinutes: '' }).enabled).toBe(true);
    expect(resolveThrottle({ lockMinutes: '   ' }).enabled).toBe(true);
    expect(resolveThrottle({ lockMinutes: null }).enabled).toBe(true);
    expect(resolveThrottle({ lockMinutes: undefined }).enabled).toBe(true);
  });

  /** ⚠️ `.env`-এর টাইপোয় সার্ভার থামে না — ডিফল্টে ফেরে */
  it('অর্থহীন মানে ডিফল্ট', () => {
    expect(resolveThrottle({ lockMinutes: 'ten' }).lockMs).toBe(2 * 60 * 1000);
    expect(resolveThrottle({ maxFails: 'abc' }).maxFails).toBe(10);
  });

  /**
   * ⚠️⚠️ উপরের সীমা না থাকলে `LOGIN_LOCK_MINUTES=100000` কার্যত চিরকালের
   * তালা হতো, আর কাউন্টার মেমরিতে বলে ফেরার একমাত্র পথ থাকত সার্ভার
   * রিস্টার্ট — অর্থাৎ একটা টাইপো থেকে পুরো অফিস তালাবন্ধ।
   */
  it('অস্বাভাবিক বড় মান ডিফল্টে ফেরে', () => {
    expect(resolveThrottle({ lockMinutes: '100000' }).lockMs).toBe(2 * 60 * 1000);
    expect(resolveThrottle({ maxFails: '99999' }).maxFails).toBe(10);
  });

  it('ঋণাত্মক মানে ডিফল্ট, বন্ধ নয়', () => {
    const t = resolveThrottle({ lockMinutes: '-5', maxFails: '-1' });

    expect(t.enabled).toBe(true);
    expect(t.maxFails).toBe(10);
  });

  /** ⚠️ এক বার ভুলেই লক — কড়া, কিন্তু মালিক চাইলে তাঁর অধিকার */
  it('সবচেয়ে কড়া মানও দেওয়া যায়', () => {
    const t = resolveThrottle({ maxFails: '1', lockMinutes: '60' });

    expect(t.maxFails).toBe(1);
    expect(t.lockMs).toBe(60 * 60 * 1000);
  });

  it('দশমিক দিলে নিচে কাটা যায়', () => {
    expect(resolveThrottle({ maxFails: '7.9' }).maxFails).toBe(7);
  });

  it('সংখ্যা হিসেবে দিলেও চলে', () => {
    expect(resolveThrottle({ maxFails: 12, lockMinutes: 3 }).maxFails).toBe(12);
  });
});
