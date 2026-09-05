import { describe, expect, it } from 'vitest';

import {
  isProvenBy,
  isOfferedTo,
  nextStage,
  ROLLOUT_FRESH_MINUTES,
  ROLLOUT_SOAK_HOURS,
  stageToAdvanceTo,
  type DeviceProof,
} from '../src/agent/rollout';

/**
 * ⭐⭐⭐ **H04 — রোলআউট নিজে থেকে এগোনোর নিয়ম** *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * মালিক: *"update gula office staff ra pacche na. every single pc te
 * manually install korte hocche."*
 *
 * ⚠️⚠️ **কারণটা একটা বাগ ছিল না, একটা অনুপস্থিত ধাপ।** বালতি · শতাংশ ·
 * পাইলট · জরুরি ব্রেক — ধাপে-ধাপে রোলআউটের গোটা যন্ত্রটাই তৈরি ছিল, শুধু
 * `canary → partial → all` বদলানোর একমাত্র পথ ছিল **হাতে ক্লিক**। কেউ না
 * চাপলে নতুন ভার্সন চিরকাল ৭%-এ বসে থাকত, অর্থাৎ ১২টার মধ্যে ১১টা PC-কে
 * কোনোদিন অফারই যেত না।
 *
 * ⭐⭐ **এই ফাইলের আসল কাজ নতুন আচরণটা পাহারা দেওয়া নয় — পুরোনো
 * নিরাপত্তাগুলো অক্ষত আছে কি না দেখা।** স্বয়ংক্রিয় করা মানে যদি জরুরি ব্রেক
 * খুলে যায়, বা ভাঙা বিল্ড নিজে থেকে ছড়ায়, তাহলে সমস্যাটা আগের চেয়ে অনেক
 * বড় হলো।
 */

const HOUR_MS = 3600_000;
const NOW = new Date('2026-09-05T12:00:00.000Z');

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR_MS);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

/** একটা সুস্থ canary মেশিন — ছ-ঘণ্টার বেশি চালাচ্ছে, এইমাত্র সাড়া দিয়েছে */
function healthy(over: Partial<DeviceProof> = {}): DeviceProof {
  return {
    versionSince: hoursAgo(ROLLOUT_SOAK_HOURS + 1),
    lastSeenAt: minutesAgo(1),
    ...over,
  };
}

describe('nextStage — জরুরি ব্রেক স্বয়ংক্রিয় কিছুর হাতে নয়', () => {
  it('canary → partial → all', () => {
    expect(nextStage('canary')).toBe('partial');
    expect(nextStage('partial')).toBe('all');
  });

  it('`all` শেষ ধাপ — এগোনোর কিছু নেই', () => {
    expect(nextStage('all')).toBeNull();
  });

  /**
   * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট।**
   *
   * ⚠️⚠️ `halted` মানে মালিক জরুরি ব্রেক চেপেছেন — সাধারণত এই কারণেই যে
   * বিল্ডটা মাঠে কিছু ভেঙেছে। স্বয়ংক্রিয় কিছু ওটা খুলতে পারলে ব্রেকটা আর
   * ব্রেক থাকত না, আর ভাঙা বিল্ডটা **নিজে থেকেই** বাকি সব PC-তে চলে যেত।
   * এতদিন ঝুঁকিটা ছিল না, কারণ ধাপ বাড়ত কেবল মানুষের ক্লিকে।
   */
  it('⭐ `halted` থেকে কোনো পথ নেই', () => {
    expect(nextStage('halted')).toBeNull();
  });
});

describe('isProvenBy — একটা মেশিন কি সত্যিই প্রমাণ দিচ্ছে', () => {
  it('ছ-ঘণ্টা চালাচ্ছে আর এখনো সাড়া দিচ্ছে — প্রমাণ', () => {
    expect(isProvenBy(healthy(), NOW)).toBe(true);
  });

  it('সবে বসানো হয়েছে — এখনো কিছু প্রমাণ হয়নি', () => {
    // ⚠️ পাঁচ মিনিট আগে বসানো একটা বিল্ড কিছুই বলে না; soak-এর পুরো মানেই এটা
    expect(isProvenBy(healthy({ versionSince: minutesAgo(5) }), NOW)).toBe(false);
  });

  /**
   * ⭐⭐⭐ **এটাই আসল পরীক্ষা, আর সবচেয়ে সহজে বাদ পড়ে যেত।**
   *
   * ⚠️⚠️ শুধু "ছ-ঘণ্টা ধরে চালাচ্ছে" শর্ত রাখলে **মৃত এজেন্টওয়ালা মেশিনও**
   * প্রমাণ হয়ে যেত — অর্থাৎ ঠিক যে বিল্ডটা এজেন্টকে মেরে ফেলেছে, সেটাই
   * নিজে থেকে বাকি সবার কাছে পৌঁছে যেত। যে বিল্ড ক্র্যাশ করে, তার ডিভাইস
   * চুপ হয়ে যায় — নীরবতাটাই সবচেয়ে জোরালো সংকেত।
   */
  it('⭐ ছ-ঘণ্টা হয়েছে, কিন্তু এজেন্ট চুপ — প্রমাণ নয়', () => {
    expect(
      isProvenBy(
        healthy({ lastSeenAt: minutesAgo(ROLLOUT_FRESH_MINUTES + 10) }),
        NOW,
      ),
    ).toBe(false);
  });

  /**
   * ⚠️ `null` = "জানি না", আর অজানাকে প্রমাণ ধরা যায় না। ⭐ এটা কেবল
   *    তাত্ত্বিক নয়: মাইগ্রেশনের দিন **প্রতিটা** পুরোনো সারিতে ঘরটা খালি
   *    থাকে। "জানি না"-কে "অনেকদিন ধরে চলছে" ধরলে ঠিক ওই দিনই সব ভার্সন
   *    এক লাফে `all`-এ চলে যেত।
   */
  it('⭐ ট্র্যাকিং-শুরু জানা না থাকলে প্রমাণ নয়', () => {
    expect(isProvenBy(healthy({ versionSince: null }), NOW)).toBe(false);
  });

  it('কখনো সাড়া দেয়নি — প্রমাণ নয়', () => {
    expect(isProvenBy(healthy({ lastSeenAt: null }), NOW)).toBe(false);
  });

  /**
   * ⚠️ ঠিক সীমানায় প্রমাণ হয় — নইলে "ছ-ঘণ্টা" কথাটা আসলে "ছ-ঘণ্টা এক
   *    টিক" হতো, আর তখন জবের ঘণ্টাভিত্তিক টিকের সাথে মিলে দেরিটা
   *    এক ঘণ্টা বেড়ে যেত।
   */
  it('ঠিক ছ-ঘণ্টায় প্রমাণ', () => {
    expect(isProvenBy(healthy({ versionSince: hoursAgo(ROLLOUT_SOAK_HOURS) }), NOW)).toBe(
      true,
    );
  });
});

describe('stageToAdvanceTo — জব কেবল সারি আনে, সিদ্ধান্ত এখানে', () => {
  it('সুস্থ canary → partial', () => {
    expect(stageToAdvanceTo('canary', [healthy()], NOW)).toBe('partial');
  });

  it('সুস্থ partial → all', () => {
    expect(stageToAdvanceTo('partial', [healthy()], NOW)).toBe('all');
  });

  /**
   * ⭐⭐ **কেউ ইনস্টল না করলে ধাপ বাড়ে না** — আর এটাই এই নকশার কেন্দ্র।
   *
   * ⚠️⚠️ শর্তটা "প্রকাশের ছ-ঘণ্টা পর" (`released_at`) হতে পারত, আর সেটাই
   * সবচেয়ে সহজ ছিল। কিন্তু তাতে canary-র পুরো মানেই মুছে যেত: **একটাও
   * মেশিন বিল্ডটা না চালালেও** ধাপ বাড়ত, অর্থাৎ "আগে একটা PC-তে পরীক্ষা"
   * কথাটা কাগজেই থেকে যেত।
   */
  it('⭐ কোনো মেশিন এই বিল্ডটা চালাচ্ছেই না — ধাপ বাড়ে না', () => {
    expect(stageToAdvanceTo('canary', [], NOW)).toBeNull();
  });

  it('⭐ চালাচ্ছে, কিন্তু কেউ প্রমাণ দিচ্ছে না — ধাপ বাড়ে না', () => {
    const tooNew = healthy({ versionSince: minutesAgo(10) });
    const silent = healthy({ lastSeenAt: minutesAgo(ROLLOUT_FRESH_MINUTES + 1) });

    expect(stageToAdvanceTo('canary', [tooNew, silent], NOW)).toBeNull();
  });

  /**
   * ⚠️ **অন্তত একটা**, সবগুলো নয়। ছুটিতে থাকা কারো PC বন্ধ থাকলে "সবাই"
   *    শর্তে রোলআউট চিরকাল আটকে থাকত — অর্থাৎ যে সমস্যাটা সারানো হচ্ছে
   *    সেটাই ফিরে আসত, কেবল অন্য মোড়কে।
   */
  it('একজন প্রমাণ দিলেই যথেষ্ট — বাকিদের PC বন্ধ থাকতে পারে', () => {
    const off = healthy({ lastSeenAt: hoursAgo(20) });

    expect(stageToAdvanceTo('canary', [off, healthy(), off], NOW)).toBe('partial');
  });

  it('⭐ `halted`-এ সুস্থ মেশিন থাকলেও কিছুই হয় না', () => {
    expect(stageToAdvanceTo('halted', [healthy(), healthy()], NOW)).toBeNull();
  });

  it('`all` থেকে আর এগোনোর কিছু নেই', () => {
    expect(stageToAdvanceTo('all', [healthy()], NOW)).toBeNull();
  });
});

/**
 * ⭐⭐ **বিলির নিয়ম আর এগোনোর নিয়ম — দুটো আলাদা, আর আলাদাই থাকা চাই।**
 *
 * ⚠️ এই describe-টা নতুন কিছু পরীক্ষা করে না; এটা দেখে যে **নতুন কোডটা
 * পুরোনোটাকে ছোঁয়নি**। রোলআউট স্বয়ংক্রিয় করতে গিয়ে কেউ যদি একদিন
 * `isOfferedTo`-তে হাত দেন, ভাঙাটা এখানে ধরা পড়বে।
 */
describe('বিলির নিয়ম অক্ষত — স্বয়ংক্রিয় করা কিছু বদলায়নি', () => {
  const GUID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

  it('`halted`-এ কেউ পায় না — পাইলটও নয়', () => {
    expect(isOfferedTo('halted', GUID, '0.4.11', true)).toBe(false);
  });

  it('`all`-এ সবাই পায়', () => {
    expect(isOfferedTo('all', GUID, '0.4.11')).toBe(true);
  });

  it('পাইলট বালতি নির্বিশেষে পায়', () => {
    expect(isOfferedTo('canary', GUID, '0.4.11', true)).toBe(true);
  });
});
