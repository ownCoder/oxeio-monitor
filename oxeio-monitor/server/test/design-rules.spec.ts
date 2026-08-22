import { describe, expect, it } from 'vitest';

import {
  designIdOf,
  keepKnownLongIds,
  KNOWN_JOB_FROM,
  designIdsInDay,
  designView,
  hasDesignTarget,
} from '../src/summary/design.rules';

/**
 * **দৈনিক ডিজাইনের হিসাব** *(২১ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ এই ফাইলের সবচেয়ে জরুরি দুটো দাবি: **ডিজাইন-অ্যাপ ছাড়া কিছু পড়া
 * হয় না** (নইলে একদিন ব্রাউজারের শিরোনাম হিসাবে ঢুকে পড়ত — ঠিক সেই
 * কনটেন্ট-পড়া যা README-তে "কখনোই নয়"), আর **টার্গেট কেবল ডিজাইনারের**।
 *
 * ⭐ নমুনাগুলো বানানো নয় — ১৯–২১ আগস্ট মাঠের `app_usage` থেকে নেওয়া।
 */

describe('designIdOf — শিরোনাম থেকে নম্বর', () => {
  /** ⭐ মাঠের আসল শিরোনাম */
  it.each([
    ['37933-Woodcock Bird Vintage Illustration T-Shirt.ai @ 54 % (RGB/Preview)', '37933'],
    ['37904Love Cockatiel Women Parrot for Bird Lovers T-Shirt.ai', '37904'],
    ['3218-Bruh It\'s My 7th Birthday 7 Year Old Bday Kids T-Shirt.ai', '3218'],
    ['37769......Green Cheek Conure Retro T-Shirt.ai', '37769'],
  ])('%s → %s', (title, id) => {
    expect(designIdOf('Illustrator.exe', title)).toBe(id);
  });

  /**
   * ⚠️⚠️ **শ্বেততালিকা** — নতুন কোনো অ্যাপ নিজে থেকে পড়ার আওতায় আসে না।
   * এই টেস্টটা ভাঙলে বুঝতে হবে কেউ কালোতালিকায় বদলে ফেলেছে।
   */
  it('ডিজাইন-অ্যাপ ছাড়া কিছুই পড়া হয় না', () => {
    for (const app of ['chrome.exe', 'ms-teams.exe', 'explorer.exe', 'notepad.exe']) {
      expect(designIdOf(app, '37933-Something.ai')).toBeNull();
    }
  });

  it('অ্যাপের নাম বড়-ছোট হাতে হলেও চলে', () => {
    expect(designIdOf('ILLUSTRATOR.EXE', '1234-x.ai')).toBe('1234');
    expect(designIdOf('Photoshop.exe', '1234-x.psd')).toBe('1234');
  });

  /**
   * ⚠️ কাজ চলছে এমন ফাইল **গোনা হয় না** — `Untitled-1*` মানে এখনো
   * সংরক্ষণই হয়নি, আর `Template.ai` প্রতিদিন খোলা হয়। ⭐ দুটোই আপনাআপনি
   * বাদ পড়ে, কারণ অঙ্ক দিয়ে শুরু হয় না।
   */
  it.each([
    'Untitled-1* @ 16.67 % (RGB/Preview)',
    'Template.ai* @ 33.33 % (RGB/Preview)',
    'My Custom T-shirt Designing Template.ai*',
    'Raccoon.psd @ 66.7% (Layer 0, RGB/8#)',
    'Vegetable_turkey_t-shirt_design_202608201646_upscayl_4x_real',
  ])('প্রস্তুতির ফাইল বাদ — %s', (title) => {
    expect(designIdOf('Illustrator.exe', title)).toBeNull();
  });

  /** ⚠️ `4 [Converted].eps` মাঠে আছে — এক অঙ্ক কাজের নম্বর নয় */
  /**
   * ⭐⭐ **সাত অঙ্কের কাজের নম্বর** *(২২ আগস্ট ২০২৬)* — টার্গেটের সিরিয়াল
   * শুরু হয়েছে ১০,০০,০০০ থেকে।
   *
   * ⚠️⚠️ আগের নিয়মে (`/^(\d{3,6})/`, সীমানা ছাড়া) এগুলো **প্রথম ছয় অঙ্কে
   * কেটে যেত**, আর পরপর দশটা কাজ একটাই নম্বর হয়ে যেত। নিচের দ্বিতীয়
   * টেস্টটাই সেই ভুলের পাহারাদার।
   */
  it.each([
    ['1000042-Bird Vintage T-Shirt.ai @ 54 % (RGB/Preview)', '1000042'],
    ['1000299-Cat Retro.psd', '1000299'],
    ['1000000-First One.ai', '1000000'],
  ])('সাত অঙ্কের কাজের নম্বর — %s → %s', (title, id) => {
    expect(designIdOf('Illustrator.exe', title)).toBe(id);
  });

  /** ⚠️⚠️ পরপর দুটো কাজ **আলাদা** থাকতেই হবে — এটাই ছিল আসল ক্ষতি */
  it('পরপর কাজের নম্বর মিশে যায় না', () => {
    const a = designIdOf('Illustrator.exe', '1000042-Bird.ai');
    const b = designIdOf('Illustrator.exe', '1000043-Cat.ai');
    expect(a).toBe('1000042');
    expect(b).toBe('1000043');
    expect(a).not.toBe(b);
  });

  /**
   * ⭐ আট বা তার বেশি অঙ্ক = স্টক ফাইলের আইডি, কাজের নম্বর নয়।
   *
   * ⚠️⚠️ মাঠে এগুলোই `design_credits`-এ ৬৬টা ভুল সারি বানিয়েছিল —
   * `10163372_181` → `101633` হয়ে ডিজাইন বলে গোনা হতো।
   */
  it.each([
    '10163372_181_Vector.eps',
    '136482370_79_stock.ai',
    '20260820164512_export.psd',
  ])('আট+ অঙ্কের স্টক আইডি বাদ — %s', (title) => {
    expect(designIdOf('Illustrator.exe', title)).toBeNull();
  });

  it('তিন অঙ্কের কম হলে নয়', () => {
    expect(designIdOf('Illustrator.exe', '4 [Converted].eps')).toBeNull();
    expect(designIdOf('Illustrator.exe', '99-x.ai')).toBeNull();
    expect(designIdOf('Illustrator.exe', '100-x.ai')).toBe('100');
  });

  it('শিরোনাম না থাকলে ক্র্যাশ নয়', () => {
    expect(designIdOf('Illustrator.exe', null)).toBeNull();
    expect(designIdOf('Illustrator.exe', '')).toBeNull();
  });
});

describe('designIdsInDay — অনন্য নম্বর', () => {
  /**
   * ⚠️⚠️ একই ডিজাইনে সারাদিনে বহুবার ফেরা হয় — মাঠে ৩৮৭৩টা সারিতে
   * ১৫৫৩টা আলাদা শিরোনাম। সারি গুনলে সংখ্যাটা অর্থহীন হতো।
   */
  it('একই নম্বর বহুবার এলেও একবার', () => {
    const rows = [
      { processName: 'Illustrator.exe', windowTitle: '37933-A.ai @ 54 %' },
      { processName: 'Illustrator.exe', windowTitle: '37933-A.ai @ 120 %' },
      { processName: 'Illustrator.exe', windowTitle: '37904-B.ai' },
      { processName: 'chrome.exe', windowTitle: '37905-C — Google Chrome' },
      { processName: 'Illustrator.exe', windowTitle: 'Untitled-3*' },
    ];

    expect([...designIdsInDay(rows)].sort()).toEqual(['37904', '37933']);
  });

  it('কিছু না থাকলে খালি সেট', () => {
    expect(designIdsInDay([]).size).toBe(0);
  });
});

describe('hasDesignTarget · designView', () => {
  /**
   * ⚠️⚠️ **ধরন না বসানো মানে "ছেড়ে দাও", "শূন্য" নয়।** নইলে ধরন বসানোর
   * আগ পর্যন্ত প্রত্যেকে রোজ "০/২৫" হয়ে তালিকায় উঠতেন — আর সেটা একটা
   * অভিযোগ, তথ্য নয়।
   */
  it('কেবল ডিজাইনারের টার্গেট আছে', () => {
    expect(hasDesignTarget('designer')).toBe(true);
    expect(hasDesignTarget('researcher')).toBe(false);
    expect(hasDesignTarget('manager')).toBe(false);
    expect(hasDesignTarget(null)).toBe(false);
    expect(hasDesignTarget(undefined)).toBe(false);
  });

  /**
   * ⭐⭐ **মালিকের সিদ্ধান্ত, ২২ আগস্ট** — ম্যানেজার (OX-01) নিজেও ডিজাইন
   * করেন, তিন দিনে ৪৩টা। ধরন বদলানোর পর সংখ্যাটা উধাও হয়ে যাচ্ছিল,
   * অথচ কাজটা সত্যি। তাই সংখ্যা দেখানো হয়, **টার্গেট ছাড়া**।
   */
  it('ডিজাইনার নন, তবু কাজ করেছেন — সংখ্যা দেখায়, টার্গেট ছাড়া', () => {
    expect(designView('manager', 43, 25)).toEqual({
      done: 43,
      target: null,
      met: false,
    });
    expect(designView('researcher', 3, 25)?.target).toBeNull();
  });

  /**
   * ⚠️⚠️ **টার্গেট ছাড়া কারো `met` কখনো `true` নয়** — ৪৩ > ২৫ হলেও।
   * ✅ চিহ্নের মানে "টার্গেট ছোঁয়া", আর তাঁর টার্গেটই নেই।
   */
  it('টার্গেট ছাড়া কেউ কখনো ✅ পায় না', () => {
    expect(designView('manager', 999, 25)?.met).toBe(false);
  });

  /** ⚠️ কাজ না করলে কিছুই নয় — "০" পড়তে অভিযোগের মতো লাগে */
  it('ডিজাইন না করলে কিছুই দেখানো হয় না', () => {
    expect(designView('researcher', 0, 25)).toBeNull();
    expect(designView(null, 0, 25)).toBeNull();
    expect(designView('designer', 0, 0)).toBeNull();
  });

  /** ⚠️ ডিজাইনারের টার্গেট ০ = বন্ধ, তখন সংখ্যাই থাকে (টার্গেট ছাড়া) */
  it('ডিজাইনারের টার্গেট বন্ধ হলে শুধু সংখ্যা', () => {
    expect(designView('designer', 12, 0)).toEqual({
      done: 12,
      target: null,
      met: false,
    });
  });

  /** ⚠️ ঠিক টার্গেটে থাকা = ছোঁয়া, ঘণ্টার নিয়মের সাথে মিলিয়ে */
  it('কাঁটায় কাঁটায় টার্গেট = ছোঁয়া', () => {
    expect(designView('designer', 25, 25)).toEqual({
      done: 25,
      target: 25,
      met: true,
    });
    expect(designView('designer', 24, 25)?.met).toBe(false);
    expect(designView('designer', 39, 25)?.met).toBe(true);
  });
});

/**
 * ⭐⭐ **সাত অঙ্ক হলে নম্বরটা সত্যিই বরাদ্দ করা হতে হবে** *(২২ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ কারণ সাত অঙ্কের স্টক-আইডিও আছে — মাঠে এক দিনেই চারটে ঢুকেছিল
 * (`1536601`, `5005369`, `5524618`, `9937760`), আর ওগুলো ডিজাইন বলে
 * গোনা হচ্ছিল।
 */
describe('keepKnownLongIds — লম্বা নম্বর তালিকায় থাকতেই হবে', () => {
  it('সীমাটা দশ লাখ', () => {
    expect(KNOWN_JOB_FROM).toBe(1_000_000);
  });

  it('জানা কাজের নম্বর টেকে', () => {
    const kept = keepKnownLongIds(new Set(['1000042']), new Set(['1000042']));
    expect([...kept]).toEqual(['1000042']);
  });

  /** ⚠️ মাঠে পাওয়া আসল স্টক-আইডিগুলো */
  it.each(['1536601', '5005369', '5524618', '9937760'])(
    'অজানা লম্বা নম্বর বাদ — %s',
    (id) => {
      expect(keepKnownLongIds(new Set([id]), new Set()).size).toBe(0);
    },
  );

  /**
   * ⚠️⚠️ ছয় অঙ্ক বা কম **এই শর্তের বাইরে** — পুরোনো কাজের (৩৭৯৩৩ ধাঁচের)
   * কোনো টার্গেট-সারি নেই। শর্তে ফেললে পুরো ইতিহাস নীরবে শূন্য হতো।
   * ⭐ এই টেস্টটাই সেই ভুলের পাহারাদার।
   */
  it.each(['193', '3218', '37933', '973065'])(
    'ছোট নম্বর তালিকা ছাড়াই টেকে — %s',
    (id) => {
      expect([...keepKnownLongIds(new Set([id]), new Set())]).toEqual([id]);
    },
  );

  it('মেশানো সেটে কেবল অজানা লম্বাগুলোই পড়ে', () => {
    const kept = keepKnownLongIds(
      new Set(['37933', '1000042', '5524618', '973065']),
      new Set(['1000042']),
    );
    expect([...kept].sort()).toEqual(['1000042', '37933', '973065']);
  });

  /** ⭐ তালিকা খালি হলে (টার্গেট চালুর আগের দিন) সব লম্বা নম্বর বাদ */
  it('তালিকা খালি হলে লম্বা নম্বর টেকে না', () => {
    expect(keepKnownLongIds(new Set(['1000042']), new Set()).size).toBe(0);
  });
});
