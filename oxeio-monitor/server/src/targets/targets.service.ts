import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DesignTargetStatus, UserRole } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  allocationSizes,
  amazonUrl,
  parseBulk,
  POOL_PER_DESIGNER,
  type RejectedLine,
} from './targets.rules';

export interface BulkResult {
  /** নতুন করে যতগুলো ঢুকল */
  added: number;
  /** ⚠️ আগে থেকেই ছিল — ভুল নয়, কিন্তু জানা দরকার */
  alreadyKnown: number;
  rejected: RejectedLine[];
  /** পুলে এখন কতগুলো অপেক্ষায় */
  poolSize: number;
}

export interface MyTarget {
  id: number;
  asin: string;
  url: string;
  jobNumber: number | null;
  assignedAt: string | null;
}

/**
 * **ডিজাইন-টার্গেট** *(২২ আগস্ট ২০২৬)* — জমা, বণ্টন, আর শেষ হওয়া।
 *
 * ⭐ গবেষকেরা রোজ ~৫০০টা Amazon URL জমা করেন; সকালে র‍্যান্ডম বণ্টন হয়;
 * ডিজাইনার একটা করে নিয়ে কাজ করেন।
 */
@Injectable()
export class TargetsService {
  private readonly logger = new Logger(TargetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * ⭐⭐ **কে জমা দিতে পারবেন** — মালিক · ম্যানেজার · **গবেষক**।
   *
   * ⚠️⚠️ **গবেষককে `@Roles()` দিয়ে আটকানো যায় না, আর সেটাই এখানকার
   * আসল কথা।** পোর্টালের রোল তিনটে (owner · manager · employee), আর
   * গবেষক ঢোকেন `employee` হিসেবে — অর্থাৎ রোল দেখে সিদ্ধান্ত নিলে হয়
   * সব কর্মী ঢুকে পড়তেন, নয় গবেষকই বাদ পড়তেন। ⭐ তাই অনুমতিটা **কাজের
   * ধরন** ধরে (`staff_type = 'researcher'`), আর সেটা ডাটাবেসে দেখে
   * নিতে হয় — টোকেনে ওটা নেই।
   *
   * ⚠️ টোকেনে ধরনটা বসানোও যেত (এক কল বাঁচত), কিন্তু তাহলে মালিক কারো
   * ধরন বদলানোর পরেও তাঁর পুরোনো টোকেন **মেয়াদ শেষ না হওয়া পর্যন্ত**
   * পুরোনো অনুমতি নিয়ে ঘুরত।
   */
  private async assertCanSubmit(actor: SessionUser): Promise<void> {
    if (actor.role === UserRole.owner || actor.role === UserRole.manager) return;

    if (actor.employeeId !== null) {
      const me = await this.prisma.employee.findUnique({
        where: { id: actor.employeeId },
        select: { staffType: true },
      });
      if (me?.staffType === 'researcher') return;
    }

    throw new ForbiddenException(
      'Only researchers, managers and the owner can add design targets.',
    );
  }

  /**
   * ⭐⭐ **একবারে ৫০০টা URL।**
   *
   * ⚠️⚠️ **ডুপ্লিকেট দুই স্তরে ছাঁকা হয়:** পেস্টের ভেতরে (`parseBulk`) আর
   * ডাটাবেসের বিপরীতে (`skipDuplicates`)। দ্বিতীয়টা ছাড়া `createMany`
   * পুরো ব্যাচটাই বাতিল করত — অর্থাৎ ৫০০টার মধ্যে একটা পুরোনো ASIN
   * থাকলেই গবেষকের গোটা দিনের কাজ জমা হতো না।
   *
   * ⚠️ কতগুলো **সত্যিই** ঢুকল সেটা `createMany`-র `count` থেকে নেওয়া হয়,
   * অনুমান করে নয় — "৫০০টা জমা হয়েছে" বলে ৪৩৭টা ঢোকাটা নীরব মিথ্যা।
   */
  async bulkAdd(actor: SessionUser, text: string, ip: string): Promise<BulkResult> {
    await this.assertCanSubmit(actor);

    const { accepted, rejected } = parseBulk(text);

    const created =
      accepted.length === 0
        ? { count: 0 }
        : await this.prisma.designTarget.createMany({
            data: accepted.map((t) => ({ asin: t.asin, addedById: actor.userId })),
            skipDuplicates: true,
          });

    const poolSize = await this.prisma.designTarget.count({
      where: { status: DesignTargetStatus.pool },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: 'design_targets',
      targetId: 'bulk',
      ipAddress: ip,
      // ⚠️ ASIN-গুলো audit-এ যায় না — পাঁচশো আইডি লগে বসিয়ে লাভ নেই,
      //    আর তালিকাটা টেবিলেই আছে
      meta: {
        added: created.count,
        rejected: rejected.length,
        pasted: accepted.length + rejected.length,
      },
    });

    return {
      added: created.count,
      alreadyKnown: accepted.length - created.count,
      rejected,
      poolSize,
    };
  }

  /**
   * ⭐⭐ **রোজকার বণ্টন — র‍্যান্ডম, কিন্তু ন্যায্য।**
   *
   * ⚠️⚠️ **বাছাই র‍্যান্ডম হয় ডাটাবেসেই** (`ORDER BY random()`), মেমরিতে
   * নয়। গোটা পুল (হাজার হাজার সারি) টেনে এনে জাভাস্ক্রিপ্টে মেশানো
   * যেত, কিন্তু পুল বড় হলে সেটা রোজ সকালে একটা অকারণ বোঝা হতো।
   *
   * ⚠️⚠️ **এক লেনদেনে দাবি করা হয়** — `status = 'pool'` শর্তসহ update।
   * দুটো রান একসাথে চললে (মালিক বোতাম চাপলেন আর জবও চলল) দুজনের হাতে
   * একই টার্গেট পড়ে যেত। শর্তটাই আসল পাহারা।
   *
   * ⚠️ কখনো throw করে না — বণ্টন ব্যর্থ হলে কাল আবার চেষ্টা হবে; এর
   * জন্য সার্ভার নামা চলবে না।
   */
  async distribute(now: Date = new Date()): Promise<{ assigned: number }> {
    let assigned = 0;

    try {
      const designers = await this.prisma.employee.findMany({
        where: { status: 'active', staffType: 'designer' },
        select: { id: true, empCode: true },
        // ⚠️ কর্মী-কোড ধরে — পুলে ঘাটতি থাকলে কে আগে পাবে সেটা **অনুমেয়**
        //    থাকা দরকার; র‍্যান্ডম হলে রোজ আলাদা লোক বঞ্চিত হতেন আর কেউ
        //    কারণ বলতে পারত না। (বাছাই র‍্যান্ডম, ক্রম নয়।)
        orderBy: { empCode: 'asc' },
      });
      if (designers.length === 0) return { assigned: 0 };

      const open = await this.prisma.designTarget.groupBy({
        by: ['assignedToId'],
        where: {
          status: DesignTargetStatus.assigned,
          assignedToId: { in: designers.map((d) => d.id) },
        },
        _count: { _all: true },
      });
      const openBy = new Map(open.map((o) => [o.assignedToId, o._count._all]));

      const poolSize = await this.prisma.designTarget.count({
        where: { status: DesignTargetStatus.pool },
      });

      const sizes = allocationSizes(
        designers.map((d) => ({
          employeeId: d.id,
          openCount: openBy.get(d.id) ?? 0,
        })),
        poolSize,
      );

      for (const [employeeId, size] of sizes) {
        assigned += await this.claimFor(employeeId, size, now);
      }

      if (assigned > 0) {
        this.logger.log(
          `Design targets distributed · ${assigned} to ${sizes.size} designers`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Could not distribute design targets: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { assigned };
  }

  /**
   * একজনের জন্য `size`টা টার্গেট পুল থেকে দাবি করা।
   *
   * ⚠️⚠️ `WHERE status = 'pool'` শর্তটা update-এর ভেতরেই — দুটো রান
   * একসাথে চললেও একই সারি দুজনের হাতে পড়তে পারে না।
   *
   * ⭐ কাজের নম্বর বসে **এখানেই**, বরাদ্দের মুহূর্তে — পুলে পড়ে থাকা
   * টার্গেটের নম্বর থাকে না। নইলে কখনো বরাদ্দ না হওয়া হাজারখানেক
   * টার্গেট সিরিয়াল খেয়ে ফেলত।
   */
  private async claimFor(
    employeeId: number,
    size: number,
    now: Date,
  ): Promise<number> {
    const picked = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM design_targets
      WHERE status = 'pool'
      ORDER BY random()
      LIMIT ${size}
      FOR UPDATE SKIP LOCKED
    `;
    if (picked.length === 0) return 0;

    let count = 0;

    for (const row of picked) {
      const done = await this.prisma.$executeRaw`
        UPDATE design_targets
        SET status = 'assigned',
            assigned_to_id = ${employeeId},
            assigned_at = ${now},
            job_number = nextval('design_job_number_seq')
        WHERE id = ${row.id} AND status = 'pool'
      `;
      count += done;
    }

    return count;
  }

  /** ⭐ ডিজাইনারের নিজের তালিকা — যেগুলো এখনো হাতে আছে */
  async mine(employeeId: number): Promise<MyTarget[]> {
    const rows = await this.prisma.designTarget.findMany({
      where: { assignedToId: employeeId, status: DesignTargetStatus.assigned },
      select: { id: true, asin: true, jobNumber: true, assignedAt: true },
      // ⚠️ যেটা আগে এসেছে সেটা আগে — নইলে পুরোনো টার্গেট চিরকাল তলায়
      //    পড়ে থাকত আর কেউ ধরত না
      orderBy: { assignedAt: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      asin: r.asin,
      url: amazonUrl(r.asin),
      jobNumber: r.jobNumber,
      assignedAt: r.assignedAt?.toISOString() ?? null,
    }));
  }

  /**
   * ⭐ "এটা বাদ দিলাম"।
   *
   * ⚠️⚠️ **শর্তে `assignedToId` আছে** — নিজের টার্গেট ছাড়া কেউ কিছু
   * ছুঁতে পারে না। আইডি অনুমান করে অন্যের সারি বদলানোর পথ বন্ধ।
   */
  async skip(
    employeeId: number,
    id: number,
    reason: string | null,
  ): Promise<{ ok: boolean }> {
    const { count } = await this.prisma.designTarget.updateMany({
      where: { id, assignedToId: employeeId, status: DesignTargetStatus.assigned },
      data: { status: DesignTargetStatus.skipped, skippedReason: reason },
    });

    return { ok: count > 0 };
  }

  /**
   * "শেষ করেছি" — হাতে চিহ্ন।
   *
   * ⚠️ `completedVia: 'manual'` লেখা থাকে, যাতে পরে বলা যায় কোনটা সিস্টেম
   * নিজে ধরেছে আর কোনটা কেউ হাতে বলেছে। সংখ্যাটা এক, কিন্তু ভরসা এক নয়।
   */
  async markDone(employeeId: number, id: number): Promise<{ ok: boolean }> {
    const { count } = await this.prisma.designTarget.updateMany({
      where: { id, assignedToId: employeeId, status: DesignTargetStatus.assigned },
      data: {
        status: DesignTargetStatus.done,
        completedAt: new Date(),
        completedVia: 'manual',
      },
    });

    return { ok: count > 0 };
  }

  /**
   * ⭐⭐ **ফাইলের নাম থেকে "শেষ হয়েছে" ধরা** — কোনো বোতাম ছাড়াই।
   *
   * ডিজাইনার বরাদ্দ পাওয়া নম্বরটা ফাইলের নামে বসান
   * (`1000042-Funny Cat T-Shirt.ai`), আর ওই নম্বরটাই `design_credits`-এ
   * উঠে আসে। এখানে সেটা মিলিয়ে টার্গেটটা বন্ধ করা হয়।
   *
   * ⚠️⚠️ **শর্তে `assignedToId` আছে** — একজনের ফাইল আরেকজনের টার্গেট
   * বন্ধ করতে পারবে না। নম্বর দুজনের কাছে থাকার কথা নয়, কিন্তু "কথা নয়"
   * আর "পারবে না" এক জিনিস নয়।
   *
   * ⚠️ কখনো throw করে না — এটা একটা সুবিধা, আর এর জন্য দৈনিক সারাংশ
   * আটকে যাওয়া চলবে না।
   */
  async closeByJobNumbers(
    employeeId: number,
    numbers: readonly string[],
    now: Date,
  ): Promise<number> {
    const ids = numbers
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isSafeInteger(n));
    if (ids.length === 0) return 0;

    try {
      const { count } = await this.prisma.designTarget.updateMany({
        where: {
          jobNumber: { in: ids },
          assignedToId: employeeId,
          status: DesignTargetStatus.assigned,
        },
        data: {
          status: DesignTargetStatus.done,
          completedAt: now,
          completedVia: 'filename',
        },
      });

      return count;
    } catch (err) {
      this.logger.warn(
        `Could not close targets by job number: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  /** পুলের অবস্থা — ইনবক্সের পর্দায় */
  async stats(): Promise<Record<DesignTargetStatus, number> & { perDesigner: number }> {
    const rows = await this.prisma.designTarget.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const out = {
      pool: 0,
      assigned: 0,
      done: 0,
      skipped: 0,
      perDesigner: POOL_PER_DESIGNER,
    };
    for (const r of rows) out[r.status] = r._count._all;

    return out;
  }
}
