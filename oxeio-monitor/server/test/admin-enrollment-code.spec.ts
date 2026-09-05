import { createHash } from 'node:crypto';
import { dhakaNoon } from './setup/clock';

import { describe, expect, it } from 'vitest';

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  ENROLLMENT_CODE_TTL_MS,
  enrollmentCodeExpiry,
  formatEnrollmentCode,
  hashEnrollmentCode,
} from '../src/admin/enrollment-code';

describe('enrollment code — বর্ণমালা', () => {
  /**
   * ⭐ সংখ্যাটা নান্দনিক নয়, নিরাপত্তার। ৩২ না হলে `byte % length`-এ
   * কিছু অক্ষর অন্যদের চেয়ে বেশি আসত (modulo bias)।
   */
  it('ঠিক ৩২টি অক্ষর, আর ২৫৬ পুরোপুরি ভাগ যায়', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(256 % CODE_ALPHABET.length).toBe(0);
  });

  /**
   * ⚠️ এই টেস্টটা আগে `toContain('O')` দাবি করত, আর সেটা উপরের
   * "ঠিক ৩২টি অক্ষর" টেস্টের সাথেই সরাসরি সাংঘর্ষিক ছিল:
   * 0/I/L তিনটে বাদ দিয়ে O রাখলে বর্ণমালা ৩৩ অক্ষরের হয়, আর তখন
   * ২৫৬ % ৩৩ = ২৫ — অর্থাৎ প্রথম ২৫টা অক্ষর ৮ বার, বাকিগুলো ৭ বার আসত।
   * ঠিক যে modulo bias-টা এড়ানোর জন্য ৩২ বাছা হয়েছিল, সেটাই ফিরে আসত।
   *
   * তাই **চারটেই** বাদ: `0` ও `O` (জোড়াটার দুই পাশই), `I` ও `L` (`1` আছে)।
   * জোড়ার দুই সদস্যকেই বাদ দিলে কাগজ থেকে টাইপ করার সময় কোনো দিকেই
   * ভুল হওয়ার সুযোগ থাকে না। ৩৬ − ৪ = ৩২, হিসাব মেলে।
   */
  it('চোখে-গোলানো অক্ষরগুলো বাদ — 0, O, I, L', () => {
    for (const ch of ['0', 'O', 'I', 'L']) {
      expect(CODE_ALPHABET).not.toContain(ch);
    }
    // জোড়ার যে সদস্যটা রাখা হয়েছে
    expect(CODE_ALPHABET).toContain('1');
  });

  it('কোনো অক্ষর দুবার নেই', () => {
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
  });

  /** ০–২৫৫ প্রতিটা বাইট মেপে দেখা: প্রতিটা অক্ষর ঠিক ৮ বার আসে */
  it('বাইটের সব মান সমানভাবে ভাগ হয় — কোনো পক্ষপাত নেই', () => {
    const hits = new Map<string, number>();
    for (let b = 0; b < 256; b += 1) {
      const ch = CODE_ALPHABET[b % CODE_ALPHABET.length];
      hits.set(ch, (hits.get(ch) ?? 0) + 1);
    }

    expect(hits.size).toBe(32);
    expect([...hits.values()].every((n) => n === 8)).toBe(true);
  });
});

describe('enrollment code — কোড বানানো', () => {
  it('একই বাইটে সবসময় একই কোড', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 7);

    expect(formatEnrollmentCode(bytes)).toBe(formatEnrollmentCode(bytes));
  });

  it('দৈর্ঘ্য ১২, আর প্রতিটা অক্ষর বর্ণমালার ভেতরের', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 31) % 256);
    const code = formatEnrollmentCode(bytes);

    expect(code).toHaveLength(CODE_LENGTH);
    expect([...code].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
  });

  /**
   * ⚠️ কোডে হাইফেন বা ফাঁকা জায়গা নেই — এজেন্ট কোডটা হুবহু hash করে,
   * তাই `AB12-CD34` বনাম `AB12CD34` টাইপ করার ভুলটা ধরা যেত না।
   */
  it('কোডে হাইফেন বা ফাঁকা জায়গা নেই', () => {
    const code = formatEnrollmentCode(Uint8Array.from({ length: 16 }, () => 5));

    expect(code).toMatch(/^[A-Z0-9]{12}$/);
  });

  it('বাইট কম পড়লে চুপচাপ ছোট কোড না দিয়ে থেমে যায়', () => {
    // ⚠️ নীরবে ৮ অক্ষরের কোড বানালে এনট্রপি এক-তৃতীয়াংশে নেমে আসত,
    //    আর কেউ টেরও পেত না
    expect(() => formatEnrollmentCode(new Uint8Array(4))).toThrow(RangeError);
  });
});

describe('enrollment code — hash', () => {
  /**
   * ⚠️⚠️ এই টেস্টটাই `src/agent/enrollment.service.ts`-এর সাথে চুক্তি।
   * ওখানে লেখা আছে `createHash('sha256').update(code.trim()).digest('hex')`।
   * দুই পাশে অমিল হলে প্রতিটা enrollment নীরবে ব্যর্থ হতো, আর এজেন্ট
   * শুধু "কোড ভুল বা মেয়াদোত্তীর্ণ" বলত।
   */
  it('এজেন্টের হিসাবের সাথে অক্ষরে অক্ষরে মেলে', () => {
    const code = 'ABCD1234WXYZ';
    const asAgentDoesIt = createHash('sha256')
      .update(code.trim())
      .digest('hex');

    expect(hashEnrollmentCode(code)).toBe(asAgentDoesIt);
  });

  it('আগে-পরের ফাঁকা জায়গা উপেক্ষা করে (এজেন্টও `.trim()` করে)', () => {
    expect(hashEnrollmentCode('  ABCD1234WXYZ \n')).toBe(
      hashEnrollmentCode('ABCD1234WXYZ'),
    );
  });

  /**
   * ⭐ **আগে এই টেস্টটা বাগটাকেই assert করত** — "ছোট হাতে অন্য hash হয়"
   * লেখা ছিল, আর মন্তব্যে সেটাকে "জানা সীমাবদ্ধতা" বলা হয়েছিল।
   *
   * বাস্তবে সীমাবদ্ধতাটার দাম ছিল বেশি: কেউ কোড ছোট হাতে টাইপ করলে
   * সার্ভার "enrollment code ভুল বা মেয়াদোত্তীর্ণ" বলত — আর ওই একই বার্তা
   * আসে "কোড নেই", "ব্যবহার হয়ে গেছে" আর "মেয়াদ শেষ" তিনটেতেও (H05 · G18)।
   * ফলে আসল কারণ খুঁজে পাওয়া প্রায় অসম্ভব ছিল।
   *
   * ⚠️ বর্ণমালা পুরোটাই বড় হাতের, তাই `toUpperCase()` তৈরি হওয়া কোডে
   * no-op — অর্থাৎ **আগের কোডগুলোর hash অক্ষত থাকে**, পুরোনো enrollment
   * ভাঙে না।
   */
  it('ছোট-বড় হাত যাই হোক, একই hash', () => {
    expect(hashEnrollmentCode('abcd1234wxyz')).toBe(
      hashEnrollmentCode('ABCD1234WXYZ'),
    );
    expect(hashEnrollmentCode('  AbCd1234WxYz  ')).toBe(
      hashEnrollmentCode('ABCD1234WXYZ'),
    );
    expect([...CODE_ALPHABET].every((ch) => ch === ch.toUpperCase())).toBe(true);
  });

  it('কোড কখনো plaintext-এ ফেরত আসে না — hash ৬৪ অক্ষরের hex', () => {
    const hash = hashEnrollmentCode('ABCD1234WXYZ');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('ABCD');
  });
});

describe('enrollment code — মেয়াদ', () => {
  it('ঠিক ২৪ ঘণ্টা (H05)', () => {
    const now = new Date('2026-08-10T09:15:00.000Z');

    expect(enrollmentCodeExpiry(now).toISOString()).toBe(
      '2026-08-11T09:15:00.000Z',
    );
    expect(ENROLLMENT_CODE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('মেয়াদ সবসময় ভবিষ্যতে', () => {
    const now = dhakaNoon();

    expect(enrollmentCodeExpiry(now).getTime()).toBeGreaterThan(now.getTime());
  });
});
