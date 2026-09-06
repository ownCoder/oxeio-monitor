import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import { SummaryRefreshJob } from '../src/summary/summary-refresh.job';
import { SummaryService } from '../src/summary/summary.service';
import {
  createEmployeeWithCode,
  createHarness,
  dhakaNoon,
  enrollDevice,
  iso,
  realNow,
  resetDatabase,
  type EnrolledDevice,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐⭐ **দেরিতে আসা ঘণ্টা আর হারায় না** *(৬ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ **যে বাগটা এই ফাইলটা পাহারা দেয়:** rollup চলত কেবল **দুটো** দিনের
 * উপর — আজ (K06, প্রতি ১৫ মিনিটে) আর গতকাল (K05, ০০:১৫-তে **একবার**)। এর
 * বাইরের কোনো দিনের সেগমেন্ট পরে এলে সেটা `activity_segments`-এ ঠিকই বসত,
 * কিন্তু `daily_summary`-তে **কোনোদিন উঠত না** — আর সেখান থেকে
 * `monthly_summary`, আর সেখান থেকে বেতনের ঘাটতি।
 *
 * ⚠️⚠️ **ঘটনাটা বিরল নয়, রোজকার।** সন্ধ্যায় PC বন্ধ হলে দিনের শেষ
 * সেগমেন্টটা আউটবক্সে থেকে যায়, আর পরদিন সকালে লগইনের পর আপলোড হয় —
 * ততক্ষণে ০০:১৫-র দিন-ক্লোজ পেরিয়ে গেছে। মাঠে মাপা ক্ষতি: আগস্ট–সেপ্টেম্বরে
 * **৩৯টা (কর্মী, দিন) জোড়া, ১৭.৭৮ ঘণ্টা**।
 *
 * ⭐ সমাধান: ingest দিনটাকে `summary_dirty`-তে চিহ্নিত করে, আর K06 প্রতি
 * টিকে কিউটা নিষ্কাশন করে।
 */
let h: Harness;
let device: EnrolledDevice;
let summary: SummaryService;

const HOUR_MS = 3_600_000;

function asAgent<T extends { set(field: string, val: string): T }>(
  req: T,
  token: string,
): T {
  return req
    .set('Authorization', `Bearer ${token}`)
    // ⚠️ আসল ঘড়ি — এটা এজেন্টের **নিজের** সময়, ফিক্সচারের নয় (G140)
    .set('X-Client-Time', iso(realNow()));
}

beforeAll(async () => {
  h = await createHarness();
  summary = h.app.get(SummaryService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const { code } = await createEmployeeWithCode(h.prisma);
  device = await enrollDevice(h, code);
});

/**
 * `dayOffset` দিন আগের ঢাকা-দুপুরে `seconds` সেকেন্ডের একটা active সেগমেন্ট
 * পাঠায় — ঠিক যেভাবে অফলাইন আউটবক্স পরে রিপ্লে করে।
 */
async function upload(dayOffset: number, seconds: number): Promise<void> {
  const startedAt = dhakaNoon(dayOffset);
  const endedAt = new Date(startedAt.getTime() + seconds * 1_000);

  await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
    .send({
      segments: [
        {
          clientUuid: randomUUID(),
          state: 'active',
          startedAt: iso(startedAt),
          endedAt: iso(endedAt),
          durationSec: seconds,
        },
      ],
    })
    .expect(200);
}

const dayOf = (offset: number) => workDateOf(dhakaNoon(offset));

const dirtyDates = async () =>
  (
    await h.prisma.summaryDirty.findMany({
      orderBy: { workDate: 'asc' },
      select: { workDate: true },
    })
  ).map((r) => r.workDate.getTime());

const workedOn = async (offset: number) =>
  (
    await h.prisma.dailySummary.findFirst({
      where: { workDate: dayOf(offset) },
      select: { workedSec: true },
    })
  )?.workedSec ?? null;

describe('দেরিতে আসা দিন — চিহ্ন বসা', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের মূল টেস্ট।** তিন দিন আগের কাজ আজ আপলোড হলো — আগে
   * ওটা `daily_summary`-তে কোনোদিন উঠত না।
   */
  it('⭐ পুরোনো দিনের সেগমেন্ট এলে দিনটা চিহ্নিত হয়', async () => {
    await upload(-3, 1_800);

    expect(await dirtyDates()).toEqual([dayOf(-3).getTime()]);
  });

  /**
   * ⚠️⚠️ **আজকের দিন চিহ্নিত হয় না** — K06 এমনিতেই প্রতি ১৫ মিনিটে ওটা
   * গোনে। চিহ্ন বসালে প্রতিটা heartbeat-এ একই কাজ দুবার হতো, আর কিউটা
   * অর্থহীন হয়ে যেত।
   */
  it('⭐ আজকের দিন চিহ্নিত হয় না', async () => {
    await upload(0, 600);

    expect(await dirtyDates()).toEqual([]);
  });

  /**
   * ⚠️ **গতকালও চিহ্নিত হয়** — দিন-ক্লোজ গতকালকে ছোঁয় ঠিক **একবার**,
   * ০০:১৫-তে। সকালে আসা সেগমেন্ট ওই সুযোগটা পেরিয়ে এসেছে, আর মাঠের
   * ৩৯টা ক্ষতির বেশিরভাগই ঠিক এই ঘরানার।
   */
  it('⭐ গতকালের দেরিতে আসা সেগমেন্টও চিহ্নিত হয়', async () => {
    await upload(-1, 900);

    expect(await dirtyDates()).toEqual([dayOf(-1).getTime()]);
  });

  /** ⚠️ একই দিন দুবার এলে দুটো সারি নয় — চাবিটা `work_date` */
  it('একই দিন বারবার এলেও চিহ্ন একটাই', async () => {
    await upload(-2, 600);
    await upload(-2, 600);
    await upload(-2, 600);

    expect(await dirtyDates()).toHaveLength(1);
  });

  it('আলাদা দিন আলাদা চিহ্ন পায়', async () => {
    await upload(-2, 600);
    await upload(-4, 600);

    expect(await dirtyDates()).toEqual([
      dayOf(-4).getTime(),
      dayOf(-2).getTime(),
    ]);
  });
});

describe('দেরিতে আসা দিন — নিষ্কাশন', () => {
  /**
   * ⭐⭐⭐ **পুরো পথটা এক টেস্টে**: আপলোডের পরেও সারি নেই, নিষ্কাশনের পর
   * ঘণ্টাটা খাতায়। ⚠️ **আগের অংশটাই আসল** — ওটা না দেখলে টেস্টটা প্রমাণ
   * করত না যে বাগটা সত্যিই ছিল।
   */
  it('⭐ নিষ্কাশনের পর পুরোনো দিনের ঘণ্টা খাতায় ওঠে', async () => {
    await upload(-3, 1_800);

    // ⚠️ কোনো জব ওই দিনটা ছোঁয় না — তাই এখনো কিছুই নেই
    expect(await workedOn(-3)).toBeNull();

    const result = await summary.drainDirty(dhakaNoon());

    expect(result.refreshed).toBe(1);
    expect(result.pending).toBe(0);
    expect(await workedOn(-3)).toBe(1_800);
    expect(await dirtyDates()).toEqual([]);
  });

  /** ⚠️ নিষ্কাশনের পর চিহ্নটা থাকলে প্রতিটা টিকে একই দিন বারবার গোনা হতো */
  it('নিষ্কাশনের পর চিহ্ন মুছে যায়', async () => {
    await upload(-2, 600);
    await summary.drainDirty(dhakaNoon());

    expect(await dirtyDates()).toEqual([]);
  });

  /**
   * ⭐⭐ **ছাদ আছে, আর বাকিটা কিউতেই থাকে।** ⚠️ ছাদ না থাকলে বড় ব্যাকলগে
   * একটা টিক পরের টিককে ছাড়িয়ে যেত, আর `RunLock` ওগুলো একে একে বাদ দিত।
   */
  it('⭐ একবারে ছাদের বেশি নয়, বাকিটা পরের টিকে', async () => {
    await upload(-2, 600);
    await upload(-3, 600);
    await upload(-4, 600);

    const first = await summary.drainDirty(dhakaNoon(), 2);
    expect(first.refreshed).toBe(2);
    expect(first.pending).toBe(1);

    const second = await summary.drainDirty(dhakaNoon(), 2);
    expect(second.refreshed).toBe(1);
    expect(second.pending).toBe(0);
  });

  /** ⚠️ পুরোনো আগে — নইলে ব্যাকলগে সবচেয়ে পুরোনো দিনটা চিরকাল অপেক্ষা করত */
  it('⭐ পুরোনো চিহ্ন আগে নিষ্কাশিত হয়', async () => {
    await upload(-5, 600);
    await upload(-2, 600);

    await summary.drainDirty(dhakaNoon(), 1);

    // প্রথমে যেটা চিহ্নিত হয়েছিল সেটাই গোনা হয়েছে
    expect(await workedOn(-5)).toBe(600);
    expect(await workedOn(-2)).toBeNull();
  });

  /**
   * ⭐⭐⭐ **বন্ধ মাস ছোঁয়া হয় না** (R1) — ওই মাসের কাগজ বেরিয়ে গেছে।
   *
   * ⚠️⚠️ **কিন্তু চিহ্নটা তবু তুলে দেওয়া হয়**, নইলে ওই সারিটা চিরকাল
   * কিউয়ের মাথায় বসে থাকত আর প্রতিটা টিকে একবার করে বৃথা চেষ্টা হতো —
   * অর্থাৎ কিউটা স্থায়ীভাবে আটকে যেত।
   */
  it('⭐ বন্ধ মাসে গোনা হয় না, তবু চিহ্ন তোলা হয়', async () => {
    await upload(-3, 1_800);

    const yearMonth = dayOf(-3).toISOString().slice(0, 7);
    await h.prisma.monthClosure.create({
      data: { yearMonth, closedBy: 'test' },
    });

    const result = await summary.drainDirty(dhakaNoon());

    expect(result.closed).toBe(1);
    expect(result.refreshed).toBe(0);
    expect(await workedOn(-3)).toBeNull();
    expect(await dirtyDates()).toEqual([]);
  });

  it('কিছু চিহ্নিত না থাকলে নিষ্কাশন নিরীহ', async () => {
    const result = await summary.drainDirty(dhakaNoon());

    expect(result).toEqual({ refreshed: 0, closed: 0, pending: 0 });
  });
});

/**
 * ⭐⭐ **জবটা সত্যিই নিষ্কাশন ডাকে** — এই রেপোর সবচেয়ে চেনা পাপ হলো
 * চুক্তি লেখা আর কলার না লেখা (G141 · G144 · G146)। ⚠️ `drainDirty()`
 * নিখুঁত হলেও কেউ ওটা না ডাকলে ঘণ্টাগুলো ঠিক আগের মতোই হারাত।
 */
describe('K06 — জব থেকে নিষ্কাশন', () => {
  it('⭐ refresh টিকেই পুরোনো দিন গোনা হয়ে যায়', async () => {
    await upload(-3, 1_800);

    const job = h.app.get(SummaryRefreshJob);
    const result = await job.runOnce(dhakaNoon());

    expect(result.skipped).toBe(false);
    expect(result.drained?.refreshed).toBe(1);
    expect(await workedOn(-3)).toBe(1_800);
  });

  /** ⚠️ আজকের দিনটাও একই টিকে গোনা হয় — নিষ্কাশন ওটাকে সরিয়ে দেয় না */
  it('একই টিকে আজকের দিনও গোনা হয়', async () => {
    const seconds = 600;
    const startedAt = new Date(dhakaNoon().getTime() - HOUR_MS);
    const endedAt = new Date(startedAt.getTime() + seconds * 1_000);

    await asAgent(h.http().post('/api/v1/agent/segments'), device.token)
      .send({
        segments: [
          {
            clientUuid: randomUUID(),
            state: 'active',
            startedAt: iso(startedAt),
            endedAt: iso(endedAt),
            durationSec: seconds,
          },
        ],
      })
      .expect(200);

    const job = h.app.get(SummaryRefreshJob);
    await job.runOnce(dhakaNoon());

    expect(await workedOn(0)).toBe(seconds);
  });
});

/**
 * ⭐⭐⭐ **PC হাতবদল হলে সেশনও বদলায়** *(৬ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ **যে বাগটা এই describe-টা পাহারা দেয়:** `resolveSession()` সেশন
 * মেলাত কেবল **(ডিভাইস, তারিখ)** ধরে, কর্মী ধরে নয়। ফলে একটা PC দিনের
 * মাঝখানে অন্য কর্মীকে দিলে নতুন কর্মীর সেগমেন্টগুলো **আগের কর্মীর**
 * সেশনে গিয়ে বসত।
 *
 * ⚠️ ফলটা দুই দিকেই খারাপ: টাইমলাইনে একজনের কাজ অন্যজনের নামে, আর
 * `trackedFromBy()` (যা `work_sessions` পড়ে) আসল কর্মীর ট্র্যাকিং-শুরু
 * পিছিয়ে দিত — অর্থাৎ তার প্রত্যাশার জানালাও ভুল হতো।
 */
describe('PC হাতবদল — সেশন কর্মী ধরেও মেলে', () => {
  it('⭐ ডিভাইস অন্য কর্মীকে দিলে নতুন সেশন খোলে', async () => {
    await upload(0, 600);

    const first = await h.prisma.workSession.findFirstOrThrow();

    // ⚠️ একই ডিভাইস, একই দিন — কেবল কর্মী বদলে গেছে
    const other = await h.prisma.employee.create({
      data: { empCode: 'OX-SWAP', fullName: 'Notun Karmi' },
    });
    await h.prisma.device.update({
      where: { id: first.deviceId },
      data: { employeeId: other.id },
    });

    await upload(0, 600);

    const sessions = await h.prisma.workSession.findMany({
      orderBy: { id: 'asc' },
      select: { employeeId: true },
    });

    expect(sessions).toHaveLength(2);
    expect(sessions[0].employeeId).not.toBe(sessions[1].employeeId);
    expect(sessions[1].employeeId).toBe(other.id);
  });

  /** ⚠️ একই কর্মী হলে আগের মতোই একটাই সেশন — নতুন শর্তটা যেন বেশি না কাটে */
  it('একই কর্মীর দ্বিতীয় আপলোডে নতুন সেশন খোলে না', async () => {
    await upload(0, 600);
    await upload(0, 600);

    expect(await h.prisma.workSession.count()).toBe(1);
  });
});
