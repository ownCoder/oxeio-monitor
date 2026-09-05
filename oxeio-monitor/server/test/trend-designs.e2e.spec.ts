import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import { DashboardService } from '../src/dashboard/dashboard.service';
import {
  createHarness,
  dhakaNoon,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐ **সাত দিনের ফিতেয় "কতগুলো ডিজাইন শেষ হয়েছে"** *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * মালিকের চাওয়া: বোর্ডে *"Where Today Went"*-এর উপরে শেষ ৭ দিনে রোজ কতগুলো
 * ডিজাইন হচ্ছে।
 *
 * ⚠️⚠️ **সংখ্যাটা "শেষ", "খোলা" নয়** — আর এটাই মালিকের নিজের আগের বাছাই
 * *(২৩ আগস্ট, ADR-033)*। `design_credits` বলে কতগুলো ফাইল **খোলা** হয়েছে,
 * আর সেই সংখ্যাটা মাঠে বিভ্রান্তি তৈরি করেছিল: ম্যানেজার ১৯টা ফাইলে ৪৪
 * মিনিট দিয়ে "১৬" দেখাচ্ছিলেন। তাই এখানে কেবল `completed_at`।
 *
 * ⚠️⚠️ **আসল ঝুঁকি দিনের সীমানায়।** `completed_at` timestamptz, আর ওই
 * টেবিলে `work_date` কলাম নেই — তাই বালতি করতে হয় ঢাকার দিন ধরে। এই
 * ফাইলের বেশিরভাগ টেস্ট ঠিক সেই সীমানার দুই পাশ পরীক্ষা করে।
 */
let h: Harness;
let dashboard: DashboardService;

const HOUR_MS = 3600_000;
/** ⚠️ ঢাকা UTC+৬ — লেবেল (`workDateOf`) থেকে আসল মুহূর্তে যেতে এটুকু বাদ */
const DHAKA_OFFSET_MS = 6 * HOUR_MS;

beforeAll(async () => {
  h = await createHarness();
  dashboard = h.app.get(DashboardService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

/** ঢাকার আজকের কর্মদিবস — লেবেল হিসেবে (UTC-মধ্যরাত) */
const today = () => workDateOf(dhakaNoon());

/**
 * একটা ঢাকা-দিনের ভেতরে নির্দিষ্ট ঘণ্টার **আসল মুহূর্ত**।
 *
 * ⚠️⚠️ এই ফাংশনটাই এই ফাইলের কেন্দ্র। `dayLabel` একটা **লেবেল** —
 * ঢাকার দিনটাকে UTC-মধ্যরাত হিসেবে লেখা। ওই দিনের ঢাকা-মধ্যরাত শুরু হয়
 * লেবেলের **৬ ঘণ্টা আগে**। এটা গুলিয়ে ফেললে সব সীমানা-টেস্ট নীরবে ভুল
 * দিকে সরে যেত, আর সবুজ থাকত।
 */
function atDhakaHour(dayLabel: Date, hour: number): Date {
  return new Date(dayLabel.getTime() - DHAKA_OFFSET_MS + hour * HOUR_MS);
}

let asinCounter = 0;
async function finishedAt(when: Date | null): Promise<void> {
  const owner = await h.prisma.user.findFirstOrThrow();
  asinCounter += 1;

  await h.prisma.designTarget.create({
    data: {
      // ⚠️ ঠিক ১০ অক্ষর, বড় হাতে — `targets.rules.ts`-এর নিয়ম
      asin: `B${String(asinCounter).padStart(9, '0')}`,
      addedById: owner.id,
      status: when === null ? 'pool' : 'done',
      completedAt: when,
    },
  });
}

const daysOf = async () => (await dashboard.teamTrend()).days;

describe('সাত দিনের ফিতে — কতগুলো ডিজাইন শেষ হয়েছে', () => {
  it('আজ শেষ হওয়া ডিজাইন আজকের ঘরে বসে', async () => {
    await finishedAt(atDhakaHour(today(), 11));
    await finishedAt(atDhakaHour(today(), 15));

    const days = await daysOf();
    const todayRow = days.at(-1)!;

    expect(todayRow.designsFinished).toBe(2);
  });

  it('প্রতিটা দিন নিজের ঘরে — মিশে যায় না', async () => {
    const t = today();
    await finishedAt(atDhakaHour(new Date(t.getTime() - 2 * 86_400_000), 12));
    await finishedAt(atDhakaHour(new Date(t.getTime() - 1 * 86_400_000), 12));
    await finishedAt(atDhakaHour(new Date(t.getTime() - 1 * 86_400_000), 16));

    const days = await daysOf();

    expect(days.at(-3)!.designsFinished).toBe(1);
    expect(days.at(-2)!.designsFinished).toBe(2);
    expect(days.at(-1)!.designsFinished).toBe(0);
  });

  /**
   * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট — ঢাকার মধ্যরাতের দুই পাশ।**
   *
   * ⚠️⚠️ ঢাকার ২৩:৩০ মানে UTC-তে **১৭:৩০, একই দিনে**; আর ঢাকার ০০:৩০ মানে
   * UTC-তে **১৮:৩০, আগের দিনে**। কেউ যদি UTC-র দিন ধরে বালতি করত, তাহলে
   * সন্ধ্যার পর শেষ হওয়া প্রতিটা ডিজাইন **পরের দিনের ঘরে** পড়ত — অর্থাৎ
   * রোজ সন্ধ্যায় আজকের সংখ্যা কমে যেত আর কালকেরটা বেড়ে যেত। সংখ্যাটা
   * ভুল হতো, কিন্তু কোনো এরর উঠত না।
   */
  it('⭐ ঢাকার রাত ১১:৩০ আজকের ঘরে, রাত ১২:৩০ কালকের', async () => {
    const t = today();
    const yesterday = new Date(t.getTime() - 86_400_000);

    // গতকালের ঢাকা-রাত ১১:৩০ → গতকালের ঘরে
    await finishedAt(atDhakaHour(yesterday, 23.5));
    // আজকের ঢাকা-রাত ১২:৩০ → আজকের ঘরে
    await finishedAt(atDhakaHour(t, 0.5));

    const days = await daysOf();

    expect(days.at(-2)!.designsFinished).toBe(1);
    expect(days.at(-1)!.designsFinished).toBe(1);
  });

  /**
   * ⚠️ জানালার বাইরেরটা গোনা হয় না — নইলে ফিতের প্রথম দিনটা একটা
   *    "বাকি সব" ঝুড়ি হয়ে যেত, আর সংখ্যাটা রোজ বাড়তেই থাকত।
   */
  it('⭐ সাত দিনের বাইরে শেষ হওয়া ডিজাইন ফিতেয় আসে না', async () => {
    const t = today();
    await finishedAt(atDhakaHour(new Date(t.getTime() - 20 * 86_400_000), 12));

    const days = await daysOf();

    expect(days).toHaveLength(7);
    expect(days.reduce((a, d) => a + d.designsFinished, 0)).toBe(0);
  });

  /**
   * ⭐⭐ **শেষ না হওয়া টার্গেট গোনা হয় না** — এটাই "খোলা বনাম শেষ"-এর
   * পাহারা। ⚠️ কেউ যদি একদিন `completedAt` বাদ দিয়ে `status` বা
   * `design_credits` ধরে গুনতে শুরু করেন, এই টেস্টটাই ভাঙবে।
   */
  it('⭐ পুলে পড়ে থাকা টার্গেট "শেষ" নয়', async () => {
    await finishedAt(null);
    await finishedAt(null);
    await finishedAt(atDhakaHour(today(), 12));

    const days = await daysOf();

    expect(days.at(-1)!.designsFinished).toBe(1);
  });

  it('কিছু শেষ না হলে প্রতিটা ঘর ০ — `undefined` নয়', async () => {
    const days = await daysOf();

    expect(days).toHaveLength(7);
    expect(days.every((d) => d.designsFinished === 0)).toBe(true);
  });
});
