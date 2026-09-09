import { describe, expect, it } from 'vitest';

import { UserRole } from '@prisma/client';

import {
  allocationSizes,
  amazonUrl,
  asinOf,
  canUseTargets,
  JOB_NUMBER_START,
  MAX_ISSUED_PER_DAY,
  parseBulk,
  topUpSize,
} from '../src/targets/targets.rules';

/**
 * **ডিজাইনের টার্গেট** *(২২ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ এই ফাইলের সবচেয়ে জরুরি দাবি একটাই: **একই পণ্যের আলাদা URL যেন
 * আলাদা টার্গেট না হয়**। হলে তিনজন ডিজাইনার একই পণ্যের ডিজাইন বানাতেন —
 * তিন দিনের কাজ নষ্ট, আর কেউ ধরতেই পারত না।
 */

describe('asinOf — URL থেকে পরিচয়', () => {
  /** ⭐⭐ মাঠের নমুনা (মালিকের দেওয়া) আর তার আশেপাশের চেনা রূপগুলো */
  it.each([
    ['https://www.amazon.com/dp/B0DJBD22LW', 'B0DJBD22LW'],
    ['https://www.amazon.com/dp/B0DJBD22LW/', 'B0DJBD22LW'],
    [
      'https://www.amazon.com/Funny-Cat-Shirt/dp/B0DJBD22LW/ref=sr_1_3?keywords=cat',
      'B0DJBD22LW',
    ],
    ['https://www.amazon.com/gp/product/B0DJBD22LW?th=1', 'B0DJBD22LW'],
    ['https://www.amazon.com/gp/aw/d/B0DJBD22LW', 'B0DJBD22LW'],
    // ⚠️ একই ASIN সব দেশে এক — TLD বাঁধা হয়নি
    ['https://www.amazon.co.uk/dp/B0DJBD22LW', 'B0DJBD22LW'],
    ['https://amazon.de/dp/b0djbd22lw', 'B0DJBD22LW'],
    // ⭐ খালি ASIN পেস্ট করলেও চলে — লোকে মাঝে মাঝে তাই করে
    ['B0DJBD22LW', 'B0DJBD22LW'],
  ])('%s → %s', (url, asin) => {
    expect(asinOf(url)).toEqual({ asin });
  });

  /**
   * ⚠️⚠️ **এটাই গোটা ব্যবস্থার ভিত্তি** — তিনটে আলাদা URL, একই ASIN।
   */
  it('একই পণ্যের তিন রকম URL একই পরিচয় দেয়', () => {
    const forms = [
      'https://www.amazon.com/dp/B0DJBD22LW',
      'https://www.amazon.com/Funny-Cat/dp/B0DJBD22LW/ref=sr_1_3',
      'https://www.amazon.com/gp/product/B0DJBD22LW?th=1',
    ];

    const asins = new Set(forms.map((f) => (asinOf(f) as { asin: string }).asin));
    expect(asins.size).toBe(1);
  });

  /**
   * ⚠️ ছোট লিঙ্ক থেকে ASIN বের করা **যায় না** — Amazon-কে জিজ্ঞেস না করে
   * উপায় নেই, আর সার্ভার থেকে বাইরের সাইটে কল এই পণ্য করে না। ⭐ তাই
   * আলাদা কারণ, যাতে পর্দায় করণীয়টা বলা যায়।
   */
  it.each(['https://amzn.to/3xYzAbC', 'https://a.co/d/abc123'])(
    'ছোট লিঙ্ক আলাদা কারণে বাতিল — %s',
    (url) => {
      expect(asinOf(url)).toEqual({ reason: 'short_link' });
    },
  );

  it('Amazon নয় এমন লিঙ্ক', () => {
    expect(asinOf('https://etsy.com/listing/123456')).toEqual({
      reason: 'not_amazon',
    });
  });

  /** ⚠️ Amazon-এর সব URL-এ ASIN থাকে না (সার্চ পাতা, ক্যাটাগরি) */
  it('Amazon হলেও ASIN না থাকলে', () => {
    expect(asinOf('https://www.amazon.com/s?k=cat+t-shirt')).toEqual({
      reason: 'no_asin',
    });
  });

  it('খালি লাইনে ক্র্যাশ নয়', () => {
    expect(asinOf('   ')).toEqual({ reason: 'no_asin' });
  });
});

describe('amazonUrl — ASIN থেকে ঠিকানা', () => {
  /**
   * ⭐⭐ মালিকের নিয়ম *(২২ আগস্ট)*: *"amora jekono asin `/dp/`-এর পরে
   * বসিয়ে দিলেই ঝামেলা শেষ"*। ⚠️ তাই মূল URL জমা **রাখা হয় না** — ওটা
   * রাখলে একই জিনিসের দুটো রূপ টেবিলে থাকত (একজনেরটা `?th=1`সহ,
   * আরেকজনেরটা `ref=sr_1_3`সহ)।
   */
  it('স্বাভাবিক ঠিকানা বানায়', () => {
    expect(amazonUrl('B0DJBD22LW')).toBe('https://www.amazon.com/dp/B0DJBD22LW');
  });

  /** ⭐ যেকোনো রূপে পেস্ট করলেও ফেরত আসে একটাই ঠিকানা */
  it('যেভাবেই পেস্ট হোক, ঠিকানা এক', () => {
    const forms = [
      'https://www.amazon.com/Funny-Cat/dp/B0DJBD22LW/ref=sr_1_3',
      'https://www.amazon.co.uk/gp/product/B0DJBD22LW?th=1',
      'b0djbd22lw',
    ];

    const urls = new Set(
      forms.map((f) => amazonUrl((asinOf(f) as { asin: string }).asin)),
    );
    expect([...urls]).toEqual(['https://www.amazon.com/dp/B0DJBD22LW']);
  });
});

describe('parseBulk — একবারে ৫০০টা', () => {
  /**
   * ⚠️⚠️ **পেস্টের ভেতরের ডুপ্লিকেটও ধরা হয়।** দুটো আলাদা সার্চ থেকে একই
   * পণ্য আসা খুব সাধারণ, আর না ধরলে ডাটাবেসে ঢোকানোই থমকে যেত।
   */
  it('একই ASIN দুবার থাকলে দ্বিতীয়টা বাতিল', () => {
    const { accepted, rejected } = parseBulk(
      [
        'https://www.amazon.com/dp/B0DJBD22LW',
        'https://www.amazon.com/gp/product/B0DJBD22LW',
        'https://www.amazon.com/dp/B0AAAA1111',
      ].join('\n'),
    );

    expect(accepted.map((a) => a.asin)).toEqual(['B0DJBD22LW', 'B0AAAA1111']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe('duplicate_in_paste');
    // ⚠️ লাইন নম্বর ১ থেকে গোনা — পর্দায় দেখানোর জন্য
    expect(rejected[0].line).toBe(2);
  });

  /** ⚠️ খালি লাইন **ভুল নয়** — ৫০০ লাইনের পেস্টে ওগুলো থাকেই */
  it('খালি লাইন নীরবে বাদ, বাতিলের তালিকায় নয়', () => {
    const { accepted, rejected } = parseBulk(
      '\n\nhttps://www.amazon.com/dp/B0DJBD22LW\n\n   \n',
    );

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  /**
   * ⚠️⚠️ **ব্যর্থ লাইন ফেলে দেওয়া হয় না, ফেরত দেওয়া হয় — কারণসহ।**
   * ৫০০টার মধ্যে ৭টা বাদ পড়লে গবেষকের জানা দরকার কোন ৭টা; নইলে তিনি
   * সেগুলো আবার সংগ্রহ করতে পারতেন না।
   */
  it('বাতিলের সাথে লাইন, লেখা আর কারণ — তিনটেই', () => {
    const { rejected } = parseBulk('https://etsy.com/listing/1\nhttps://amzn.to/x');

    expect(rejected).toEqual([
      { line: 1, text: 'https://etsy.com/listing/1', reason: 'not_amazon' },
      { line: 2, text: 'https://amzn.to/x', reason: 'short_link' },
    ]);
  });

  it('৫০০ লাইনেও চলে', () => {
    const lines = Array.from(
      { length: 500 },
      (_, i) => `https://www.amazon.com/dp/B${String(i).padStart(9, '0')}`,
    );

    expect(parseBulk(lines.join('\n')).accepted).toHaveLength(500);
  });
});

describe('JOB_NUMBER_START', () => {
  /**
   * ⚠️⚠️ **মাঠে মাপা সংখ্যা, বেছে নেওয়া নয়।** ডিজাইনারদের ফাইলে এখন
   * সবচেয়ে বড় নম্বর **৯,৭৩,০৬৫** (ছয় অঙ্ক); সাত অঙ্কের একটাও নেই।
   * এই ধ্রুবক ওর নিচে নামলে পুরোনো কোনো ফাইল ভুল করে "শেষ হয়েছে" বলে
   * ধরা পড়ত — আর ভুলটা নীরব হতো।
   */
  it('মাঠে দেখা সবচেয়ে বড় নম্বরের উপরে', () => {
    expect(JOB_NUMBER_START).toBeGreaterThan(973_065);
  });
});

describe('topUpSize — আজ আর কতগুলো দিতে হবে', () => {
  const T = 25;
  const at = (completedToday: number, openCount: number, issuedToday = 0) =>
    topUpSize({
      staffType: 'designer',
      completedToday,
      openCount,
      issuedToday,
      dailyTarget: T,
    });

  /**
   * ⭐⭐⭐ **মালিকের বলা অবস্থাটা** — হাত পুরো খালি *(৯ সেপ্টেম্বর ২০২৬)*।
   *
   * ⚠️ ৩০:২৫ অনুপাত ধরে পুরো ৩০ ফেরত আসে, ঠিক সকালের বণ্টনের মতো।
   */
  it('⭐⭐⭐ হাত খালি, কিছুই শেষ হয়নি → পুরো ৩০', () => {
    expect(at(0, 0)).toBe(30);
  });

  /**
   * ⭐⭐⭐ **এটাই আসল কাজের অবস্থা।** ২০টা বাদ দিয়ে ১০টা শেষ করে হাত
   * খালি — টার্গেটে পৌঁছতে আরও ১৫ লাগে, আর বাদ দেওয়ার জায়গাসহ ১৮।
   */
  it('⭐⭐⭐ ১০ শেষ, হাত খালি → বাকি ১৫-র জন্য ১৮', () => {
    expect(at(10, 0)).toBe(18);
  });

  /**
   * ⭐⭐⭐ **হাত ভরা থাকলে কিছুই দেওয়া হয় না** — আর মাঠে এটাই স্বাভাবিক
   * অবস্থা: ৭ ও ৮ সেপ্টেম্বরে সবার হাতে ছিল ১৭–২৯টা।
   */
  it('⭐⭐⭐ হাতে যথেষ্ট আছে → ০', () => {
    expect(at(0, 30)).toBe(0);
    expect(at(10, 20)).toBe(0);
  });

  /** ⭐ হাতে কিছু আছে, তবু যথেষ্ট নয় — ঘাটতিটুকুই দেওয়া হয় */
  it('⭐⭐ হাতে ৫, দরকার ১৮ → বাকি ১৩', () => {
    expect(at(10, 5)).toBe(13);
  });

  /**
   * ⚠️⚠️ **টার্গেট ছোঁয়া হয়ে গেলে আর কিছুই নয়** — নইলে নিয়ম দুটো
   * পরস্পরকে কাটত: সীমা বলত "আর শেষ কোরো না", আর এটা আরও কাজ ঢালত।
   */
  it('⭐⭐⭐ টার্গেট ছোঁয়া হয়ে গেছে → ০, হাত খালি হলেও', () => {
    expect(at(25, 0)).toBe(0);
    expect(at(32, 0)).toBe(0);
  });

  /** ⚠️ টার্গেট নেই যাঁর (ম্যানেজার) — সকালের বণ্টনই যথেষ্ট */
  it('⭐⭐ টার্গেট ০ → কখনো কিছু দেওয়া হয় না', () => {
    expect(topUpSize({ staffType: 'designer', completedToday: 0, openCount: 0, issuedToday: 0, dailyTarget: 0 })).toBe(0);
  });


  /**
   * ⭐⭐⭐ **গেটটা ফাংশনের ভেতরে, কলারে নয়** *(৯ সেপ্টেম্বর ২০২৬)*।
   *
   * ⚠️⚠️ `DESIGN_WORK_STAFF_TYPES`-এ ম্যানেজারও আছেন, তাই তিনিও সকালের
   * বণ্টন পান — আর `designTargetOf()` তাঁর জন্যও পলিসির **২৫** ফেরত দেয়।
   * গেটটা কলারে থাকলে একদিন কেউ ভুলে যেতেন, আর মাঠে দিনে ৪৪ করা
   * ম্যানেজার নীরবে ২৫-টার্গেটের ডিজাইনার হয়ে যেতেন।
   */
  it('⭐⭐⭐ ম্যানেজারের টপ-আপ নেই — টার্গেটের সংখ্যা যাই হোক', () => {
    expect(
      topUpSize({
        staffType: 'manager',
        completedToday: 0,
        openCount: 0,
        issuedToday: 0,
        dailyTarget: 25,
      }),
    ).toBe(0);
  });

  /**
   * ⭐⭐⭐ **দিনের ছাদ — নইলে প্রতিটা Skip এক-এক করে ভরপাই হতো।**
   *
   * ⚠️⚠️ হাতে ৩০, কিছুই শেষ হয়নি → চাই ৩০ → দেওয়া হয় ০। একটা বাদ দিলেই
   * হাতে ২৯ → আবার ১টা, আবার বাদ → আবার ১টা। ছাদ ছাড়া কেউ একদিনে গোটা
   * পুল ঘেঁটে ফেলতে পারতেন।
   */
  it('⭐⭐⭐ একটা Skip ঠিক একটাই ফেরত আনে, আর ছাদ ফুরালে কিছুই নয়', () => {
    // ⭐ হাতে ২৯, কিছুই শেষ হয়নি → ঘাটতি ১
    expect(at(0, 29)).toBe(1);
    // ⚠️ আজ ইতিমধ্যেই ৬০টা দেওয়া হয়ে গেছে — ছাদ ফুরিয়েছে
    expect(at(0, 29, MAX_ISSUED_PER_DAY)).toBe(0);
  });

  it('⭐⭐ ছাদের কাছাকাছি এলে যতটুকু বাকি, ততটুকুই', () => {
    expect(at(10, 0, MAX_ISSUED_PER_DAY - 4)).toBe(4);
  });

  /** ⚠️ অনুপাতটা টার্গেটের সাথে বদলায়, ১.২ ধ্রুবক নয় */
  it('⭐⭐ টার্গেট ৩০ হলে অনুপাতটাও সাথে যায়', () => {
    expect(topUpSize({ staffType: 'designer', completedToday: 0, openCount: 0, issuedToday: 0, dailyTarget: 30 })).toBe(30);
    expect(topUpSize({ staffType: 'designer', completedToday: 15, openCount: 0, issuedToday: 0, dailyTarget: 30 })).toBe(15);
  });
});

describe('allocationSizes — কাকে কতগুলো', () => {
  /** ⚠️ হাতে থাকা টার্গেট বাদ দিয়ে — নইলে সপ্তাহে দুশো জমে যেত */
  it('হাতে যা আছে তা বাদ দিয়ে ৩০ পূর্ণ করা হয়', () => {
    const sizes = allocationSizes(
      [
        { employeeId: 1, openCount: 0 },
        { employeeId: 2, openCount: 22 },
        { employeeId: 3, openCount: 30 },
      ],
      1000,
    );

    expect(sizes.get(1)).toBe(30);
    expect(sizes.get(2)).toBe(8);
    // ⚠️ যাঁর হাত ভরা, তাঁর সারিই বসে না — "০" পাঠানোর মানে নেই
    expect(sizes.has(3)).toBe(false);
  });

  /**
   * ⚠️⚠️ **পুল ফুরিয়ে গেলে যতটা আছে ততটাই** — আর ক্রমটা কলারের দেওয়া
   * (কর্মী-কোড), র‍্যান্ডম নয়। ঘাটতির দিনে কে পাবে সেটা অনুমেয় থাকা
   * দরকার, নইলে রোজ আলাদা লোক বঞ্চিত হতেন আর কেউ কারণ বলতে পারত না।
   */
  it('পুলে কম থাকলে ক্রম মেনে যতটা পারা যায়', () => {
    const sizes = allocationSizes(
      [
        { employeeId: 1, openCount: 0 },
        { employeeId: 2, openCount: 0 },
      ],
      40,
    );

    expect(sizes.get(1)).toBe(30);
    expect(sizes.get(2)).toBe(10);
  });

  it('পুল খালি হলে কেউ কিছু পায় না', () => {
    expect(allocationSizes([{ employeeId: 1, openCount: 0 }], 0).size).toBe(0);
  });

  /** ⭐ ডিজাইনার না থাকলেও ক্র্যাশ নয় */
  it('কেউ না থাকলে খালি', () => {
    expect(allocationSizes([], 500).size).toBe(0);
  });
});


/**
 * ⭐⭐ **কারা টার্গেট-অংশটা ব্যবহার করতে পারেন** *(২৫ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ এই describe-টার আসল কাজ **হ্যাঁ-তালিকা পাহারা দেওয়া**। সূত্রটা
 * যদি কোনোদিন `role !== employee` ধাঁচে ফিরে যায়, তাহলে `UserRole`-এ
 * বসা **পরের** নতুন মানটা নীরবে ঢুকে পড়বে — ঠিক যেমনটা ২৫ আগস্ট
 * `researcher` বসানোর সময় স্ক্রিনশট ও বেতন-সমন্বয়ে ধরা পড়েছিল।
 * ⭐ তাই নিচে "কে পারেন" নয়, **"কে পারেন না"** সেটাও লেখা আছে।
 */
describe('canUseTargets — কে টার্গেট-অংশ ছুঁতে পারেন', () => {
  it('মালিক পারেন', () => {
    expect(canUseTargets(UserRole.owner)).toBe(true);
  });

  it('ম্যানেজার পারেন', () => {
    expect(canUseTargets(UserRole.manager)).toBe(true);
  });

  it('⭐ গবেষক পারেন — এটাই ২৫ আগস্টের গোটা বদল', () => {
    expect(canUseTargets(UserRole.researcher)).toBe(true);
  });

  /**
   * ⚠️⚠️ **সবচেয়ে জরুরি দাবি।** ডিজাইনার গোটা দলের পুল দেখেন না — তিনি
   * নিজের ৩০টা দেখেন `/me/targets`-এ। এটা ভাঙলে ন-জন ডিজাইনার হঠাৎ
   * একে অপরের কাজ দেখতে ও বদলাতে পারতেন।
   */
  it('⚠️ ডিজাইনার (employee) পারেন না', () => {
    expect(canUseTargets(UserRole.employee)).toBe(false);
  });

  /**
   * ⚠️⚠️ **সূত্রটা সত্যিই হ্যাঁ-তালিকা কি না, সেটাই এখানে মাপা হচ্ছে।**
   * `UserRole`-এর প্রতিটা মান ধরে ধরে দেখা হয়, আর যেগুলোর নাম তালিকায়
   * নেই সেগুলো **অবশ্যই** `false` হতে হবে। কেউ যদি একদিন সূত্রটা
   * `!== employee` করে দেন, এই টেস্টটা তখনই লাল হবে — enum-এ নতুন মান
   * বসার দিন নয়, তারও আগে।
   */
  it('⭐⭐ তালিকার বাইরের প্রতিটা ভূমিকা "না"', () => {
    const allowed = new Set<string>([
      UserRole.owner,
      UserRole.manager,
      UserRole.researcher,
    ]);

    for (const role of Object.values(UserRole)) {
      expect(canUseTargets(role)).toBe(allowed.has(role));
    }
  });
});
