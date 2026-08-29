import { describe, expect, it } from 'vitest';

import {
  blockedNotice,
  openInTabs,
  type OpenedTab,
} from '../src/lib/popups';

/**
 * **৩০টা ট্যাব একসাথে খোলা** *(২৯ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ টেস্টের আসল বিষয় **সফল হওয়া নয়, আটকে যাওয়া** — ব্রাউজার এক
 * চাপে একটার বেশি ট্যাব খুলতে দেয় না, আর সেই অবস্থাটাই মাঠে রোজ ঘটবে।
 * ওটা ভুলভাবে সামলালে ডিজাইনার একটা ট্যাব দেখে ভাবতেন বোতাম ভাঙা।
 *
 * ⭐ `window` লাগে না — `openInTabs` খোলার কাজটা বাইরে থেকে নেয়, তাই
 * jsdom ছাড়াই নকল ব্রাউজার বসানো যায় (`vitest.config.ts`-এর নিয়ম)।
 */

/** নকল ট্যাব — `opener` বসানো হয়েছে কি না সেটাই দেখার জিনিস */
function tab(): OpenedTab {
  return { opener: { fake: 'window' } };
}

describe('openInTabs', () => {
  it('সব খুললে সবগুলোই গোনা হয়', () => {
    const opened = openInTabs(['a', 'b', 'c'], () => tab());
    expect(opened).toEqual({ opened: 3, blocked: 0 });
  });

  /**
   * ⚠️⚠️ tabnabbing — এই একটা লাইন না থাকলে খোলা ট্যাব `window.opener`
   * ধরে ডিজাইনারের পাতাটাকে নকল লগইনে সরিয়ে দিতে পারত।
   */
  it('খোলা প্রতিটা ট্যাবের opener কেটে দেয়', () => {
    const made: OpenedTab[] = [];
    openInTabs(['a', 'b'], () => {
      const t = tab();
      made.push(t);
      return t;
    });
    expect(made).toHaveLength(2);
    expect(made.every((t) => t.opener === null)).toBe(true);
  });

  /** ⭐ Chrome-এর আসল আচরণ: প্রথমটা খোলে, বাকিগুলো আটকায় */
  it('প্রথমটা খুলে বাকিগুলো আটকালে ঠিক গোনে', () => {
    let n = 0;
    const result = openInTabs(['a', 'b', 'c'], () => (n++ === 0 ? tab() : null));
    expect(result).toEqual({ opened: 1, blocked: 2 });
  });

  /**
   * ⚠️ আটকে গেলেও লুপ থামে না — মাঝেরটা আটকালে শেষেরটা যেন হারিয়ে
   * না যায়। সব ব্রাউজার Chrome-এর নিয়মে চলে না।
   */
  it('মাঝপথে আটকালেও পরেরগুলো চেষ্টা করে', () => {
    const pattern = [tab(), null, tab()];
    let n = 0;
    const result = openInTabs(['a', 'b', 'c'], () => pattern[n++]);
    expect(result).toEqual({ opened: 2, blocked: 1 });
  });

  it('তালিকা খালি হলে কিছুই হয় না', () => {
    expect(openInTabs([], () => tab())).toEqual({ opened: 0, blocked: 0 });
  });
});

describe('blockedNotice', () => {
  it('কিছু না আটকালে চুপ থাকে', () => {
    expect(blockedNotice(30, 0)).toBeNull();
  });

  it('সব আটকালে সংখ্যাটা মোটের সংখ্যা', () => {
    expect(blockedNotice(30, 30)).toContain('all 30 tabs');
  });

  it('আংশিক আটকালে দুটো সংখ্যাই বলে', () => {
    expect(blockedNotice(30, 29)).toContain('29 of 30 tabs');
  });

  /**
   * ⚠️⚠️ সবচেয়ে জরুরি টেস্ট — বার্তায় **করণীয়** থাকতেই হবে। "আটকে গেছে"
   * বললে কেউ জানত না এরপর কী, আর রোজ ৩০টা লিঙ্ক হাতে খুলত।
   */
  it('কী করতে হবে সেটাও বলে', () => {
    const msg = blockedNotice(30, 29) ?? '';
    expect(msg).toContain('Allow pop-ups');
    expect(msg).toContain('address bar');
  });
});
