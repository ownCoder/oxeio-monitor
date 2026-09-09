import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { localMidnightOf, nextLocalMidnight } from '../src/agent/util/dhaka-time';
import {
  MAX_ISSUED_PER_DAY,
  POOL_PER_DESIGNER,
} from '../src/targets/targets.rules';
import { TargetsService } from '../src/targets/targets.service';
import {
  createEmployeeWithCode,
  createHarness,
  dhakaNoon,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐⭐ **দিনের দুটো সীমা** *(মালিকের নিয়ম, ৯ সেপ্টেম্বর ২০২৬)*।
 *
 * > *"daily 30 ta design distribute korar pore karo jodi complete + skip
 * > miliye 30 ta hoy … take tokhon tumi arO kiso design dibe jate se daily
 * > target 25 ta hit korte pare. er sathe etaO korbe kono designer daily
 * > 25 tar beshi design complete korte parbena."*
 *
 * ⚠️⚠️ দুটো নিয়ম **পরস্পরের বিপরীত দিকে টানে**, আর সেটাই এই ফাইলের
 * সবচেয়ে জরুরি দাবি: টার্গেট ছোঁয়া হয়ে গেলে টপ-আপ **থেমে যেতে হবে**,
 * নইলে সীমা বলত *"আর শেষ কোরো না"* আর টপ-আপ আরও কাজ ঢালত — হাত ভরে
 * যেত এমন কাজে যা আজ ছোঁয়াই যাবে না।
 *
 * ⚠️ এই ফাইলে কোনো পিন-করা তারিখ নেই (G140) — সব `dhakaNoon()`-এর সাপেক্ষে।
 */
let h: Harness;
let targets: TargetsService;

const TARGET = 25;

beforeAll(async () => {
  h = await createHarness();
  targets = h.app.get(TargetsService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

async function person(
  code: string,
  staffType: 'designer' | 'manager',
  dailyDesignTarget: number | null = null,
): Promise<number> {
  const { employeeId } = await createEmployeeWithCode(h.prisma, code);

  /**
   * ⚠️⚠️ **পলিসিটা জুড়ে দেওয়া হয় ইচ্ছাকৃতভাবে** — হারনেসের পলিসিতে
   * `dailyDesignTarget = 25` বসানো আছে।
   *
   * ⭐ নইলে ম্যানেজারের দাবিটা **ভুল কারণে** সবুজ থাকত: পলিসি না থাকায়
   * `designTargetOf()` এমনিতেই ০ ফেরত দিত, আর `hasDesignTarget()`
   * তুলে দিলেও টেস্ট ধরত না। সাবোতাজে ঠিক সেটাই ধরা পড়েছিল
   * (৯ সেপ্টেম্বর) — দাবিটা ছিল ফাঁকা।
   */
  const policy = await h.prisma.workPolicy.findFirstOrThrow();

  await h.prisma.employee.update({
    where: { id: employeeId },
    data: { staffType, dailyDesignTarget, policyId: policy.id },
  });

  return employeeId;
}

let asinSeq = 0;
const nextAsin = () => `B${String(++asinSeq).padStart(9, '0')}`;

/** পুলে `n`টা টার্গেট — টপ-আপ এখান থেকেই তোলে */
async function pool(n: number): Promise<void> {
  const owner = await h.prisma.user.findFirstOrThrow();

  await h.prisma.designTarget.createMany({
    data: Array.from({ length: n }, () => ({
      asin: nextAsin(),
      status: 'pool' as const,
      addedById: owner.id,
    })),
  });
}

/** ওই কর্মীর হাতে `n`টা — ফেরত আসে তাদের id */
async function inHand(employeeId: number, n: number, at: Date): Promise<number[]> {
  const owner = await h.prisma.user.findFirstOrThrow();
  const ids: number[] = [];

  for (let i = 0; i < n; i++) {
    const row = await h.prisma.designTarget.create({
      data: {
        asin: nextAsin(),
        status: 'assigned',
        assignedToId: employeeId,
        assignedAt: at,
        addedById: owner.id,
      },
    });
    ids.push(row.id);
  }

  return ids;
}

/** আজ ঢাকার দিনে `n`টা ইতিমধ্যেই শেষ করা */
async function alreadyDone(employeeId: number, n: number, at: Date): Promise<void> {
  const owner = await h.prisma.user.findFirstOrThrow();

  for (let i = 0; i < n; i++) {
    await h.prisma.designTarget.create({
      data: {
        asin: nextAsin(),
        status: 'done',
        assignedToId: employeeId,
        assignedAt: at,
        completedAt: at,
        completedVia: 'manual',
        completedById: owner.id,
        addedById: owner.id,
      },
    });
  }
}

const openCountOf = (employeeId: number) =>
  h.prisma.designTarget.count({
    where: { assignedToId: employeeId, status: 'assigned' },
  });

describe('দিনের সীমা — ২৫-এর বেশি "শেষ" বলা যায় না', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের প্রধান দাবি।**
   *
   * ⚠️⚠️ আর সাথের দাবিটাও সমান জরুরি: **সারিটা হাতেই থেকে যায়**। মুছে
   * গেলে বা পুলে ফিরে গেলে সত্যিকারের করা কাজ হারিয়ে যেত।
   */
  it('⭐⭐⭐ ২৫ হয়ে গেলে ২৬তমটা আটকায়, আর সারিটা হাতেই থাকে', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-Q1', 'designer', TARGET);

    await alreadyDone(emp, TARGET, now);
    const [id] = await inHand(emp, 1, now);

    await expect(targets.markDone(emp, id, 1, now)).rejects.toThrow(/already marked 25/i);

    const after = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('assigned');
    expect(after.completedAt).toBeNull();
  });

  it('⭐⭐ ২৪-এ থাকলে ২৫তমটা যায়', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-Q2', 'designer', TARGET);

    await alreadyDone(emp, TARGET - 1, now);
    const [id] = await inHand(emp, 1, now);

    await expect(targets.markDone(emp, id, 1, now)).resolves.toEqual({ ok: true });
  });

  /**
   * ⭐⭐⭐ **ম্যানেজারের সীমা নেই।**
   *
   * ⚠️⚠️ মাঠে OX-01 দিনে ৪৪ পর্যন্ত করেন আর তাঁর কোনো টার্গেটই নেই।
   * সীমা বসালে তাঁর কাজ নীরবে আটকে যেত — কোনো পর্দা সেটা বলত না।
   */
  it('⭐⭐⭐ যাঁর টার্গেট নেই তাঁর সীমাও নেই', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-Q3', 'manager');

    await alreadyDone(emp, 40, now);
    const [id] = await inHand(emp, 1, now);

    await expect(targets.markDone(emp, id, 1, now)).resolves.toEqual({ ok: true });
  });

  /** ⚠️ ০ মানে "টার্গেট বন্ধ", শাস্তি নয় — সীমাও বসে না */
  it('⭐⭐ টার্গেট ০ হলে সীমা নেই', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-Q4', 'designer', 0);

    await alreadyDone(emp, 40, now);
    const [id] = await inHand(emp, 1, now);

    await expect(targets.markDone(emp, id, 1, now)).resolves.toEqual({ ok: true });
  });

  /**
   * ⭐⭐⭐ **দিনটা ঢাকার, UTC-র নয়** — এই রেপোর সবচেয়ে বেশিবার হওয়া ভুল।
   *
   * ⚠️⚠️ গতকালের ২৫টা আজকের হিসাবে ঢুকলে ডিজাইনার সকালেই আটকে যেতেন।
   * ফিক্সচারটা বসানো হয় গতকালের ঢাকা-দুপুরে, আর দাবিটা হলো আজ কিছুই
   * আটকাবে না।
   */
  it('⭐⭐⭐ গতকালের "শেষ" আজকের সীমায় গোনা হয় না', async () => {
    const now = dhakaNoon();
    const yesterday = new Date(localMidnightOf(now).getTime() - 12 * 3600_000);
    const emp = await person('OX-Q5', 'designer', TARGET);

    await alreadyDone(emp, TARGET, yesterday);
    const [id] = await inHand(emp, 1, now);

    await expect(targets.markDone(emp, id, 1, now)).resolves.toEqual({ ok: true });
  });

  /**
   * ⭐⭐⭐ **ঢাকার দিনের শেষ ঘণ্টাটাও আজই** — UTC ধরলে ওটা কালকে পড়ত।
   *
   * ⚠️ ঢাকার রাত ১১টা মানে UTC-তে বিকেল ৫টা **একই দিনের**; কিন্তু
   * `workDateOf()`-এর লেবেলটা সরাসরি সীমানা ধরলে দিনটা ভোর ৬টায় শুরু
   * হতো, আর রাত ১১টার কাজ **পরের দিনে** পড়ত।
   */
  it('⭐⭐⭐ ঢাকার রাত ১১টার কাজ আজকের সীমাতেই পড়ে', async () => {
    const now = dhakaNoon();
    const lateTonight = new Date(nextLocalMidnight(now).getTime() - 3600_000);
    const emp = await person('OX-Q6', 'designer', TARGET);

    await alreadyDone(emp, TARGET, lateTonight);
    const [id] = await inHand(emp, 1, lateTonight);

    await expect(targets.markDone(emp, id, 1, lateTonight)).rejects.toThrow(
      /already marked 25/i,
    );
  });

  /**
   * ⭐⭐ **মালিক/ম্যানেজারের পথটা আটকায় না** *(ইচ্ছাকৃত)*।
   *
   * ⚠️ নইলে ভুল সংশোধনের রাস্তাই বন্ধ হতো। কে চেপেছেন সেটা
   * `completed_by_id`-তে এমনিতেই লেখা থাকে।
   */
  it('⭐⭐ মালিকের `update()` পথে সীমা খাটে না', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-Q7', 'designer', TARGET);
    const owner = await h.prisma.user.findFirstOrThrow();

    await alreadyDone(emp, TARGET, now);
    const [id] = await inHand(emp, 1, now);

    await targets.update(id, 'done', now, owner.id);

    const after = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('done');
  });
});

describe('টপ-আপ — টার্গেট ছোঁয়ার মতো কাজ হাতে রাখা', () => {
  /**
   * ⭐⭐⭐ **মালিকের বলা অবস্থাটা** — হাতের সব শেষ, তবু ২৫ হয়নি।
   *
   * ১০টা শেষ, হাতে আর কিছু নেই → বাকি ১৫-র জন্য ৩০:২৫ অনুপাতে ১৮টা।
   */
  it('⭐⭐⭐ শেষ টার্গেটটা শেষ করলেই হাত আবার ভরে', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-Q8', 'designer', TARGET);

    await pool(50);
    await alreadyDone(emp, 9, now);
    const [last] = await inHand(emp, 1, now);

    await targets.markDone(emp, last, 1, now);

    // ⭐ ১০ শেষ, বাকি ১৫ → ceil(15 × 30 / 25) = ১৮
    expect(await openCountOf(emp)).toBe(18);
  });

  /** ⭐⭐⭐ **বাদ দেওয়াও হাত খালি করে** — মালিকের কথায় "complete + skip" */
  it('⭐⭐⭐ শেষ টার্গেটটা বাদ দিলেও হাত ভরে', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-Q9', 'designer', TARGET);

    await pool(50);
    const [last] = await inHand(emp, 1, now);

    await targets.skip(emp, last, 'not_found', now);

    expect(await openCountOf(emp)).toBe(POOL_PER_DESIGNER);
  });

  /**
   * ⭐⭐⭐ **হাতে যথেষ্ট থাকলে কিছুই দেওয়া হয় না** — আর মাঠে এটাই
   * স্বাভাবিক অবস্থা: ৭ ও ৮ সেপ্টেম্বরে সবার হাতে ছিল ১৭–২৯টা।
   */
  it('⭐⭐⭐ হাত ভরা থাকলে টপ-আপ হয় না', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-QA', 'designer', TARGET);

    await pool(50);
    const ids = await inHand(emp, POOL_PER_DESIGNER, now);

    await targets.markDone(emp, ids[0], 1, now);

    // ⚠️ একটা শেষ হলো, বাকি ২৯ হাতে — ২৪ বাকির জন্য ২৯-ই যথেষ্ট
    expect(await openCountOf(emp)).toBe(POOL_PER_DESIGNER - 1);
  });

  /**
   * ⭐⭐⭐ **দুটো নিয়মের সংঘর্ষটা এখানেই মেটে।**
   *
   * ⚠️⚠️ টার্গেট ছোঁয়া হয়ে গেলে টপ-আপ থেমে যায় — নইলে সীমা বলত "আর
   * শেষ কোরো না" আর টপ-আপ হাত ভরিয়ে দিত এমন কাজে যা আজ ছোঁয়াই যাবে না।
   */
  it('⭐⭐⭐ ২৫ ছোঁয়ার পর হাত খালি হলেও আর কিছু দেওয়া হয় না', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-QB', 'designer', TARGET);

    await pool(50);
    await alreadyDone(emp, TARGET - 1, now);
    const [last] = await inHand(emp, 1, now);

    await targets.markDone(emp, last, 1, now);

    expect(await openCountOf(emp)).toBe(0);
  });

  /** ⚠️ ম্যানেজারের টার্গেট নেই — সকালের বণ্টনই তাঁর জন্য যথেষ্ট */
  it('⭐⭐ যাঁর টার্গেট নেই, তাঁর টপ-আপও নেই', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-QC', 'manager');

    await pool(50);
    const [last] = await inHand(emp, 1, now);

    await targets.markDone(emp, last, 1, now);

    expect(await openCountOf(emp)).toBe(0);
  });

  /**
   * ⭐⭐⭐ **পুল খালি হলে "শেষ করেছি" চাপাটা ব্যর্থ হবে না।**
   *
   * ⚠️⚠️ টপ-আপ একটা সুবিধা, শর্ত নয়। ওটা throw করলে পুল ফুরোনোর দিনে
   * কেউ নিজের কাজ শেষ বলেই চিহ্ন দিতে পারতেন না।
   */
  it('⭐⭐⭐ পুল খালি — তবু কাজটা শেষ হয়', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-QD', 'designer', TARGET);

    const [last] = await inHand(emp, 1, now);

    await expect(targets.markDone(emp, last, 1, now)).resolves.toEqual({ ok: true });
    expect(await openCountOf(emp)).toBe(0);
  });


  /**
   * ⭐⭐⭐ **ভোররাত — যে ঘণ্টাগুলোয় সীমাটা নীরবে বন্ধ হয়ে যেত।**
   *
   * ⚠️⚠️ `workDateOf()` ঢাকার দিনটাকে UTC-মধ্যরাত হিসেবে লেখে, অর্থাৎ
   * **ঢাকার ভোর ৬টা**। ওটা সীমানা ধরলে রাত ১২টা–৬টার মধ্যে গণনার শুরুটা
   * **ভবিষ্যতে** পড়ত, সংখ্যা আসত শূন্য, আর সীমা পুরো বন্ধ থাকত —
   * কেউ ওই ছয় ঘণ্টায় যত খুশি শেষ করতে পারতেন।
   */
  it('⭐⭐⭐ ঢাকার রাত ৩টাতেও আজকের হিসাব ঠিক থাকে', async () => {
    const now = dhakaNoon();
    const at3am = new Date(localMidnightOf(now).getTime() + 3 * 3600_000);
    const emp = await person('OX-QF', 'designer', TARGET);

    await alreadyDone(emp, TARGET, at3am);
    const [id] = await inHand(emp, 1, at3am);

    await expect(targets.markDone(emp, id, 1, at3am)).rejects.toThrow(
      /already marked 25/i,
    );
  });

  /**
   * ⭐⭐⭐ **দিনের ছাদ মাঠেও খাটে** — একটার পর একটা বাদ দিয়ে গেলে
   * পুল অসীমবার ঘাঁটা যায় না।
   */
  it('⭐⭐⭐ ৬০টা দেওয়া হয়ে গেলে আর টপ-আপ হয় না', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-QG', 'designer', TARGET);

    await pool(50);
    // ⚠️ আজ ইতিমধ্যেই ছাদের সমান দেওয়া হয়েছে
    const ids = await inHand(emp, MAX_ISSUED_PER_DAY, now);
    await h.prisma.designTarget.updateMany({
      where: { id: { in: ids.slice(1) } },
      data: { status: 'skipped', dropReason: 'not_found' },
    });

    await targets.skip(emp, ids[0], 'not_found', now);

    expect(await openCountOf(emp)).toBe(0);
  });

  /**
   * ⭐⭐⭐ **যাঁর হাতে একটাও নেই, তিনি কিছু চাপতেই পারেন না।**
   *
   * ⚠️⚠️ ঘটনার সাথে সাথে চালানো টপ-আপ (`markDone`/`skip`-এর পরে) ঠিক
   * **তাঁকেই** ছুঁতে পারে না যাঁর কথা মালিক বলেছিলেন। মাঠে ওই দশা হয়
   * যখন সকালে পুলে কম থাকে — `allocationSizes` কর্মী-কোডের ক্রমে দেয়,
   * আর শেষজন কিছুই পান না। ⭐ তাই ঘণ্টার টিকটা আলাদা করে লাগে।
   */
  it('⭐⭐⭐ খালি হাতে ঘণ্টার টিকই একমাত্র ভরসা', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-QH', 'designer', TARGET);

    await pool(50);
    expect(await openCountOf(emp)).toBe(0);

    await targets.topUpAll(now);

    expect(await openCountOf(emp)).toBe(POOL_PER_DESIGNER);
  });

  /** ⭐⭐ টিকটা idempotent — হাত ভরা থাকলে দ্বিতীয়বারে কিছুই বদলায় না */
  it('⭐⭐ টিক বারবার চললেও হাত ৩০-এর বেশি হয় না', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-QI', 'designer', TARGET);

    await pool(80);
    await targets.topUpAll(now);
    await targets.topUpAll(now);
    await targets.topUpAll(now);

    expect(await openCountOf(emp)).toBe(POOL_PER_DESIGNER);
  });

  /** ⚠️ পুলে যতটা আছে ততটাই — বাকিটা নীরবে বানানো হয় না */
  it('⭐⭐ পুলে কম থাকলে যতটা আছে ততটাই', async () => {
    const now = dhakaNoon();
    const emp = await person('OX-QE', 'designer', TARGET);

    await pool(4);
    const [last] = await inHand(emp, 1, now);

    await targets.markDone(emp, last, 1, now);

    expect(await openCountOf(emp)).toBe(4);
  });
});
