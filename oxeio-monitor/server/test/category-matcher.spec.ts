import { describe, expect, it } from 'vitest';

import {
  compile,
  matchCategory,
  type CategoryRule,
} from '../src/activity/category-matcher';

/**
 * D05 — ক্যাটাগরি মেলানো।
 *
 * এখানে যা যাচাই হয় তার বেশিরভাগই **নীরব ভুলের** পরীক্ষা: ক্রম উল্টে গেলে
 * বা সাবডোমেইনের সীমানা ভুল হলে কোথাও কোনো এরর ওঠে না, শুধু রিপোর্টের
 * সংখ্যাগুলো ভুল হয়ে যায় — আর সেটা কেউ ধরতে পারে না।
 */

let nextId = 1;

function rule(
  matchType: CategoryRule['matchType'],
  pattern: string,
  category: CategoryRule['category'],
  priority = 100,
): CategoryRule {
  return {
    id: nextId++,
    matchType,
    pattern,
    displayName: pattern,
    category,
    priority,
  };
}

const CHROME = rule('process', 'chrome.exe', 'neutral', 200);
const YOUTUBE = rule('domain', 'youtube.com', 'unproductive');
const GOOGLE = rule('domain', 'google.com', 'neutral');
const GMAIL = rule('domain', 'mail.google.com', 'productive');
const JIRA = rule('domain', 'atlassian.net', 'productive');
const EXCEL = rule('process', 'excel.exe', 'productive');

const RULES = compile([CHROME, YOUTUBE, GOOGLE, GMAIL, JIRA, EXCEL]);

const match = (facts: {
  processName: string;
  domain?: string | null;
  windowTitle?: string | null;
}) => matchCategory(RULES, facts);

describe('category matcher — ক্রম', () => {
  /**
   * ⭐ সবচেয়ে গুরুত্বপূর্ণ টেস্ট। ক্রম উল্টে গেলে `chrome.exe` (neutral)
   * সবসময় জিতত, আর **প্রতিটা ব্রাউজিং মিনিট neutral** হয়ে যেত —
   * youtube.com-ও, github.com-ও। D05 তখন কিছুই আলাদা করত না।
   */
  it('ডোমেইনের নিয়ম ব্রাউজারের প্রসেসকে হারায়', () => {
    const hit = match({ processName: 'chrome.exe', domain: 'youtube.com' });

    expect(hit?.category).toBe('unproductive');
    expect(hit?.displayName).toBe('youtube.com');
  });

  /** নির্দিষ্টটা আগে — নইলে Gmail "neutral সার্চ ইঞ্জিন" হয়ে যেত। */
  it('বেশি নির্দিষ্ট ডোমেইন কম নির্দিষ্টটাকে হারায়', () => {
    expect(
      match({ processName: 'chrome.exe', domain: 'mail.google.com' })?.category,
    ).toBe('productive');

    expect(
      match({ processName: 'chrome.exe', domain: 'www.google.com' })?.category,
    ).toBe('neutral');
  });

  it('ডোমেইন না পড়া গেলে ব্রাউজারের নিজের নিয়মই থাকে', () => {
    // URL পড়া ব্যর্থ হয়েছে — "ব্রাউজারে ছিল" টুকুই জানা
    const hit = match({ processName: 'chrome.exe', domain: null });

    expect(hit?.category).toBe('neutral');
    expect(hit?.displayName).toBe('chrome.exe');
  });

  it('একই ইনপুটে প্রতিবার একই ফল', () => {
    const shuffled = compile([GMAIL, CHROME, JIRA, GOOGLE, YOUTUBE, EXCEL]);
    const facts = { processName: 'chrome.exe', domain: 'mail.google.com' };

    expect(matchCategory(shuffled, facts)?.id).toBe(
      matchCategory(RULES, facts)?.id,
    );
  });
});

describe('category matcher — ডোমেইনের সীমানা', () => {
  it('সাবডোমেইন মেলে', () => {
    // প্রতিটা কোম্পানির Jira আলাদা সাবডোমেইনে — নইলে নিয়মটা অকেজো
    expect(
      match({ processName: 'chrome.exe', domain: 'acme.atlassian.net' })
        ?.category,
    ).toBe('productive');
  });

  /**
   * ⚠️ সাধারণ `endsWith()` লিখলে এগুলোও "Google" হয়ে যেত।
   * কেউ ইচ্ছে করে `notgoogle.com` বানিয়ে রিপোর্ট বিভ্রান্ত করতে পারত।
   */
  it.each(['notgoogle.com', 'evilgoogle.com', 'xgoogle.com'])(
    '%s কে google.com ধরা হয় না',
    (domain) => {
      expect(match({ processName: 'chrome.exe', domain })?.displayName).not.toBe(
        'google.com',
      );
    },
  );

  it('মিল শেষ থেকে হয় — youtube.com.bd আলাদা সাইট', () => {
    // ⚠️ ডোমেইনের নিয়মটা মেলেনি, তাই ব্রাউজারের নিজের নিয়মেই পড়ে থাকে
    const hit = match({ processName: 'chrome.exe', domain: 'youtube.com.bd' });

    expect(hit?.displayName).toBe('chrome.exe');
    expect(hit?.category).toBe('neutral');
  });

  it('বড়-ছোট হাতের তফাত ধরা হয় না', () => {
    expect(
      match({ processName: 'CHROME.EXE', domain: 'YouTube.COM' })?.category,
    ).toBe('unproductive');
  });
});

describe('category matcher — যা মেলে না', () => {
  /**
   * ⚠️ অচেনা অ্যাপকে জোর করে neutral বানানো হয় না। null মানে "জানি না",
   * neutral মানে "জানি, এবং নিরপেক্ষ"। মিলিয়ে ফেললে D07-এর স্কোরে
   * অচেনা অ্যাপ নীরবে ভালো দিকে গোনা হতো।
   */
  it('অচেনা অ্যাপ null থাকে', () => {
    expect(match({ processName: 'unknown-thing.exe' })).toBeNull();
  });

  it('ছদ্মবেশী ব্রাউজিংয়েও প্রসেসের নিয়ম কাজ করে', () => {
    // domain আর title দুটোই null — DomainParser.LooksPrivate ছেঁটে দিয়েছে
    const hit = match({
      processName: 'chrome.exe',
      domain: null,
      windowTitle: null,
    });

    expect(hit?.category).toBe('neutral');
  });

  it('খালি প্রসেসের নামে কিছু মেলে না', () => {
    expect(match({ processName: '' })).toBeNull();
  });
});

describe('category matcher — title_regex', () => {
  const TITLE = rule('title_regex', 'Figma$', 'productive');
  const withTitle = compile([TITLE, CHROME]);

  it('টাইটেল মিললে ধরা হয়', () => {
    expect(
      matchCategory(withTitle, {
        processName: 'chrome.exe',
        windowTitle: 'Dashboard — Figma',
      })?.category,
    ).toBe('productive');
  });

  it('টাইটেল না মিললে ধরা হয় না', () => {
    expect(
      matchCategory(withTitle, {
        processName: 'chrome.exe',
        windowTitle: 'Dashboard — Sketch',
      })?.displayName,
    ).toBe('chrome.exe');
  });

  /**
   * ⚠️ ভুল regex-এ ingest ভেঙে পড়লে **ওই ব্যাচের পুরো ডেটা** হারাত।
   * একটা নিয়ম বাদ পড়া অনেক কম ক্ষতি।
   */
  it('ভুল regex চুপচাপ বাদ যায়, ingest ভাঙে না', () => {
    const bad = rule('title_regex', '(((', 'productive');
    const compiled = compile([bad, EXCEL]);

    expect(compiled).toHaveLength(1);
    expect(
      matchCategory(compiled, { processName: 'excel.exe' })?.category,
    ).toBe('productive');
  });

  it('অতিরিক্ত লম্বা regex নেওয়া হয় না', () => {
    // ReDoS-এর ঝুঁকি — JavaScript-এ regex টাইমআউট করা যায় না
    const huge = rule('title_regex', 'a'.repeat(300), 'productive');

    expect(compile([huge])).toHaveLength(0);
  });
});

describe('category matcher — অ-ব্রাউজার অ্যাপ', () => {
  it('প্রসেসের নাম হুবহু মিলতে হয়', () => {
    expect(match({ processName: 'excel.exe' })?.category).toBe('productive');
    expect(match({ processName: 'myexcel.exe' })).toBeNull();
    expect(match({ processName: 'excel' })).toBeNull();
  });

  it('ডোমেইন না থাকলে প্রসেসের নিয়মই বসে', () => {
    // এজেন্ট অ-ব্রাউজারে domain পাঠায়ই না
    // (ForegroundWindowProbe: `RawUrl = isBrowser ? … : null`)
    expect(
      match({ processName: 'excel.exe', domain: null })?.displayName,
    ).toBe('excel.exe');
  });
});
