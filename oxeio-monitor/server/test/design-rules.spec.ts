import { describe, expect, it } from 'vitest';

import {
  designIdOf,
  designIdsInDay,
  designProgress,
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

describe('hasDesignTarget · designProgress', () => {
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

  it('ডিজাইনার নন — পর্দায় কিছুই নয়', () => {
    expect(designProgress('researcher', 12, 25)).toBeNull();
    expect(designProgress(null, 12, 25)).toBeNull();
  });

  /** ⚠️ টার্গেট ০ মানে বন্ধ — তখনও কেউ "পিছিয়ে" নয় */
  it('টার্গেট ০ হলে হিসাবটাই দেখানো হয় না', () => {
    expect(designProgress('designer', 12, 0)).toBeNull();
  });

  /** ⚠️ ঠিক টার্গেটে থাকা = ছোঁয়া, ঘণ্টার নিয়মের সাথে মিলিয়ে */
  it('কাঁটায় কাঁটায় টার্গেট = ছোঁয়া', () => {
    expect(designProgress('designer', 25, 25)).toEqual({
      done: 25,
      target: 25,
      met: true,
    });
    expect(designProgress('designer', 24, 25)?.met).toBe(false);
    expect(designProgress('designer', 39, 25)?.met).toBe(true);
  });
});
