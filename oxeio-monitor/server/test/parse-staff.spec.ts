import { describe, expect, it } from 'vitest';

import { parseStaff } from '../prisma/parse-staff';

/**
 * `staff.local.json` যাচাই।
 *
 * ⚠️⚠️ **এখানকার প্রতিটা ভুল সরাসরি টাকার অঙ্কে গিয়ে পড়ে** — এই ফাইলটাই
 * ঠিক করে কার বেতন কত আর কে কবে যোগ দিয়েছেন। আগে কোনো যাচাই ছিল না
 * (`as Staff[]`), তাই টাইপো ধরা পড়ত Prisma-র এমন এক বার্তায় যাতে কোন
 * কর্মীর সারিতে ভুল সেটা লেখাই থাকত না।
 *
 * ⭐ তাই বার্তাগুলোও পরীক্ষা করা হয় — শুধু "থেমেছে" যথেষ্ট নয়, **কোথায়**
 * সেটা বলা চাই।
 */
const ROW = ['OX-01', 'Rakib Hasan', 'Designer', 25000] as const;

const one = (row: unknown) => () => parseStaff([row]);

describe('parseStaff — স্বাভাবিক পথ', () => {
  it('চার ঘরের সারি চলে (তারিখ ছাড়া পুরোনো ফাইল)', () => {
    expect(parseStaff([[...ROW]])).toEqual([
      {
        empCode: 'OX-01',
        fullName: 'Rakib Hasan',
        designation: 'Designer',
        monthlySalary: 25000,
      },
    ]);
  });

  /**
   * ⚠️⚠️ **সবচেয়ে জরুরি দাবি।** তারিখ না দিলে ঘরটা ফলাফলে **থাকবেই না**,
   * `null` হয়ে নয়। seed `undefined` ঘর Prisma-কে পাঠায় না, তাই কেউ
   * ড্যাশবোর্ডে হাতে তারিখ বসিয়ে থাকলে সেটা টিকে যায়।
   *
   * `null` হলে seed আবার চালালেই ওই তারিখ মুছে যেত, আর তার সাথে G37-এর
   * proration-ও — কোনো এরর ছাড়াই।
   */
  it('তারিখ না দিলে joinedOn ঘরটাই থাকে না', () => {
    expect('joinedOn' in parseStaff([[...ROW]])[0]).toBe(false);
  });

  it('পাঁচ ঘরের সারিতে তারিখ UTC-মধ্যরাত হয়', () => {
    const [row] = parseStaff([[...ROW, '2026-01-05']]);
    expect(row.joinedOn?.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  /**
   * ⚠️ ঢাকা UTC+৬। `new Date('2026-01-01')`-কে স্থানীয় সময় ধরলে ওটা
   * ৩১ ডিসেম্বর হয়ে যেত, আর মাসের ১ তারিখে যোগ দেওয়া কেউ **আগের মাসে**
   * গিয়ে পড়তেন — অর্থাৎ চলতি মাসে পুরো বেতন, আগের মাসে এক দিনের।
   */
  it('মাসের প্রথম দিন আগের মাসে সরে যায় না', () => {
    const [row] = parseStaff([[...ROW, '2026-01-01']]);
    expect(row.joinedOn?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('ফাঁকা জায়গা ছেঁকে নেয়', () => {
    const [row] = parseStaff([[' OX-01 ', ' Rakib ', ' Designer ', 25000]]);
    expect(row).toMatchObject({ empCode: 'OX-01', fullName: 'Rakib' });
  });

  it('খালি তালিকা চলে', () => {
    expect(parseStaff([])).toEqual([]);
  });
});

describe('parseStaff — ভুল ধরা', () => {
  it('তালিকা না হলে থামে', () => {
    expect(() => parseStaff({ 'OX-01': 25000 })).toThrow(/তালিকা/);
  });

  /** ⚠️ তিন ঘর → বেতন `undefined` → Prisma-র অস্পষ্ট এরর */
  it('ঘর কম থাকলে থামে', () => {
    expect(one(['OX-01', 'Rakib', 'Designer'])).toThrow(/চার বা পাঁচ ঘর/);
  });

  it('ঘর বেশি থাকলেও থামে', () => {
    expect(one([...ROW, '2026-01-05', 'extra'])).toThrow(/চার বা পাঁচ ঘর/);
  });

  /** ⚠️ JSON-এ সংখ্যায় উদ্ধৃতি দেওয়া খুব সাধারণ ভুল */
  it('বেতন লেখা হলে থামে', () => {
    expect(one(['OX-01', 'Rakib', 'Designer', '25000'])).toThrow(/উদ্ধৃতি/);
  });

  /** ⚠️ কলামটা `Int` — ভগ্নাংশ দিলে পয়সা নিঃশব্দে হারাত */
  it('ভগ্নাংশ বেতনে থামে', () => {
    expect(one(['OX-01', 'Rakib', 'Designer', 25000.5])).toThrow(/ভগ্নাংশ/);
  });

  it('ঋণাত্মক বেতনে থামে', () => {
    expect(one(['OX-01', 'Rakib', 'Designer', -1])).toThrow(/ঋণাত্মক/);
  });

  it('নাম খালি হলে থামে', () => {
    expect(one(['OX-01', '   ', 'Designer', 25000])).toThrow(/নাম/);
  });

  /**
   * ⚠️⚠️ একই কোড দুবার থাকলে seed-এর upsert দ্বিতীয়টা দিয়ে প্রথমটা চাপা
   * দিত — একজন কর্মী নিঃশব্দে উধাও, অন্যজনের নাম-বেতন তার জায়গায়।
   * copy-paste করে তালিকা বানালে এটা খুব সহজেই ঘটে।
   */
  it('একই কোড দুবার থাকলে থামে', () => {
    const rows = [[...ROW], ['OX-01', 'Onno Keu', 'Manager', 40000]];
    expect(() => parseStaff(rows)).toThrow(/এই কোডটা আগেও আছে/);
  });

  it('তারিখের ধাঁচ ভুল হলে থামে', () => {
    expect(one([...ROW, '05-01-2026'])).toThrow(/YYYY-MM-DD/);
    expect(one([...ROW, '2026-1-5'])).toThrow(/YYYY-MM-DD/);
  });

  /**
   * ⚠️⚠️ **সবচেয়ে ছলনাময় কেস।** `new Date('2026-02-30')` কোনো এরর দেয় না
   * — JS চুপচাপ ২ মার্চ বানিয়ে দেয়। ফিরিয়ে মিলিয়ে না দেখলে টাইপোটা
   * সরাসরি proration-এ ঢুকে পড়ত।
   */
  it('পঞ্জিকায় নেই এমন তারিখে থামে', () => {
    expect(one([...ROW, '2026-02-30'])).toThrow(/এমন কোনো তারিখ নেই/);
    expect(one([...ROW, '2026-13-01'])).toThrow(/এমন কোনো তারিখ নেই/);
  });

  /** ⚠️ ২০২৪ অধিবর্ষ, ২০২৬ নয় — ২৯ ফেব্রুয়ারি বৈধ কি না বছরের উপর */
  it('অধিবর্ষ ঠিকভাবে ধরে', () => {
    expect(parseStaff([[...ROW, '2024-02-29']])[0].joinedOn).toBeInstanceOf(
      Date,
    );
    expect(one([...ROW, '2026-02-29'])).toThrow(/এমন কোনো তারিখ নেই/);
  });

  /**
   * ⭐ বার্তায় **কোড আর সারি নম্বর** দুটোই থাকে — ১২ সারির ফাইলে কোনটা
   * ঠিক করতে হবে সেটা যেন খুঁজতে না হয়।
   */
  it('বার্তায় কোন সারি ও কোন কর্মী সেটা বলা থাকে', () => {
    const rows = [[...ROW], ['OX-02', 'Karim', 'Intern', 'oops']];
    expect(() => parseStaff(rows)).toThrow(/সারি 2 \(OX-02\)/);
  });
});
