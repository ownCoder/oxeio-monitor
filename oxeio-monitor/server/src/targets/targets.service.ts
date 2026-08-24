import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DesignTargetStatus } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  allocationSizes,
  amazonUrl,
  asinOf,
  canUseTargets,
  parseBulk,
  POOL_PER_DESIGNER,
  UPLOAD_QUEUE_FROM,
  type RejectedLine,
} from './targets.rules';

/**
 * ⭐⭐ 'YYYY-MM-DD' → ওই দিনের **ঢাকার মধ্যরাত**।
 *
 * ⚠️ মডিউল-স্তরে রাখা হয়েছে ইচ্ছাকৃতভাবে: `list()`-এর ছাঁকনি আর
 * `stats()`-এর গণনা — দুটোকে **হুবহু এক তারিখ** ধরতে হয়। চিপে ১৩২ লিখে
 * ক্লিক করার পর ৯০টা এলে কেউ আর কোনো সংখ্যাই বিশ্বাস করবে না, আর এই
 * প্রকল্পে ঠিক এভাবেই একই সূত্র দুই জায়গায় লেখা হয়ে বাগ জন্মেছে।
 */
const dhakaStart = (day: string): Date => new Date(`${day}T00:00:00+06:00`);
const nextDay = (day: string): Date =>
  new Date(dhakaStart(day).getTime() + 86_400_000);

/**
 * ⚠️⚠️ পর্দায় সর্বোচ্চ কতগুলো বাদ-পড়া লাইন দেখানো হবে *(২৩ আগস্ট ২০২৬)*।
 *
 * ছাদ তোলার পর ৪৫,০০০ লাইন পেস্ট করা সম্ভব। কেউ ভুল ফাইল পেস্ট করলে
 * **সবগুলোই** বাদ পড়ত, আর তখন গোটা তালিকা ব্রাউজারে পাঠালে উত্তরটা কয়েক
 * MB হতো আর পর্দায় ৪৫,০০০ সারির টেবিল বসত — ব্রাউজার জমে যেত।
 *
 * ⭐ সংখ্যাটা (`rejectedTotal`) **সত্যি থাকে**, কেবল তালিকাটা ছাঁটা হয়।
 * ২০০টা দেখলেই ভুলের ধরনটা বোঝা যায়; ২০১তম সারি নতুন কিছু বলে না।
 */
export const REJECTED_SHOWN = 200;

export interface BulkResult {
  /** নতুন করে যতগুলো ঢুকল */
  added: number;
  /** ⚠️ আগে থেকেই ছিল — ভুল নয়, কিন্তু জানা দরকার */
  alreadyKnown: number;
  /** ⚠️ সর্বোচ্চ `REJECTED_SHOWN`টা — আসল সংখ্যা `rejectedTotal`-এ */
  rejected: RejectedLine[];
  /** ⭐ কতগুলো সত্যিই বাদ পড়েছে — তালিকা ছাঁটা হলেও এটা পুরো সংখ্যা */
  rejectedTotal: number;
  /** পুলে এখন কতগুলো অপেক্ষায় */
  poolSize: number;
}

/**
 * ⚠️ এক পাতায় ৫০টা — বেশি দিলে ৩৯ হাজারের টেবিলে স্ক্রল করাই কষ্ট হতো,
 * কম দিলে গবেষককে বারবার "পরের পাতা" চাপতে হতো।
 */
export const TARGET_PAGE_SIZE = 50;

export interface TargetRow {
  id: number;
  asin: string;
  url: string;
  status: DesignTargetStatus;
  jobNumber: number | null;
  /** ⚠️ ছেড়ে যাওয়া কর্মীর সারিতে `null` — নামটা `sourceNote`-এ */
  assignedTo: { empCode: string; fullName: string } | null;
  assignedAt: string | null;
  /** ⭐ ফাইলটা প্রথমবার খোলা হয়েছে — "কাজ চলছে" */
  startedAt: string | null;
  completedAt: string | null;
  completedVia: string | null;
  /** পুরোনো Excel-এর কাঁচা লেখা — "Hafiz-24-05-2026" */
  sourceNote: string | null;

  /**
   * ⚠️⚠️ নিচের ঘরগুলো `list()` **আগে থেকেই ফেরত দিত**, কিন্তু এই টাইপে
   * লেখা ছিল না — অর্থাৎ চুক্তিটা বাস্তবের চেয়ে ছোট ছিল, আর TypeScript
   * সেটা ধরত না (`.map()`-এর ফল কাঠামোগতভাবে assignable)। ⭐ ২৫ আগস্ট
   * বানান-যাচাইয়ের ঘর যোগ করতে গিয়ে ধরা পড়ল; একসাথে সবগুলো লেখা হলো।
   */
  completedBy: { fullName: string; role: string } | null;
  /** ⭐ বানান দেখা হয়েছে — `null` = এখনো দেখা হয়নি (ADR-038) */
  checkedAt: string | null;
  /** ⭐ ভুল পাওয়া গেছে — `null` **আর** `checkedAt` বসানো = ঠিক ছিল */
  errorFoundAt: string | null;
  /** ⭐ ভুলটা ঠিক করা হয়েছে */
  fixedAt: string | null;
  uploadedAt: string | null;
  liveAt: string | null;
  liveAsin: string | null;
}

export interface MyTarget {
  id: number;
  asin: string;
  url: string;
  jobNumber: number | null;
  assignedAt: string | null;
  /** ⭐ ফাইলটা খোলা হয়েছে — পর্দায় "কাজ চলছে" */
  startedAt: string | null;
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
   * ⭐⭐ **কে টার্গেট দেখতে ও জমা দিতে পারবেন** — মালিক · ম্যানেজার ·
   * **গবেষক** *(২৩ আগস্ট; রোল-ভিত্তিক হলো ২৫ আগস্ট)*।
   *
   * ⚠️ পড়া ও লেখার পাহারা **একটাই**, আর সেটা ইচ্ছাকৃত: পুরো তালিকায়
   * দেখা যায় গোটা দলের কাজ কোথায় দাঁড়িয়ে — সেটা ডিজাইনারের দেখার
   * জিনিস নয়। ⭐ তিনি নিজের ৩০টা দেখেন `/me/targets`-এ।
   *
   * ### ⚠️⚠️ এখানে আগে যা লেখা ছিল, আর কেন সেটা আর সত্যি নয়
   *
   * পুরোনো টীকা বলত: *"গবেষককে `@Roles()` দিয়ে আটকানো যায় না — পোর্টালের
   * রোল তিনটে (owner · manager · employee), আর গবেষক ঢোকেন `employee`
   * হিসেবে"*। তাই অনুমতিটা **অন্য টেবিলের** `staff_type` ধরে নিতে হতো,
   * প্রতি রিকোয়েস্টে একটা করে ডাটাবেস কল খরচ করে।
   *
   * ⭐⭐ ২৫ আগস্ট মালিক ওই ভিতটাই সরিয়ে দিলেন — *"researcher and designer
   * same kaj kore na, tai eder access o same hobe na"*। `UserRole`-এ এখন
   * `researcher` আছে, তাই প্রশ্নটা আর দুই টেবিলে ভাগ নয়।
   *
   * ফল তিনটে, আর তিনটেই লাভ:
   *   · ডাটাবেস কল **উধাও** — ফাংশনটা এখন সমার্থক (sync)
   *   · সাইডবারের `roles: [...] + when: canAddTargets` হ্যাকটা **মুছে গেল**
   *   · অনুমতি **এক জায়গায়** — আর দুই টেবিলে ভাগ থাকাটাই ২৪ আগস্টের
   *     গণ্ডগোলটা সম্ভব করেছিল (ADR-038)
   *
   * ⚠️ পুরোনো টীকার আরেকটা আশঙ্কা ছিল — *"টোকেনে ধরনটা বসালে মালিক ধরন
   * বদলানোর পরেও পুরোনো টোকেন পুরোনো অনুমতি নিয়ে ঘুরত"*। সেটাও আর খাটে
   * না: `JwtAuthGuard` প্রতি ৫ মিনিটে ভূমিকাটা **ডাটাবেস থেকে নতুন করে
   * পড়ে** (সেখানকার টীকা দেখুন)। রোল বদলালে কাউকে লগআউট করতে হয় না।
   */
  assertCanUse(actor: SessionUser): void {
    if (canUseTargets(actor.role)) return;

    throw new ForbiddenException(
      'Only researchers, managers and the owner can add design targets.',
    );
  }

  /**
   * ⭐⭐ **কে বানান যাচাই করতে পারেন** — মালিক · ম্যানেজার · গবেষক।
   *
   * ### ⚠️⚠️ এই ফাংশনটা এক দিনে দুবার বদলেছে, আর ইতিহাসটা কাজে লাগে
   *
   * **২৫ আগস্ট, সকাল** — মালিক: *"ami chai ei access ami manager and
   * sumaiya pak"*। তখন এটা ছিল `employees.can_proofread` টিক-ঘর ধরে,
   * অর্থাৎ **ব্যক্তি ধরে**।
   *
   * **২৫ আগস্ট, পরে** — মালিক: *"sob researcher ra sei access gula pabe...
   * researcher and designer same kaj kore na, tai eder access o same hobe
   * na"*। অর্থাৎ প্রশ্নটা কখনোই *"কোন মানুষ"* ছিল না, ছিল *"কোন কাজ"*।
   * ⭐ তাই টিক-ঘরটা তুলে দেওয়া হয়েছে আর রোলই অধিকারটা বহন করে।
   *
   * ⚠️⚠️ **সূত্রটা আজ `assertCanUse`-এর হুবহু সমান, তবু ফাংশন দুটো আলাদা**
   * — আর এটা ইচ্ছাকৃত, এই কোডবেসের নিয়ম মেনেই (`App.tsx`-এ
   * `mayOpenSettings` কেন `isOwner || isManager` নয়, সেই একই কারণ)।
   * শর্তের **নাম** থাকলে ভবিষ্যতে একটা বদলাতে গিয়ে অন্যটা খুঁজে বেড়াতে
   * হয় না। মিলে যাওয়া সমান হওয়া নয়।
   */
  assertCanProofread(actor: SessionUser): void {
    if (canUseTargets(actor.role)) return;

    throw new ForbiddenException(
      'Only researchers, managers and the owner can check spelling.',
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
    await this.assertCanUse(actor);

    const { accepted, rejected } = parseBulk(text);

    /**
     * ⭐⭐ **কাজের নম্বর বসে জমা দেওয়ার মুহূর্তেই** *(২৩ আগস্ট, মালিকের
     * চাওয়া: "every target er job no thakobe")*।
     *
     * ⚠️ আগে নম্বরটা বসত **বরাদ্দের সময়**, যাতে কখনো বরাদ্দ না হওয়া
     * সারি সিরিয়াল না খায়। কিন্তু তাতে পুলে পড়ে থাকা সারির কোনো পরিচয়
     * থাকত না — মালিক তালিকায় একটা সারি দেখিয়ে বলতে পারতেন না "এই
     * নম্বরটা"। ⭐ সিরিয়াল ৪ বাইটের int, তাই ৩৯ হাজার নয়, ২০০ কোটি
     * পর্যন্ত চলে; খরচটা কল্পিত ছিল।
     *
     * ⚠️ `createMany` দিয়ে `nextval` ডাকা যায় না, তাই raw insert —
     * কিন্তু `ON CONFLICT DO NOTHING` রাখা হয়েছে, নইলে ৫০০টার মধ্যে
     * একটা পুরোনো ASIN থাকলেই গোটা ব্যাচ বাতিল হতো।
     */
    const created =
      accepted.length === 0
        ? { count: 0 }
        : {
            count: await this.prisma.$executeRaw`
              INSERT INTO design_targets (asin, added_by_id, job_number)
              SELECT a, ${actor.userId}, nextval('design_job_number_seq')
              FROM unnest(${accepted.map((t) => t.asin)}::text[]) AS a
              ON CONFLICT (asin) DO NOTHING
            `,
          };

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
      // ⚠️ ছাঁটাটা এখানে, `parseBulk()`-এ নয় — ওই ফাংশনের কাজ সত্যি বলা,
      //    পর্দার সুবিধা দেখা নয়। ছাদটা সীমান্তে বসে (audit-এও পুরো সংখ্যাই যায়)।
      rejected: rejected.slice(0, REJECTED_SHOWN),
      rejectedTotal: rejected.length,
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
            -- ⚠️⚠️ COALESCE — পুল থেকে **ফিরে আসা** টার্গেটের নম্বর
            --    ইতিমধ্যেই আছে, আর নম্বরটা ASIN-এর, বরাদ্দের নয়।
            --    আবার বসালে সিরিয়াল অকারণে ফুরাত, আর পুরোনো ফাইলের
            --    নাম কোনোদিন কিছুর সাথে মিলত না।
            job_number = COALESCE(job_number, nextval('design_job_number_seq'))
        WHERE id = ${row.id} AND status = 'pool'
      `;
      count += done;
    }

    return count;
  }

  /**
   * ⭐⭐ **দিন শেষে না-করা টার্গেট পুলে ফেরত** *(মালিকের নিয়ম, ২২ আগস্ট:
   * "din sheshe baki design gula amar main list e back asbe")*।
   *
   * কাউকে ৩০টা দেওয়া হলো, তিনি ১৫টা করলেন — বাকি ১৫টা পুলে ফিরে যায়,
   * আর ভবিষ্যতে আবার বিলি হয়। ⭐ এতে কোনো টার্গেট কারো হাতে **আটকে
   * থাকে না**; পুল সবসময় সত্যিকারের বাকি কাজটাই দেখায়।
   *
   * ⚠️⚠️ **যেটা আজ ছোঁয়া হয়েছে সেটা ফেরত যায় না — আর এটাই এখানকার
   * সবচেয়ে জরুরি শর্ত।** কেউ একটা ডিজাইন খুলে কাজ শুরু করেছেন কিন্তু
   * আজ শেষ করতে পারেননি — সরল নিয়মে ওটাও ফিরে যেত, আর কাল অন্য কারো
   * হাতে পড়ত। দুজনের শ্রম নষ্ট, আর কেউ বুঝতই না কেন।
   * ⭐ "ছোঁয়া" মানে ফাইলটা খোলা হয়েছে, অর্থাৎ নম্বরটা আজকের
   * `design_credits`-এ আছে — একই সংকেত যা দিয়ে "শেষ হয়েছে" ধরা হয়।
   *
   * ⚠️ **কাজের নম্বর মুছে ফেলা হয় না।** নম্বরটা ASIN-এর, বরাদ্দের নয় —
   * একবার বসলে চিরকাল ওটাই। মুছে দিলে (ক) সিরিয়াল অকারণে ফুরাত,
   * (খ) পুরোনো ফাইলের নাম কোনোদিন কিছুর সাথে মিলত না।
   *
   * ⚠️ কখনো throw করে না।
   */
  async returnUnworked(workDate: Date): Promise<{ returned: number }> {
    try {
      /**
       * ⚠️ আজ যে নম্বরগুলো কারো ফাইলে দেখা গেছে — কর্মী ধরে।
       * ⭐ `design_credits.design_id` টেক্সট, আর `job_number` সংখ্যা;
       * মেলানোটা তাই টেক্সটেই করা হয় (নম্বরের রূপ এক, `1000042`)।
       */
      const touched = await this.prisma.designCredit.findMany({
        where: { firstWorkDate: workDate },
        select: { employeeId: true, designId: true },
      });

      const keep = new Set(touched.map((t) => `${t.employeeId}:${t.designId}`));

      const open = await this.prisma.designTarget.findMany({
        where: { status: DesignTargetStatus.assigned },
        select: { id: true, assignedToId: true, jobNumber: true, startedAt: true },
      });

      const ids = open
        // ⚠️⚠️ **শুরু হওয়া টার্গেট ফেরত যায় না** — `startedAt` বসা মানে
        //    ফাইলটা কোনো একদিন খোলা হয়েছে, অর্থাৎ কাজ চলছে। আজকের
        //    ক্রেডিট দেখাটা তার চেয়ে সংকীর্ণ ছিল: তিন দিন ধরে চলা কাজ
        //    যেদিন কেউ ফাইলটা খোলেনি, সেদিনই ফেরত চলে যেত।
        .filter((t) => t.startedAt === null)
        .filter((t) => !keep.has(`${t.assignedToId}:${t.jobNumber}`))
        .map((t) => t.id);
      if (ids.length === 0) return { returned: 0 };

      const { count } = await this.prisma.designTarget.updateMany({
        // ⚠️ `status` শর্তটা এখানেও — এই ফাঁকে কেউ শেষ করে ফেললে তাঁর
        //    কাজটা যেন পুলে ফেরত না যায়
        where: { id: { in: ids }, status: DesignTargetStatus.assigned },
        data: { status: DesignTargetStatus.pool, assignedToId: null, assignedAt: null },
      });

      if (count > 0) this.logger.log(`Design targets returned to the pool · ${count}`);

      return { returned: count };
    } catch (err) {
      this.logger.error(
        `Could not return targets: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { returned: 0 };
    }
  }

  /** ⭐ ডিজাইনারের নিজের তালিকা — যেগুলো এখনো হাতে আছে */
  async mine(employeeId: number): Promise<MyTarget[]> {
    const rows = await this.prisma.designTarget.findMany({
      where: { assignedToId: employeeId, status: DesignTargetStatus.assigned },
      select: {
        id: true,
        asin: true,
        jobNumber: true,
        assignedAt: true,
        startedAt: true,
      },
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
      startedAt: r.startedAt?.toISOString() ?? null,
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
  async markDone(
    employeeId: number,
    id: number,
    userId: number,
  ): Promise<{ ok: boolean }> {
    const { count } = await this.prisma.designTarget.updateMany({
      where: { id, assignedToId: employeeId, status: DesignTargetStatus.assigned },
      data: {
        status: DesignTargetStatus.done,
        completedAt: new Date(),
        completedVia: 'manual',
        // ⭐ কে চেপেছেন — `completedVia` কেবল "কীভাবে" বলে (২৩ আগস্ট)
        completedById: userId,
      },
    });

    return { ok: count > 0 };
  }

  /**
   * ⭐⭐ **ফাইলের নাম থেকে "কাজ শুরু হয়েছে" ধরা।**
   *
   * ⚠️⚠️ **আগে এটাকেই "শেষ" ধরা হতো, আর সেটা ভুল ছিল** *(সারানো ২৩
   * আগস্ট, মালিকের প্রশ্নে)*। এজেন্ট শিরোনাম থেকে নম্বরটা তখনই দেখে যখন
   * ফাইলটা **সামনে আসে** — অর্থাৎ কাজ শুরুর মুহূর্তে। ওটাকে "শেষ" ধরায়
   * টার্গেট **খোলামাত্র বন্ধ** হয়ে যেত, আর ডিজাইনার পরদিন সেটা তালিকায়
   * খুঁজে পেতেন না।
   *
   * ⭐ সিস্টেম এখন যা **সত্যিই জানে** সেটুকুই বলে: কাজ শুরু হয়েছে।
   * শেষ হওয়া বলেন ডিজাইনার নিজে (`markDone`)।
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
  async markStartedByJobNumbers(
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
          // ⚠️ যেটায় আগেই চিহ্ন বসেছে সেটা আবার ছোঁয়া হয় না — নইলে
          //    "কবে শুরু" রোজ আজকের তারিখে সরে যেত
          startedAt: null,
        },
        data: { startedAt: now },
      });

      return count;
    } catch (err) {
      this.logger.warn(
        `Could not mark targets started: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  /**
   * ⭐⭐ **পুরো তালিকা** *(২৩ আগস্ট, মালিকের চাওয়া)* — ছাঁকনি ও পাতা ভাগসহ।
   *
   * ⚠️⚠️ **পাতা ভাগ বাধ্যতামূলক, ঐচ্ছিক নয়:** টেবিলে **৩৯ হাজারের বেশি**
   * সারি। সব একসাথে পাঠালে উত্তরটা কয়েক MB হতো, আর ব্রাউজার ওই টেবিল
   * আঁকতে গিয়ে জমে যেত।
   *
   * ⭐ `q` দিয়ে **URL বা ASIN** দুটোই খোঁজা যায় — গবেষক একটা লিঙ্ক
   * পেস্ট করে দেখে নিতে পারেন এটা আগে হয়ে গেছে কি না, আর কে করেছিল।
   * ⚠️ URL থেকে ASIN বের করতে `asinOf()`-ই ব্যবহার হয়, আলাদা কোনো
   * পার্সিং নয় — নইলে খোঁজা আর জমা দেওয়া দু-রকম বুঝত।
   */
  async list(query: {
    status?: DesignTargetStatus;
    q?: string;
    page?: number;
    /** ⭐ কোন ডিজাইনারের — `employees.id` */
    staffId?: number;
    /** ⭐ 'YYYY-MM-DD' — শেষ কাজের তারিখ এই দিন থেকে */
    from?: string;
    /** ⭐ 'YYYY-MM-DD' — এই দিন পর্যন্ত (দিনটাসহ) */
    to?: string;
    /** ⭐ শেকলের কোন ধাপে আটকে — গবেষকের কিউ (২৪ আগস্ট) */
    stage?: 'to_check' | 'to_fix' | 'to_upload' | 'to_live';
  }): Promise<{ rows: TargetRow[]; total: number; page: number; pages: number }> {
    const page = Math.max(1, query.page ?? 1);

    let asin: string | undefined;
    if (query.q && query.q.trim().length > 0) {
      const parsed = asinOf(query.q.trim());
      // ⚠️ URL না হলে যা লেখা আছে সেটাই ASIN ধরে খোঁজা — লোকে
      //    আংশিক আইডিও লেখে
      asin = 'asin' in parsed ? parsed.asin : query.q.trim().toUpperCase();
    }

    /**
     * ⭐⭐ **তারিখটা `lastActivityAt` ধরে** *(২৩ আগস্ট ২০২৬)* — অর্থাৎ
     * "শেষ যা ঘটেছে"।
     *
     * ⚠️⚠️ অবস্থাভেদে আলাদা ঘর ধরা হয়নি (done হলে completedAt, assigned
     * হলে assignedAt) — সেটা করলে "কোন তারিখ ছাঁকা হচ্ছে" প্রশ্নটা
     * প্রতিবার বদলাত, আর ক্রম ও ছাঁকনি দুটো আলাদা ভিত্তিতে দাঁড়াত।
     *
     * ⭐ এক ভিত্তি রাখায় ফলটা স্বাভাবিকভাবেই ঠিক হয়: `done` বাছলে ওই
     * সারির `lastActivityAt` মানেই `completedAt`, কারণ সেটাই সবচেয়ে পরের।
     *
     * ⚠️ `to`-তে দিনটা **অন্তর্ভুক্ত** — মানুষ "২৩ তারিখ পর্যন্ত" বললে
     * ২৩ তারিখটাও বোঝায়। তাই পরের দিনের শুরু পর্যন্ত (`lt`) দেখা হয়।
     */

    const activity =
      query.from || query.to
        ? {
            ...(query.from ? { gte: dhakaStart(query.from) } : {}),
            ...(query.to ? { lt: nextDay(query.to) } : {}),
          }
        : undefined;

    /**
     * ⭐⭐ **গবেষকের দুটো কিউ** *(২৪ আগস্ট ২০২৬)* — শেকলের ঠিক কোন ধাপে
     * সারিটা আটকে আছে।
     *
     * ⚠️ `to_upload`-এ **কাটা-তারিখ** আছে, `to_live`-এ নেই — কারণটা
     *    [targets.rules.ts](./targets.rules.ts)-এর `UPLOAD_QUEUE_FROM`-এ:
     *    পুরোনো ২৭ হাজার ইমপোর্ট-করা সারি বাদ না দিলে কিউটা পাহাড় হতো।
     *    `to_live`-এ ওই সমস্যা নেই, কারণ Uploaded চাপা সারিই মাত্র একটা।
     */
    const stage =
      query.stage === 'to_check'
        ? {
            completedAt: { not: null, gte: dhakaStart(UPLOAD_QUEUE_FROM) },
            checkedAt: null,
          }
        : query.stage === 'to_fix'
          ? { errorFoundAt: { not: null }, fixedAt: null }
          : query.stage === 'to_upload'
            ? {
                completedAt: { not: null, gte: dhakaStart(UPLOAD_QUEUE_FROM) },
                uploadedAt: null,
                /**
                 * ⚠️⚠️ **যেগুলোয় ভুল পাওয়া গেছে অথচ ঠিক হয়নি — বাদ**
                 * *(মালিকের সিদ্ধান্ত, ২৫ আগস্ট)*। জানা-ভাঙা ডিজাইন
                 * Amazon-এ যাবে না।
                 *
                 * ⭐ কিন্তু **এখনো দেখা হয়নি** এমন সারি আটকায় না — আটকালে
                 * আজকের ১৩২টা কিউ রাতারাতি ০ হয়ে যেত, আর কেউ শুরুই করত না।
                 */
                NOT: { errorFoundAt: { not: null }, fixedAt: null },
              }
            : query.stage === 'to_live'
              ? { uploadedAt: { not: null }, liveAt: null }
              : {};

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(asin ? { asin: { contains: asin } } : {}),
      ...(query.staffId ? { assignedToId: query.staffId } : {}),
      ...(activity ? { lastActivityAt: activity } : {}),
      ...stage,
    };

    const [total, rows] = await Promise.all([
      this.prisma.designTarget.count({ where }),
      this.prisma.designTarget.findMany({
        where,
        select: {
          id: true,
          asin: true,
          status: true,
          jobNumber: true,
          assignedAt: true,
          startedAt: true,
          completedAt: true,
          completedVia: true,
          checkedAt: true,
          errorFoundAt: true,
          fixedAt: true,
          uploadedAt: true,
          liveAt: true,
          liveAsin: true,
          sourceNote: true,
          assignedTo: { select: { empCode: true, fullName: true } },
          // ⭐ কে "শেষ" বলেছেন — বরাদ্দ পাওয়া মানুষ আর শেষ করা মানুষ
          //    এক না-ও হতে পারে (মালিক নিজেও চাপতে পারেন)
          completedBy: { select: { fullName: true, role: true } },
        },
        /**
         * ⭐⭐ **শেষ যা ঘটেছে, সেটাই আগে** *(২৩ আগস্ট ২০২৬)*।
         *
         * ⚠️⚠️ আগে ছিল `id desc` — অর্থাৎ **কবে যোগ হয়েছে**, কবে কাজ
         * হয়েছে নয়। ৩১,৩১১টা `done` সারির মাঝে দশ মিনিট আগে করা একটা
         * ভুল যেকোনো জায়গায় থাকত, আর খুঁজে পাওয়া যেত না।
         *
         * ⚠️ `id` দ্বিতীয় ধাপ হিসেবে রাখা — একই মুহূর্তে জমা হওয়া
         * সারিগুলোর ক্রম যাতে প্রতিবার এক থাকে (নইলে পাতা বদলালে
         * একই সারি দুবার বা শূন্যবার দেখা যেত)।
         */
        orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * TARGET_PAGE_SIZE,
        take: TARGET_PAGE_SIZE,
      }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        asin: r.asin,
        url: amazonUrl(r.asin),
        status: r.status,
        jobNumber: r.jobNumber,
        assignedTo: r.assignedTo,
        assignedAt: r.assignedAt?.toISOString() ?? null,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        completedVia: r.completedVia,
        completedBy: r.completedBy,
        checkedAt: r.checkedAt?.toISOString() ?? null,
        errorFoundAt: r.errorFoundAt?.toISOString() ?? null,
        fixedAt: r.fixedAt?.toISOString() ?? null,
        uploadedAt: r.uploadedAt?.toISOString() ?? null,
        liveAt: r.liveAt?.toISOString() ?? null,
        liveAsin: r.liveAsin,
        sourceNote: r.sourceNote,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / TARGET_PAGE_SIZE)),
    };
  }

  /**
   * ⭐⭐ **তালিকা সম্পাদনা** *(২৩ আগস্ট, মালিকের চাওয়া)* — owner ·
   * manager · গবেষক।
   *
   * ⚠️⚠️ **ASIN বদলানো যায় না, আর সেটা ইচ্ছাকৃত।** ওটা সারিটার
   * **পরিচয়** — বদলালে ডুপ্লিকেট-প্রহরীর গোটা ভিত্তিটাই নড়ে যেত, আর
   * ইতিহাসে "এই পণ্যটা হয়েছিল" কথাটা মিথ্যা হয়ে যেত। ভুল ASIN হলে
   * সারিটা মুছে নতুন করে জমা দিন।
   *
   * ⭐ যা বদলানো যায়: **অবস্থা**। পুলে ফেরত পাঠানো (কারো হাত থেকে
   * তুলে নেওয়া), শেষ বলে চিহ্ন দেওয়া, বা বাদ দেওয়া।
   */
  async update(
    id: number,
    status: DesignTargetStatus,
    now: Date,
    userId: number,
  ): Promise<{ ok: boolean }> {
    /**
     * ⚠️ পুলে ফেরত পাঠানো মানে **মালিকানাও ছেড়ে দেওয়া** — নইলে সারিটা
     * পুলে থেকেও কারো নামে বাঁধা থাকত, আর পরের বণ্টনে দুজনের হাতে
     * পড়ার পথ খুলে যেত।
     * ⚠️ কাজের নম্বর মুছি না — ওটা ASIN-এর, বরাদ্দের নয়।
     */
    const data =
      status === DesignTargetStatus.pool
        ? {
            status,
            assignedToId: null,
            assignedAt: null,
            startedAt: null,
            completedAt: null,
            completedVia: null,
            // ⚠️ এটাও মুছতে হয় — নইলে পুলে ফেরত যাওয়া সারিতে "কে শেষ
            //    করেছিল" লেখা থেকে যেত, অথচ কাজটা আর শেষ নয়
            completedById: null,
          }
        : status === DesignTargetStatus.done
          ? { status, completedAt: now, completedVia: 'manual', completedById: userId }
          : { status };

    const { count } = await this.prisma.designTarget.updateMany({
      where: { id },
      data,
    });

    return { ok: count > 0 };
  }

  /**
   * ⚠️⚠️ **মুছে ফেলা — আর এর একটা নীরব দাম আছে।**
   *
   * শেষ হয়ে যাওয়া একটা সারি মুছলে **ডুপ্লিকেট-প্রহরী ওটা ভুলে যায়**,
   * আর কাল কেউ ওই ASIN আবার জমা দিলে সেটা নতুন কাজ হিসেবে ঢুকে পড়বে।
   * ⭐ তাই পর্দায় কথাটা লেখা আছে; সাধারণত "বাদ দেওয়া" (skipped) বেশি
   * নিরাপদ — ওটা তালিকায় থাকে, কিন্তু কারো কাজ নয়।
   */
  async remove(id: number): Promise<{ ok: boolean }> {
    const { count } = await this.prisma.designTarget.deleteMany({ where: { id } });

    return { ok: count > 0 };
  }

  /** পুলের অবস্থা — ইনবক্সের পর্দায় */
  /**
   * ⭐ **ছাঁকনির ড্রপডাউনের জন্য ডিজাইনারের তালিকা** *(২৩ আগস্ট ২০২৬)*।
   *
   * ⚠️⚠️ সাধারণ স্টাফ-তালিকার রুট ব্যবহার করা যেত না — ওটা owner/manager
   * only, অথচ এই পাতা **গবেষকও** দেখেন। তাই আলাদা, আর এখানে কেবল
   * নাম-কোড যায়; বেতন বা ফোন নম্বরের মতো কিছু নয়।
   *
   * ⚠️ ছেড়ে যাওয়া কর্মীও থাকেন — তাঁদের নামেই পুরোনো টার্গেট বাঁধা,
   *    আর ছাঁকনি থেকে বাদ দিলে ওই সারিগুলো কোনোদিন খুঁজে পাওয়া যেত না।
   */
  async designers(): Promise<{ id: number; empCode: string; fullName: string }[]> {
    return this.prisma.employee.findMany({
      where: { designTargets: { some: {} } },
      select: { id: true, empCode: true, fullName: true },
      orderBy: { empCode: 'asc' },
    });
  }

  async stats(): Promise<
    Record<DesignTargetStatus, number> & {
      perDesigner: number;
      uploaded: number;
      live: number;
      /** ⭐ বানান দেখা বাকি (ADR-038) */
      toCheck: number;
      /** ⭐ ভুল পাওয়া গেছে, ঠিক করা হয়নি */
      toFix: number;
      /** ⭐ গবেষকের কিউ — শেষ হয়েছে অথচ আপলোড হয়নি (কাটা-তারিখের পরের) */
      toUpload: number;
      /** ⭐ আপলোড হয়েছে অথচ লাইভ হয়নি */
      toLive: number;
    }
  > {
    /**
     * ⭐⭐ **আপলোড ও লাইভ আলাদা করে গোনা** *(২৩ আগস্ট ২০২৬)*।
     *
     * ⚠️ `status` দিয়ে গোনা যায় না — ওগুলো তারিখ, অবস্থা নয় (ইচ্ছাকৃত,
     * schema-র নোট দেখুন)। একটা কাজ একই সাথে `done` **আর** আপলোড **আর**
     * লাইভ হতে পারে, আর সেটাই ঠিক।
     */
    const [rows, uploaded, live, toCheck, toFix, toUpload, toLive] = await Promise.all([
      this.prisma.designTarget.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.designTarget.count({ where: { uploadedAt: { not: null } } }),
      this.prisma.designTarget.count({ where: { liveAt: { not: null } } }),
      /**
       * ⚠️⚠️ এই দুটো সংখ্যা **`list()`-এর ছাঁকনির হুবহু যমজ** হতে হবে —
       * চিপে ১৩২ লিখে ক্লিক করলে ৯০টা এলে কেউ আর সংখ্যাটা বিশ্বাস করবে না।
       * ⭐ কাটা-তারিখটা এক জায়গায় (`UPLOAD_QUEUE_FROM`), তাই দুটো একসাথেই নড়ে।
       */
      this.prisma.designTarget.count({
        where: {
          completedAt: { not: null, gte: dhakaStart(UPLOAD_QUEUE_FROM) },
          checkedAt: null,
        },
      }),
      this.prisma.designTarget.count({
        where: { errorFoundAt: { not: null }, fixedAt: null },
      }),
      this.prisma.designTarget.count({
        where: {
          completedAt: { not: null, gte: dhakaStart(UPLOAD_QUEUE_FROM) },
          uploadedAt: null,
          // ⚠️ ভুল পাওয়া অথচ ঠিক-না-হওয়া সারি বাদ — `list()`-এর যমজ
          NOT: { errorFoundAt: { not: null }, fixedAt: null },
        },
      }),
      this.prisma.designTarget.count({
        where: { uploadedAt: { not: null }, liveAt: null },
      }),
    ]);

    const out = {
      pool: 0,
      assigned: 0,
      done: 0,
      skipped: 0,
      perDesigner: POOL_PER_DESIGNER,
      uploaded,
      live,
      toCheck,
      toFix,
      toUpload,
      toLive,
    };
    for (const r of rows) out[r.status] = r._count._all;

    return out;
  }

  /**
   * ⭐ **"আপলোড হয়েছে"** — owner · manager · গবেষক *(২৩ আগস্ট ২০২৬)*।
   *
   * ⚠️ শেষ হওয়ার আগে আপলোড হতে পারে না, তাই `completedAt` না থাকলে
   *    আটকানো হয় — নইলে পাইপলাইনের ক্রমটাই অর্থহীন হতো।
   */
  /**
   * ⭐⭐ **"বানান দেখলাম"** *(ADR-038, ২৫ আগস্ট ২০২৬)* — সুমাইয়ার দুটো
   * বোতামের পেছনের একটাই মেথড।
   *
   * ⚠️⚠️ **যন্ত্র বানান পড়ে না** — লেখাটা `.ai`/`.psd`-র ভেতরে, আর
   * নীতিমালায় প্রতিশ্রুতি দেওয়া আছে ফাইল খোলা হয় না। ⭐ যন্ত্র শুধু
   * **হিসাব রাখে**: কোনগুলো দেখা বাকি, কে দেখলেন, কী পেলেন। মাঠে আসল
   * সমস্যাটাও এটাই — ভুল খোঁজা নয়, *কোনগুলো দেখতে হবে* সেটা জানা।
   *
   * ⚠️ `ok: false` মানে ভুল পাওয়া গেছে — তখন `errorFoundAt`ও বসে, আর
   *    সারিটা "ঠিক করতে হবে" কিউতে চলে যায়।
   *
   * ⚠️ **idempotent** — আবার চাপলে তারিখ সরে না। নইলে একই সারিতে দুবার
   *    চাপলে "কবে দেখা হয়েছিল" আজকের তারিখে লাফ দিত।
   */
  async markChecked(
    id: number,
    ok: boolean,
    userId: number,
    now: Date,
  ): Promise<{ ok: true }> {
    const target = await this.prisma.designTarget.findUnique({
      where: { id },
      select: { completedAt: true, checkedAt: true },
    });
    if (!target) throw new NotFoundException('No design target with this id');
    if (target.completedAt === null) {
      throw new BadRequestException(
        'This design is not finished yet, so there is nothing to check.',
      );
    }
    if (target.checkedAt !== null) return { ok: true };

    await this.prisma.designTarget.update({
      where: { id },
      data: {
        checkedAt: now,
        checkedById: userId,
        errorFoundAt: ok ? null : now,
      },
    });
    return { ok: true };
  }

  /**
   * ⭐⭐ **"ঠিক করেছি"** — বেলালের বোতাম।
   *
   * ⚠️⚠️ `assignedToId` **ছোঁয়া হয় না**। ডিজাইনটা মূল ডিজাইনারেরই থাকে,
   * আর সেটা এই মেথডের সবচেয়ে জরুরি লাইন — নইলে যিনি ঠিক করলেন তাঁর নামে
   * কাজটা চলে যেত, আর ২৩ আগস্টের গোটা তদন্তটা শুরুই হয়েছিল ঠিক এমন
   * একটা ফুলে যাওয়া সংখ্যা দেখে ("বেলাল ১৬টা ডিজাইন করেছে?")।
   */
  async markFixed(id: number, userId: number, now: Date): Promise<{ ok: true }> {
    const target = await this.prisma.designTarget.findUnique({
      where: { id },
      select: { errorFoundAt: true, fixedAt: true },
    });
    if (!target) throw new NotFoundException('No design target with this id');
    if (target.errorFoundAt === null) {
      throw new BadRequestException(
        'No spelling error was recorded for this design, so there is nothing to fix.',
      );
    }
    if (target.fixedAt !== null) return { ok: true };

    await this.prisma.designTarget.update({
      where: { id },
      data: { fixedAt: now, fixedById: userId },
    });
    return { ok: true };
  }

  async markUploaded(id: number, now: Date): Promise<{ ok: true }> {
    const target = await this.prisma.designTarget.findUnique({
      where: { id },
      select: { completedAt: true, uploadedAt: true },
    });
    if (!target) throw new NotFoundException('No design target with this id');
    if (target.completedAt === null) {
      throw new BadRequestException(
        'This design is not finished yet, so it cannot be marked uploaded.',
      );
    }
    // ⚠️ আগে চিহ্ন বসে থাকলে তারিখটা সরানো হয় না — "কবে আপলোড হলো"
    //    প্রতিবার আজকের তারিখে লাফ দিত
    if (target.uploadedAt !== null) return { ok: true };

    await this.prisma.designTarget.update({
      where: { id },
      data: { uploadedAt: now },
    });
    return { ok: true };
  }

  /**
   * ⭐⭐ **"Amazon-এ লাইভ হয়েছে"** — সাথে নতুন পণ্যের ASIN।
   *
   * ⚠️⚠️ ASIN-টা **আমাদের নিজের** পণ্যের, গবেষকের আনা নমুনার নয়। এটাই
   * ভবিষ্যতে বিক্রির হিসাবের সাথে জোড়া লাগার সেতু।
   *
   * ⚠️ আপলোড না হয়ে লাইভ হতে পারে না — Amazon-এ কিছু ওঠাতে হলে আগে
   *    পাঠাতেই হয়।
   */
  async markLive(id: number, liveAsin: string | null, now: Date): Promise<{ ok: true }> {
    const target = await this.prisma.designTarget.findUnique({
      where: { id },
      select: { uploadedAt: true, liveAt: true },
    });
    if (!target) throw new NotFoundException('No design target with this id');
    if (target.uploadedAt === null) {
      throw new BadRequestException(
        'This design has not been uploaded yet, so it cannot be live.',
      );
    }
    if (target.liveAt !== null) return { ok: true };

    await this.prisma.designTarget.update({
      where: { id },
      data: { liveAt: now, liveAsin },
    });
    return { ok: true };
  }
}
