import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildTempPassword,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_CHARS,
} from '../src/auth/temp-password';

/**
 * অস্থায়ী পাসওয়ার্ড — **টাইপ করা যায় কি না**, সেটাই এখানকার প্রশ্ন।
 *
 * ⚠️⚠️ এই ফাইলটা লেখা হয়েছে একটা মাঠের ঘটনা থেকে: মালিক স্টাফের পাসওয়ার্ড
 * রিসেট করলেন, স্টাফ এজেন্টের জানালায় কয়েকবার ভুল টাইপ করলেন, আর পর্দায়
 * এল <i>"Too many failed attempts. Try again in 13 minutes."</i> —
 * অর্থাৎ মনে হলো **রিসেটটাই কাজ করছে না**, অথচ পাসওয়ার্ড ঠিকই ছিল।
 * কারণ পুরোনো base64url-এ `l` `I` `1` আর `O` `0` পাশাপাশি থাকত।
 */
describe('buildTempPassword', () => {
  const bytes = (n: number) => new Uint8Array(TEMP_PASSWORD_CHARS).fill(n);

  it('তিন দলে বারো অক্ষর', () => {
    const pw = buildTempPassword(bytes(0));

    expect(pw).toHaveLength(14); // ১২ অক্ষর + ২ হাইফেন
    expect(pw.split('-')).toHaveLength(3);
    expect(pw.split('-').every((g) => g.length === 4)).toBe(true);
  });

  /**
   * ⭐⭐ **এই ফাইলের মূল টেস্ট।** একটাও দ্ব্যর্থ অক্ষর থাকা চলবে না —
   * এখানেই আসল বাগটা ছিল।
   */
  it('দ্ব্যর্থ অক্ষর কখনো আসে না', () => {
    // ⚠️ ২৫৬টা মানই পরীক্ষা করা হয় — নমুনা নিলে বিরল অক্ষরটাই ফসকে যেত
    for (let b = 0; b < 256; b++) {
      const pw = buildTempPassword(bytes(b));

      for (const bad of ['0', 'O', '1', 'I', 'l', 'o', 'i']) {
        expect(pw).not.toContain(bad);
      }
    }
  });

  it('শুধু বর্ণমালার অক্ষর আর হাইফেন', () => {
    const pw = buildTempPassword(randomBytes(TEMP_PASSWORD_CHARS));

    for (const ch of pw.replace(/-/g, '')) {
      expect(TEMP_PASSWORD_ALPHABET).toContain(ch);
    }
  });

  /** ⚠️ বর্ণমালা ৩২ = ২^৫, তাই `& 31` নিখুঁতভাবে সমান বণ্টন দেয় */
  it('২৫৬টা বাইট ঠিক ৩২টা অক্ষরে ভাগ হয়, সমানভাবে', () => {
    const seen = new Map<string, number>();

    for (let b = 0; b < 256; b++) {
      const ch = buildTempPassword(bytes(b))[0];
      seen.set(ch, (seen.get(ch) ?? 0) + 1);
    }

    expect(seen.size).toBe(32);
    // ২৫৬ ÷ ৩২ = ৮ — প্রতিটা অক্ষর ঠিক আটবার, কেউ বেশি কেউ কম নয়
    expect([...seen.values()].every((n) => n === 8)).toBe(true);
  });

  it('একই বাইটে একই ফল — ফাংশনটা খাঁটি', () => {
    const seed = randomBytes(TEMP_PASSWORD_CHARS);

    expect(buildTempPassword(seed)).toBe(buildTempPassword(seed));
  });

  it('প্রতিটা অবস্থান নিজের বাইট থেকেই আসে', () => {
    const seed = new Uint8Array(TEMP_PASSWORD_CHARS);
    seed[0] = 0;
    seed[1] = 31;

    const pw = buildTempPassword(seed);

    expect(pw[0]).toBe(TEMP_PASSWORD_ALPHABET[0]);
    expect(pw[1]).toBe(TEMP_PASSWORD_ALPHABET[31]);
  });

  /**
   * ⚠️⚠️ কম বাইট দিলে **থামে**। চুপচাপ ছোট পাসওয়ার্ড বানালে সেটা কেউ
   * খেয়াল না করে বছরের পর বছর চলত — আর প্রতিটা রিসেটে দুর্বল পাসওয়ার্ড
   * বেরোত, কোনো লক্ষণ ছাড়াই।
   */
  it('বাইট কম হলে ছুঁড়ে দেয়', () => {
    expect(() => buildTempPassword(new Uint8Array(TEMP_PASSWORD_CHARS - 1))).toThrow(
      /random bytes/,
    );
    expect(() => buildTempPassword(new Uint8Array(0))).toThrow();
  });

  it('বেশি বাইট দিলে অসুবিধা নেই', () => {
    expect(buildTempPassword(randomBytes(64))).toHaveLength(14);
  });

  /** ⚠️ ছোট হাতের অক্ষর একেবারেই নেই — ফোনে বলার সময় "বড় না ছোট" লাগে না */
  it('সব বড় হাতের', () => {
    const pw = buildTempPassword(randomBytes(TEMP_PASSWORD_CHARS));

    expect(pw).toBe(pw.toUpperCase());
  });
});
