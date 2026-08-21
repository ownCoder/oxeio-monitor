import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import { ActivityService } from '../src/activity/activity.service';
import {
  createEmployeeWithCode,
  createHarness,
  enrollDevice,
  iso,
  resetDatabase,
  todayWindow,
  type EnrolledDevice,
  type Harness,
} from './setup/harness';

/**
 * **R22a — app_usage-এ "কোন অবস্থায় দেখা হয়েছে"।**
 *
 * ⚠️⚠️ মাঠে মাপা সমস্যা থেকে: এজেন্ট ACTIVE ছাড়ার সাথে সাথেই অ্যাপ দেখা
 * বন্ধ করত, তাই idle সেগমেন্টের ভেতরে একটাও সারি থাকত না — আর মিটিং
 * (Zoom-এ বসে থাকা) চেনার কোনো উপায়ই ছিল না।
 *
 * ⭐ এই ফাইল দুটো জিনিস পাহারা দেয়, আর দুটোই আলাদা রকম জরুরি:
 * ১· পুরোনো এজেন্ট (যারা ঘরটা পাঠায় না) যেন **৪০০ না খায়** — ৪০০ মানে
 *    তাদের কাছে Permanent, অর্থাৎ ডেটা মুছে ফেলা (G49)।
 * ২· idle সারি জমা হলেও **কোনো হিসাবে যেন না ঢোকে**।
 */
let h: Harness;
let device: EnrolledDevice;

const usageItem = (over: Record<string, unknown> = {}) => {
  const w = todayWindow(600);
  return {
    clientUuid: randomUUID(),
    startedAt: iso(w.startedAt),
    endedAt: iso(w.endedAt),
    durationSec: w.durationSec,
    processName: 'zoom.exe',
    appName: 'Zoom',
    ...over,
  };
};

const post = (items: unknown[]) =>
  h
    .http()
    .post('/api/v1/agent/app-usage')
    .set('Authorization', `Bearer ${device.token}`)
    .send({ items });

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

describe('POST /agent/app-usage — segment state', () => {
  /**
   * ⚠️⚠️ **সবচেয়ে জরুরি টেস্ট।** ফ্লিটের সবাই এখনো পুরোনো এজেন্টে; তারা
   * `state` ঘরটা পাঠায় না। ঘরটা বাধ্যতামূলক করলে তাদের প্রতিটা ব্যাচ ৪০০
   * খেত, আর এজেন্ট ৪০০-কে Permanent ধরে ডেটাটা **মুছে ফেলত** (G49)।
   */
  it('পুরোনো এজেন্ট state না পাঠালেও চলে, আর active ধরা হয়', async () => {
    await post([usageItem()]).expect(200);

    const row = await h.prisma.appUsage.findFirstOrThrow();
    expect(row.segmentState).toBe('active');
  });

  it('idle অবস্থার খণ্ড idle হয়েই জমা হয়', async () => {
    await post([usageItem({ state: 'idle' })]).expect(200);

    const row = await h.prisma.appUsage.findFirstOrThrow();
    expect(row.segmentState).toBe('idle');
  });

  it('অচেনা অবস্থা পাঠালে ৪০০', async () => {
    await post([usageItem({ state: 'meeting' })]).expect(400);
  });

  /**
   * ⭐⭐ **R22a-র মূল প্রতিশ্রুতি:** রেকর্ড থাকা আর গোনা হওয়া — দুটো
   * আলাদা। idle-এ দেখা খণ্ড ডাটাবেসে থাকে (R22b-র জন্য), কিন্তু অ্যাপের
   * হিসাবে (D07/D08) এক সেকেন্ডও যোগ করে না।
   *
   * ⚠️ এটাই সেই নিয়ম যেটা আগে "idle-এ রেকর্ডই কোরো না" দিয়ে রক্ষা করা
   * হতো — এখন ছাঁকনি দিয়ে। ভাঙলে "লাঞ্চে Excel খোলা রেখে যাওয়া"টাই
   * ব্যবহার হিসেবে গোনা হতো।
   */
  it('idle খণ্ড অ্যাপের হিসাবে যোগ হয় না', async () => {
    const active = todayWindow(600);
    const idle = todayWindow(1200);

    await post([
      usageItem({
        state: 'active',
        startedAt: iso(active.startedAt),
        endedAt: iso(active.endedAt),
        durationSec: active.durationSec,
      }),
      usageItem({
        state: 'idle',
        startedAt: iso(idle.startedAt),
        endedAt: iso(idle.endedAt),
        durationSec: idle.durationSec,
      }),
    ]).expect(200);

    // দুটোই ডাটাবেসে আছে
    expect(await h.prisma.appUsage.count()).toBe(2);

    /**
     * ⚠️⚠️ **ঢাকার তারিখ, UTC-র নয়** — G62-র হুবহু পুনরাবৃত্তি, আর এটাও
     * একটা ঘুমন্ত সময়-বোমা ছিল *(ফেটেছে ২২ আগস্ট রাত ১২:০৩)*।
     *
     * `new Date().toISOString()` UTC দেয়, আর ঢাকা UTC+৬ — তাই মধ্যরাত
     * থেকে ভোর ৬টার মধ্যে UTC তারিখ **আগের দিন**। তখন কোয়েরিটা ভুল
     * দিনে যেত, `zoom` সারিটা পাওয়া যেত না, আর টেস্ট ভাঙত — অথচ কোডে
     * কোনো ভুল নেই। ⭐ ইনজেস্ট নিজে `workDateOf()` দিয়েই দিন ঠিক করে,
     * তাই টেস্টেরও সেটাই ব্যবহার করা উচিত।
     */
    const day = workDateOf(new Date()).toISOString().slice(0, 10);
    const top = await h.app
      .get(ActivityService)
      .top({ from: day, to: day, limit: 10 });

    const zoom = top.apps.rows.find((r) => r.key === 'zoom.exe');
    // ⚠️ কেবল ACTIVE খণ্ডটুকু — idle-এর ১২০০ সেকেন্ড যোগ হয়নি
    expect(zoom?.seconds).toBe(active.durationSec);
  });
});
