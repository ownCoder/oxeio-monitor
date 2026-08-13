import { describe, expect, it } from 'vitest';

import type { LiveCard, LiveStatus } from '../src/api/dashboard';
import { isWorking, splitBoard } from '../src/pages/live/onTheClock';

/**
 * Live Board-এর দুই ট্যাব — **কাজ করছেন** আর **করছেন না**।
 *
 * ⚠️⚠️ এখানকার ভুল দেখতে ছোট, কিন্তু ফল বড়: কেউ যদি কোনো ট্যাবেই না পড়ে,
 * সে বোর্ড থেকে **নীরবে উধাও** হয়ে যায়। ১৫ জনের অফিসে একজন কম দেখালে
 * সেটা চোখে পড়ার কথা নয়।
 */
const ALL: LiveStatus[] = ['active', 'idle', 'offline', 'agent_down'];

const card = (status: LiveStatus, employeeId: number): LiveCard =>
  ({ employeeId, status }) as LiveCard;

describe('isWorking', () => {
  it('শুধু active-ই কাজ', () => {
    expect(isWorking('active')).toBe(true);
  });

  /**
   * ⚠️⚠️ `idle` মানে PC চালু, কিন্তু হাত থেমে আছে — কাজ নয়। দুটো এক করে
   * ফেললে মালিকের চোখের সামনেই সংখ্যাটা ফুলে উঠত, অথচ কেউ বেশি কাজ করেনি।
   */
  it('idle কাজ নয়', () => {
    expect(isWorking('idle')).toBe(false);
  });

  it('offline ও agent_down কাজ নয়', () => {
    expect(isWorking('offline')).toBe(false);
    expect(isWorking('agent_down')).toBe(false);
  });
});

describe('splitBoard', () => {
  it('কাজ করছেন যাঁরা, তাঁরাই প্রথম ভাগে', () => {
    const { working } = splitBoard([card('active', 1), card('idle', 2)]);

    expect(working.map((c) => c.employeeId)).toEqual([1]);
  });

  /**
   * ⭐⭐ **এই ফাইলের মূল টেস্ট।** দ্বিতীয় ট্যাবটা কেউ যদি
   * `status === 'idle'` লিখে বানাত, তাহলে `offline` আর `agent_down`
   * কার্ডগুলো **কোনো ট্যাবেই থাকত না**।
   */
  it('প্রতিটি কার্ড ঠিক একবার — কেউ হারায় না, কেউ দুবার আসে না', () => {
    const cards = ALL.map((s, i) => card(s, i + 1));

    const { working, resting } = splitBoard(cards);
    const seen = [...working, ...resting].map((c) => c.employeeId).sort();

    expect(seen).toEqual([1, 2, 3, 4]);
    expect(working.length + resting.length).toBe(cards.length);
  });

  /**
   * ⚠️ নতুন কোনো `LiveStatus` যোগ হলেও সে আপনাআপনি "না-কাজ" দলে পড়বে,
   * কারণ শর্তটা **বাদ দিয়ে** লেখা, বেছে নিয়ে নয়। এই টেস্টটা সেই
   * প্রতিশ্রুতিটাই ধরে রাখে।
   */
  it('অচেনা অবস্থা এলে সে না-কাজ দলে পড়ে, হারিয়ে যায় না', () => {
    const { working, resting } = splitBoard([
      card('locked_out_someday' as LiveStatus, 9),
    ]);

    expect(working).toHaveLength(0);
    expect(resting).toHaveLength(1);
  });

  it('খালি বোর্ডে দুটোই খালি', () => {
    const { working, resting } = splitBoard([]);

    expect(working).toHaveLength(0);
    expect(resting).toHaveLength(0);
  });

  /** ⚠️ কেউ কাজ না করলে প্রথম ট্যাব খালি — পাতা ভাঙা নয়, খালিই */
  it('কেউ কাজ না করলে প্রথম ভাগ খালি', () => {
    const { working, resting } = splitBoard([card('idle', 1), card('offline', 2)]);

    expect(working).toHaveLength(0);
    expect(resting).toHaveLength(2);
  });

  /** ⭐ ক্রম বদলায় না — সার্ভার যে ক্রমে পাঠিয়েছে, ভেতরেও সেই ক্রম */
  it('সার্ভারের ক্রম ধরে রাখে', () => {
    const cards = [card('active', 5), card('idle', 6), card('active', 7)];

    expect(splitBoard(cards).working.map((c) => c.employeeId)).toEqual([5, 7]);
  });
});
