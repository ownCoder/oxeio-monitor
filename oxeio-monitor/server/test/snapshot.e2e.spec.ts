import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import { TelegramChannel } from '../src/alerts/telegram.channel';
import { SnapshotService } from '../src/digest/snapshot.service';
import { createHarness, resetDatabase, type Harness } from './setup/harness';

/**
 * **ঘণ্টার স্ন্যাপশট** — এখন কে কাজ করছে, কে করছে না।
 *
 * ⚠️⚠️ ইউনিট টেস্ট (`snapshot-rules.spec.ts`) **বার্তার গড়ন** পাহারা দেয়;
 * এই ফাইল পাহারা দেয় **প্রযোজকটাকে**। এই প্রকল্পে বারবার ঠিক এখানেই ফাঁক
 * থেকেছে — G32-এ নিয়ম, টাইপ, লেবেল সব ছিল, শুধু কেউ ডাকত না।
 */
let h: Harness;
let snapshot: SnapshotService;
let sent: string[];

const now = new Date();
const workDate = workDateOf(now);

beforeAll(async () => {
  h = await createHarness();
  snapshot = h.app.get(SnapshotService);

  /**
   * ⚠️ আসল টেলিগ্রামে পাঠানো হয় না — চ্যানেলটার `send` বদলে দেওয়া হয়।
   * নইলে টেস্ট চালালেই মালিকের ফোনে বার্তা যেত।
   */
  const channel = h.app.get(TelegramChannel);
  (channel as unknown as { send: (t: string) => Promise<string> }).send = (text) => {
    sent.push(text);
    return Promise.resolve('sent');
  };
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  sent = [];
});

/** ঢাকার ওই দিনের একটা মুহূর্ত */
const at = (hour: number) =>
  new Date(workDate.getTime() + (hour - 6) * 3_600_000);

async function staffWithWork(name: string, minutes: number): Promise<number> {
  const employee = await h.prisma.employee.create({
    data: { empCode: `SN-${randomUUID().slice(0, 6)}`, fullName: name },
  });

  const device = await h.prisma.device.create({
    data: {
      hostname: `PC-${name}`,
      windowsUsername: 'u',
      employeeId: employee.id,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
      lastSeenAt: now,
    },
  });

  if (minutes > 0) {
    const session = await h.prisma.workSession.create({
      data: {
        employeeId: employee.id,
        deviceId: device.id,
        workDate,
        startedAt: at(9),
        endedAt: at(9),
      },
    });

    await h.prisma.activitySegment.create({
      data: {
        sessionId: session.id,
        employeeId: employee.id,
        deviceId: device.id,
        clientUuid: randomUUID(),
        workDate,
        state: 'active',
        startedAt: at(9),
        endedAt: new Date(at(9).getTime() + minutes * 60_000),
        durationSec: minutes * 60,
        countsAsWork: true,
      },
    });
  }

  return employee.id;
}

describe('ঘণ্টার স্ন্যাপশট', () => {
  /**
   * ⚠️⚠️ **কাজের সময়ের বাইরে চুপ।** রাত ২টায় "Working now: 0/12" কোনো
   * তথ্য নয়, শুধু শব্দ — আর ওই শব্দই দিনের বার্তাগুলোকে অগ্রাহ্য করতে
   * শেখায়।
   */
  it('রাতে কিছুই পাঠায় না', async () => {
    await staffWithWork('Ali', 60);

    expect(await snapshot.runOnce(at(2))).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('কেউ না থাকলে চুপ', async () => {
    expect(await snapshot.runOnce(at(11))).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  /** ⭐⭐ এই ফাইলের মূল টেস্ট — প্রযোজকটা সত্যিই বার্তা পাঠায় */
  it('কাজের সময়ে বার্তা যায়, আর গোনাটা ঠিক', async () => {
    await staffWithWork('Ali', 60);
    await staffWithWork('Sadia', 0);

    expect(await snapshot.runOnce(at(11))).toBe('sent');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Working now:');
    expect(sent[0]).toContain('/2');
  });

  it('ঘড়ি বার্তার মাথায়', async () => {
    await staffWithWork('Ali', 30);

    await snapshot.runOnce(at(15));

    expect(sent[0]).toContain('oXeio · 15:00');
  });

  /**
   * ⭐ কাজ করা মানুষের নাম যায় না — বার্তা ছোট রাখার নিয়মটা প্রযোজকের
   * ভেতর দিয়েও টিকে আছে কি না, সেটাই এখানে দেখা।
   */
  it('বার্তা ছোট থাকে — সবার নাম লেখা হয় না', async () => {
    for (const n of ['Ali', 'Sadia', 'Karim', 'Hafiz']) await staffWithWork(n, 45);

    await snapshot.runOnce(at(11));

    expect(sent[0].length).toBeLessThan(400);
  });
});
