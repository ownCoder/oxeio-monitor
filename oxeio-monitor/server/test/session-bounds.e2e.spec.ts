import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
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
 * ⭐⭐⭐ **সেশনের খাম তার নিজের সেগমেন্টগুলোকে ধরে রাখে**
 * *(৬ সেপ্টেম্বর ২০২৬, G164 · G165)*।
 *
 * ⚠️⚠️ **G164 — যে বাগটা এই ফাইলটা পাহারা দেয়:** `ingestSegments()` সেশনটা
 * তারিখপ্রতি একবার খুঁজত (memo), আর সেটা ঠিকই ছিল — কিন্তু সে খুঁজত
 * ব্যাচের **প্রথম** খণ্ডের সময় নিয়ে। বাকি খণ্ডগুলো memo-হিটে সোজা ওই
 * সেশনে বসত, আর `widen()` তাদের দেখতই না। ফলে সেশনের সীমা তার ভেতরের
 * সেগমেন্টগুলোর বাইরে থেকে যেত।
 *
 * ⚠️ মাঠে মাপা: ২২৬টা সেশনের **৭টা** ভাঙা — ৫২টা সেগমেন্ট, **২৪.৪৭
 * ঘণ্টা** নিজের সেশনের বাইরে। এজেন্ট প্রতিটা বন্ধ সেগমেন্ট
 * fire-and-forget কিউয়ে ফেলে, তাই ক্রমটা একটা দৌড় — ছোট idle সারিটা
 * লম্বা lock সারিটাকে হারিয়ে দিতে পারে।
 *
 * ⚠️⚠️ **G165 —** দেরিতে আসা বিদায়ী ইভেন্ট সেশনকে **তার নিজের শুরুর
 * আগে** বন্ধ করে দিতে পারত (`ended_at < started_at`)। ২৪ আগস্ট সেটা ৩
 * মিনিট ৩০ সেকেন্ডের ব্যবধানে ফসকেছে।
 *
 * ⭐ কোনো রিপোর্ট আজ `work_sessions`-এর সময় **পড়ে না**, তাই ঘণ্টা হারায়
 * না। কিন্তু সারিগুলো স্থায়ী — আর যে ফিচারটা প্রথম এই কলামগুলো পড়বে
 * (সেশন-ভিত্তিক টাইমলাইন, "আজ প্রথম কখন এলেন") সে ভাঙা ডেটাই পাবে।
 */
let h: Harness;
let device: EnrolledDevice;

const MINUTE_MS = 60_000;
const HOUR_MS = 3600_000;
const DHAKA_OFFSET_MS = 6 * HOUR_MS;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const { code } = await createEmployeeWithCode(h.prisma);
  device = await enrollDevice(h, code);
});

function asAgent<T extends { set(field: string, val: string): T }>(
  req: T,
  token: string,
): T {
  return req
    .set('Authorization', `Bearer ${token}`)
    .set('X-Client-Time', iso(realNow()));
}

const today = () => workDateOf(dhakaNoon());

/** ⚠️ লেবেল নয়, ঢাকার ওই ঘণ্টার **আসল মুহূর্ত** */
const atDhakaHour = (dayLabel: Date, hour: number): Date =>
  new Date(dayLabel.getTime() - DHAKA_OFFSET_MS + hour * HOUR_MS);

const span = (from: Date, minutes: number, state = 'active') => ({
  clientUuid: randomUUID(),
  state,
  startedAt: iso(from),
  endedAt: iso(new Date(from.getTime() + minutes * MINUTE_MS)),
  durationSec: minutes * 60,
});

const send = (segments: unknown[]) =>
  asAgent(h.http().post('/api/v1/agent/segments'), device.token)
    .send({ segments })
    .expect(200);

const sessions = () =>
  h.prisma.workSession.findMany({ orderBy: { startedAt: 'asc' } });

/** একটা `shutdown` ইভেন্ট — সেশনটা বন্ধ করতে */
const closeAt = (when: Date) =>
  asAgent(h.http().post('/api/v1/agent/events'), device.token)
    .send({
      events: [
        { clientUuid: randomUUID(), type: 'shutdown', occurredAt: iso(when) },
      ],
    })
    .expect(200);

describe('G164 — এক ব্যাচের প্রতিটা সেগমেন্ট সেশনের খামে ঢোকে', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের মূল টেস্ট** — ব্যাচের **শেষ** সেগমেন্টটা সবচেয়ে
   * দেরিতে শেষ হয়, আর সেশনের শেষটা তার পরেই থাকতে হবে।
   *
   * ⚠️ পুরোনো নিয়মে সেশনটা প্রথম সেগমেন্টের সময় নিয়ে তৈরি হতো আর
   *    বাকিগুলো memo-হিটে নীরবে বসে যেত।
   */
  it('⭐ পরের সেগমেন্টগুলোও সেশনের সীমা টেনে বড় করে', async () => {
    const day = today();

    /**
     * ⚠️⚠️ **সেশনটা আগে বন্ধ করা হয়, ইচ্ছাকৃতভাবে।** `widen()` খোলা
     * সেশনের `endedAt` ছোঁয় না (ওটা logoff বা দিন-ক্লোজের কাজ), তাই
     * সেশন খোলা রেখে পরীক্ষা করলে দাবিটা **ফাঁকা** হয়ে যেত — বাগটা
     * থাকা অবস্থাতেও টেস্টটা সবুজ থাকত।
     */
    await send([span(atDhakaHour(day, 9), 10)]);
    await closeAt(atDhakaHour(day, 9.5));

    // ⚠️ এখন একই ব্যাচে তিনটে — প্রথমটা ছোট, শেষেরটা অনেক পরে
    await send([
      span(atDhakaHour(day, 10), 5),
      span(atDhakaHour(day, 11), 30),
      span(atDhakaHour(day, 17), 45),
    ]);

    const [s] = await sessions();
    const last = new Date(atDhakaHour(day, 17).getTime() + 45 * MINUTE_MS);

    expect(s.endedAt).not.toBeNull();
    expect(s.endedAt!.getTime()).toBeGreaterThanOrEqual(last.getTime());
    expect(s.startedAt.getTime()).toBeLessThanOrEqual(
      atDhakaHour(day, 9).getTime(),
    );
  });

  /**
   * ⭐⭐ **উল্টো ক্রমে এলেও সেশনের শুরু পিছিয়ে যায়।**
   *
   * ⚠️⚠️ এটাই মাঠের সেশন ৩২/৯৩-এর আকৃতি: একই ব্যাচে প্রথমে বসেছিল
   * সকালের ছোট idle সারিটা, আর তার পরে রাত ১২টা থেকে চলা লম্বা lock
   * সারিটা। সেশন শুরু হয়েছিল তার নিজের প্রথম সেগমেন্টের **৮ ঘণ্টা ৩৪
   * মিনিট পরে**।
   */
  it('⭐ দেরির সেগমেন্ট আগে এলেও শুরুটা আসল প্রথম সেগমেন্টেই', async () => {
    const day = today();
    const early = atDhakaHour(day, 0);

    await send([
      span(atDhakaHour(day, 8), 2),
      span(early, 8 * 60 + 34, 'locked'),
    ]);

    const [s] = await sessions();
    expect(s.startedAt.toISOString()).toBe(early.toISOString());
  });

  /**
   * ⚠️⚠️ **প্রতিটা সেগমেন্ট তার নিজের সেশনের ভেতরে** — এটাই আসল নিয়ম,
   * আর উপরের দুটো এরই দুটো দিক। মাঠের কুয়েরিটাই এখানে লেখা।
   */
  it('⭐ একটাও সেগমেন্ট নিজের সেশনের বাইরে পড়ে না', async () => {
    const day = today();

    // ⚠️ সেশনটা বন্ধ — নইলে নিচের `endedAt` দাবিটা ফাঁকা হয়ে যেত
    await send([span(atDhakaHour(day, 8), 10)]);
    await closeAt(atDhakaHour(day, 8.5));

    await send([
      span(atDhakaHour(day, 9), 15),
      span(atDhakaHour(day, 9.5), 90, 'idle'),
      span(atDhakaHour(day, 13), 10),
      span(atDhakaHour(day, 18), 120, 'locked'),
      span(atDhakaHour(day, 11), 25),
    ]);

    const rows = await h.prisma.activitySegment.findMany({
      select: {
        startedAt: true,
        endedAt: true,
        session: { select: { startedAt: true, endedAt: true } },
      },
    });

    expect(rows).not.toHaveLength(0);

    for (const r of rows) {
      expect(r.startedAt.getTime()).toBeGreaterThanOrEqual(
        r.session.startedAt.getTime(),
      );
      // ⚠️ `not.toBeNull()` আলাদা করে — নইলে সেশন খোলা থাকলে নিচের
      //    দাবিটা নীরবে বাদ পড়ত, আর টেস্টটা কিছুই পাহারা দিত না
      expect(r.session.endedAt).not.toBeNull();
      expect(r.endedAt.getTime()).toBeLessThanOrEqual(
        r.session.endedAt!.getTime(),
      );
    }
  });

  /**
   * ⚠️ **মধ্যরাত পেরোনো সেগমেন্ট দুটো তারিখে ভাগ হয়**, আর দুটো দিনেরই
   *    নিজের সেশন — কোনোটার খামই অন্যটার সময় ধরে না।
   */
  it('মধ্যরাত পেরোলে দুই দিনের দুই সেশন, দুটোই নিজের সীমায়', async () => {
    const day = today();
    const yesterday = new Date(day.getTime() - 24 * HOUR_MS);

    // গতকাল রাত ১১টা থেকে ৩ ঘণ্টা — আজ ভোর ২টায় শেষ
    await send([span(atDhakaHour(yesterday, 23), 180, 'locked')]);

    const rows = await sessions();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.workDate.getTime()).sort()).toEqual(
      [yesterday.getTime(), day.getTime()].sort(),
    );
  });
});

describe('G165 — সেশন নিজের শুরুর আগে বন্ধ হয় না', () => {
  /**
   * ⭐⭐⭐ **এই ব্লকের মূল টেস্ট** — রিবুটের পর আটকে থাকা shutdown
   * ইভেন্টটা সেগমেন্টের **পরে** এসে পৌঁছায়, আর তার সময় সেশনের শুরুর
   * আগের।
   */
  it('⭐ পুরোনো shutdown ইভেন্ট পরে এলে সেশনটা বন্ধ হয় না', async () => {
    const day = today();
    const startedAt = atDhakaHour(day, 10);

    await send([span(startedAt, 60)]);
    await closeAt(atDhakaHour(day, 9)); // ⚠️ সেশন শুরুর এক ঘণ্টা আগে

    const [s] = await sessions();

    expect(s.endedAt).toBeNull();
    expect(s.endReason).toBeNull();
  });

  /** ⚠️ স্বাভাবিক ক্ষেত্রে আগের মতোই — এটাই নিরাপত্তা-জাল */
  it('স্বাভাবিক shutdown আগের মতোই সেশন বন্ধ করে', async () => {
    const day = today();
    const startedAt = atDhakaHour(day, 10);
    const stopAt = atDhakaHour(day, 18);

    await send([span(startedAt, 60)]);
    await closeAt(stopAt);

    const [s] = await sessions();

    expect(s.endedAt?.toISOString()).toBe(stopAt.toISOString());
    expect(s.endReason).toBe('shutdown');
  });

  /**
   * ⚠️⚠️ **ক্ল্যাম্প নয়, বাদ** — শূন্য-দৈর্ঘ্যের সেশন আর একটা মিথ্যা
   * `end_reason` বসানো হয় না। সেশনটা খোলাই থাকে, আর ০০:১৫-র দিন-ক্লোজ
   * তাকে তার নিজের মধ্যরাতে বন্ধ করবে।
   */
  it('⭐ ঠিক শুরুর মুহূর্তে আসা ইভেন্ট বন্ধ করে, তার আগেরটা নয়', async () => {
    const day = today();
    const startedAt = atDhakaHour(day, 10);

    await send([span(startedAt, 60)]);
    await closeAt(new Date(startedAt.getTime() - 1));

    expect((await sessions())[0].endedAt).toBeNull();

    await closeAt(startedAt);
    expect((await sessions())[0].endedAt?.toISOString()).toBe(
      startedAt.toISOString(),
    );
  });

  /** ⚠️ কোনো সেশনেই `ended_at < started_at` থাকতে পারে না */
  it('⭐ একটাও ঋণাত্মক দৈর্ঘ্যের সেশন তৈরি হয় না', async () => {
    const day = today();

    await send([span(atDhakaHour(day, 10), 60)]);
    await closeAt(atDhakaHour(day, 7));
    await send([span(atDhakaHour(day, 12), 30)]);
    await closeAt(atDhakaHour(day, 8));

    for (const s of await sessions()) {
      if (s.endedAt === null) continue;
      expect(s.endedAt.getTime()).toBeGreaterThanOrEqual(s.startedAt.getTime());
    }
  });
});
