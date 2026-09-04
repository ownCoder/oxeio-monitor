import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AgentDownCheck } from '../src/alerts/agent-down.check';
import { AlertsService } from '../src/alerts/alerts.service';
import {
  createHarness,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * **#১ — ফিরে এলে agent_down নিজে বন্ধ (auto-close)।**
 *
 * ⚠️⚠️ মালিকের অভিযোগ থেকে: সকালে উঠে ১১টা "Agent down" warning — সবই
 * রাতে-বন্ধ-হয়ে আবার-চালু-হওয়া PC-র বাসি alert (goodbye ইভেন্ট সার্ভারে
 * পৌঁছায়নি, G136)।
 *
 * ⭐ এই ফাইল পাহারা দেয়: এজেন্ট আবার ডেটা পাঠাতে শুরু করলে তার খোলা
 * agent_down `resolvedAt` পায়, `openCount` কমে — কিন্তু সারিটা **ডিলিট হয়
 * না**, "Show all"-এ থেকে যায়, আর মানুষ যে acknowledge করেনি সেটাও স্পষ্ট
 * থাকে (`acknowledgedAt` অটুট)।
 */
let h: Harness;
let check: AgentDownCheck;
let alerts: AlertsService;
let employeeId: number;

/** status:'active' + একটা নির্দিষ্ট lastSeenAt নিয়ে ডিভাইস; কোনো clean-stop ইভেন্ট নেই */
async function seedDevice(
  lastSeenAt: Date,
  hostname = 'PC-SILENT',
): Promise<number> {
  const d = await h.prisma.device.create({
    data: {
      hostname,
      windowsUsername: 'rakib',
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
      status: 'active',
      lastSeenAt,
    },
  });
  return d.id;
}

/**
 * ⭐⭐ **স্থির ঘড়ি — আর এটাই এই ফাইলের সবচেয়ে জরুরি লাইন।**
 *
 * ⚠️⚠️ এখানে আগে `new Date()` ছিল, অর্থাৎ CI যখন চলত তখনকার আসল সময়।
 * কিন্তু `AgentDownCheck.runOnce()` অ্যালার্ট তোলে **কেবল অফিস-সময়ে**
 * (`isAgentWatchOpen` — ৯:০০ + ১৫ মিনিট ছাড়)। ফলে দিনে CI সবুজ, রাতে
 * লাল — ৪ সেপ্টেম্বর রাত ১১:১৯-এ ঠিক তাই হয়েছে, পাঁচটা টেস্ট একসাথে।
 *
 * ⭐ ব্যর্থতাটা **কোডের নয়, টেস্টের** — অ্যালার্ট চাপা দেওয়াটাই সঠিক
 * আচরণ (২৩ আগস্টে ছটা মিথ্যা অ্যালার্টের পর ওটা বসানো হয়েছিল)। তাই
 * নিয়মটা শিথিল না করে **টেস্টকে একটা জানা মুহূর্তে দাঁড় করানো হলো**।
 *
 * ⚠️ বুধবার বাছা হয়েছে ইচ্ছাকৃতভাবে — শুক্রবার সাপ্তাহিক ছুটি, তখন
 * `isOfficeOpen()` এমনিতেই বন্ধ বলত আর টেস্ট আবার সময়-নির্ভর হতো।
 */
const NOW = new Date('2026-09-02T05:00:00.000Z'); // বুধবার, ঢাকার ১১:০০

/** `NOW`-এর সাপেক্ষে — ⚠️ `harness`-এর `minutesAgo` আসল ঘড়ি ধরে, তাই নয় */
const before = (minutes: number): Date =>
  new Date(NOW.getTime() - minutes * 60_000);

const agentDownRows = () =>
  h.prisma.alert.findMany({ where: { type: 'agent_down' } });

beforeAll(async () => {
  h = await createHarness();
  // ⚠️ শিডিউলার NODE_ENV=test-এ বন্ধ (alerts.scheduler.ts) — runOnce/
  //    resolveReturned নিজে হাতে ডাকি, নইলে টিক মাঝপথে ফিক্সচার নাড়াত।
  check = h.app.get(AgentDownCheck);
  alerts = h.app.get(AlertsService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const policy = await h.prisma.workPolicy.findFirstOrThrow();
  const emp = await h.prisma.employee.create({
    data: { empCode: 'OX-DOWN', fullName: 'Rakib Hasan', policyId: policy.id },
  });
  employeeId = emp.id;
});

describe('agent_down — ফিরে এলে নিজে বন্ধ', () => {
  /** ⭐⭐ মূল দাবি: চুপ → alert ওঠে; ফিরে এলে সেটাই resolve হয়। */
  it('চুপ ডিভাইসে alert ওঠে, ফিরে এলে সেটাই resolve হয়', async () => {
    const now = NOW;
    const deviceId = await seedDevice(before(30));

    expect(await check.runOnce(now)).toBe(1);
    const [raised] = await agentDownRows();
    expect(raised.resolvedAt).toBeNull();
    expect((await alerts.list({})).openCount).toBe(1);

    // এজেন্ট আবার হাজিরা দিলো (lastSeenAt সাম্প্রতিক)
    await h.prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: before(1) },
    });

    expect(await check.resolveReturned(now)).toBe(1);

    const [after] = await agentDownRows();
    expect(after.resolvedAt).not.toBeNull();
    expect(after.resolvedReason).toBe('agent returned');
    // ⚠️ মানুষ দেখেনি — acknowledgedAt অটুট, দুটো আলাদা ঘটনা
    expect(after.acknowledgedAt).toBeNull();
  });

  it('resolve হলে openCount কমে, কিন্তু "Show all"-এ ইতিহাসে থাকে', async () => {
    const now = NOW;
    const deviceId = await seedDevice(before(30));
    await check.runOnce(now);

    await h.prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: before(1) },
    });
    await check.resolveReturned(now);

    const open = await alerts.list({});
    expect(open.openCount).toBe(0);
    expect(open.rows).toHaveLength(0); // ডিফল্ট (open) তালিকায় নেই

    const all = await alerts.list({ status: 'all' });
    expect(all.rows).toHaveLength(1); // কিন্তু ইতিহাসে আছে
  });

  it('এখনো চুপ থাকা ডিভাইসের alert বন্ধ হয় না', async () => {
    const now = NOW;
    await seedDevice(before(30));
    await check.runOnce(now);

    // lastSeenAt বদলায়নি — এখনো চুপ
    expect(await check.resolveReturned(now)).toBe(0);
    const [row] = await agentDownRows();
    expect(row.resolvedAt).toBeNull();
    expect((await alerts.list({})).openCount).toBe(1);
  });

  /** ⚠️ প্রতি ৫-মিনিট টিকে চলে — দ্বিতীয়বার যেন reason/সময় নতুন করে না বসে */
  it('idempotent — দ্বিতীয়বার resolveReturned আর কিছু ছোঁয় না', async () => {
    const now = NOW;
    const deviceId = await seedDevice(before(30));
    await check.runOnce(now);
    await h.prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: before(1) },
    });

    expect(await check.resolveReturned(now)).toBe(1);
    const [first] = await agentDownRows();
    const firstAt = first.resolvedAt;

    expect(await check.resolveReturned(now)).toBe(0);
    const [second] = await agentDownRows();
    expect(second.resolvedAt?.getTime()).toBe(firstAt?.getTime());
  });

  /** ⚠️ revoke করা ডিভাইসের চুপ থাকাটাই উদ্দেশ্য — এই পথে বন্ধ নয় */
  it('revoke করা ডিভাইসের alert এই পথে বন্ধ হয় না', async () => {
    const now = NOW;
    const deviceId = await seedDevice(before(30));
    await check.runOnce(now);

    await h.prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: before(1), status: 'revoked' },
    });

    expect(await check.resolveReturned(now)).toBe(0);
    expect((await alerts.list({})).openCount).toBe(1);
  });
});
