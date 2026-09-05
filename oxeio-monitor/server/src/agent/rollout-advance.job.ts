import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  JOB_TIMEZONE,
  RunLock,
  SCHEDULING_ENABLED,
} from '../summary/scheduling';
import {
  ROLLOUT_FRESH_MINUTES,
  ROLLOUT_SOAK_HOURS,
  stageToAdvanceTo,
  type DeviceProof,
} from './rollout';

export interface RolloutAdvanceResult {
  version: string | null;
  from: string | null;
  to: string | null;
  /** কতগুলো ডিভাইস এই ভার্সনটা চালাচ্ছে (প্রমাণ দিক বা না দিক) */
  onVersion: number;
  skipped: boolean;
}

/**
 * ⭐⭐⭐ **H04 — রোলআউট নিজে থেকে এগোয়** *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * মালিক: *"update gula office staff ra pacche na. every single pc te
 * manually install korte hocche."*
 *
 * ⚠️⚠️ **কারণটা একটা বাগ ছিল না, একটা অনুপস্থিত ধাপ।** ধাপে-ধাপে রোলআউটের
 * গোটা যন্ত্রটা তৈরি ছিল — বালতি, শতাংশ, পাইলট, জরুরি ব্রেক — কিন্তু
 * `canary → partial → all` বদলানোর একমাত্র পথ ছিল Settings-এ **হাতে ক্লিক**।
 * কেউ না চাপলে নতুন ভার্সন চিরকাল ৭%-এ বসে থাকত, অর্থাৎ ১২টার মধ্যে ১১টা
 * PC-কে কোনোদিন অফারই যেত না — আর তখন প্রতিটা মেশিনে হাতে গিয়ে বসানো ছাড়া
 * সত্যিই কোনো উপায় থাকত না।
 *
 * ⭐ এই প্রকল্পের সবচেয়ে চেনা ছাঁদ, আবার: **চুক্তি লেখা আছে, কলার লেখা হয়নি।**
 *
 * ⚠️⚠️ **এই জব G58-এর নিরাপত্তাটা কেড়ে নেয় না।** ধাপ বাড়ে কেবল তখনই যখন
 * একটা **আসল মেশিন** নতুন বিল্ডটা ছ-ঘণ্টা ধরে চালিয়ে **এখনো সাড়া দিচ্ছে**।
 * অর্থাৎ canary-র মানেটা অক্ষত — শুধু তার ফলটা আর কারো ক্লিকের অপেক্ষায়
 * বসে থাকে না।
 *
 * ⚠️ `halted` কখনো খোলে না — জরুরি ব্রেক স্বয়ংক্রিয় কিছুর হাতে ছাড়া যায় না
 * (`nextStage()`-এর নোট)।
 */
@Injectable()
export class RolloutAdvanceJob {
  private readonly logger = new Logger(RolloutAdvanceJob.name);
  private readonly lock = new RunLock();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * ⚠️ ঘণ্টায় একবার, ৭ মিনিটে — গোল সময়ে নয়। ⭐ অন্য জবগুলো (`:00`, `:15`)
   *    গোল সময়ে চলে; একই মুহূর্তে চাপ না বাড়ানোই ভালো, আর লগ পড়ার সময়
   *    কোনটা কার তা-ও আলাদা করা যায়।
   *
   * ⚠️ ঘণ্টায় একবারই যথেষ্ট: soak ছ-ঘণ্টার, তাই ঘন ঘন দেখার কিছু নেই।
   *    ফলে সবচেয়ে খারাপ ক্ষেত্রেও ধাপ বাড়তে ছ-ঘণ্টা এক মিনিট লাগে।
   */
  @Cron('0 7 * * * *', {
    name: 'rollout-advance',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    // ⚠️ দ্বিতীয় তালা — কারণ ব্যাখ্যা `summary-refresh.job.ts`-এ
    if (!SCHEDULING_ENABLED) return;
    await this.runOnce();
  }

  async runOnce(now: Date = new Date()): Promise<RolloutAdvanceResult> {
    const idle: RolloutAdvanceResult = {
      version: null,
      from: null,
      to: null,
      onVersion: 0,
      skipped: false,
    };

    const result = await this.lock.run(async () => {
      /**
       * ⭐⭐ **ঠিক সেই ভার্সনটা যেটা `UpdateService.offerFor()` দেয়** — সবচেয়ে
       * নতুন non-halted। ⚠️ পুরোনো কোনো ভার্সনের ধাপ বাড়ানোর কোনো অর্থ নেই:
       * কেউ সেটা অফারই পায় না, তাই বদলটা হতো নীরব আর বিভ্রান্তিকর।
       */
      const latest = await this.prisma.agentVersion.findFirst({
        where: { rolloutStage: { not: 'halted' } },
        orderBy: { releasedAt: 'desc' },
      });

      if (latest === null) return idle;

      /**
       * ⚠️ ডিভাইসগুলো **status ধরে ছাঁকা** — বাতিল করা PC-র heartbeat
       *    কোনো প্রমাণ নয়। ⚠️ `agentVersion` মেলানো হয় হুবহু: যে মেশিন
       *    এখনো পুরোনো বিল্ডে আছে সে এই বিল্ড সম্পর্কে কিছুই বলে না।
       */
      const devices = await this.prisma.device.findMany({
        where: { status: 'active', agentVersion: latest.version },
        select: { agentVersionSince: true, lastSeenAt: true },
      });

      const proofs: DeviceProof[] = devices.map((d) => ({
        versionSince: d.agentVersionSince,
        lastSeenAt: d.lastSeenAt,
      }));

      // ⭐ সিদ্ধান্তটা এখানে নেওয়া হয় না — `rollout.ts`-এর খাঁটি ফাংশনে
      const to = stageToAdvanceTo(latest.rolloutStage, proofs, now);

      if (to === null) {
        return { ...idle, version: latest.version, onVersion: devices.length };
      }

      const updated = await this.prisma.agentVersion.update({
        where: { version: latest.version },
        data: { rolloutStage: to },
      });

      /**
       * ⭐⭐ **অডিটে লেখা হয়, আর সেটা ঐচ্ছিক নয়।** ধাপ বদলানো এতদিন
       * সবসময় একজন মানুষের কাজ ছিল, তাই খাতায় নাম থাকত। এখন যন্ত্র করলে
       * খাতাটা ফাঁকা যেত — আর কেউ দেখত "কাল ৭% ছিল, আজ ১০০%", কে বা কী
       * করল তার কোনো উত্তর নেই।
       *
       * ⚠️ কেন এগোনো হলো সেটাও লেখা থাকে (`onVersion`), নইলে পরে
       *    জিজ্ঞেস করলে উত্তর দেওয়ার মতো কিছু থাকত না।
       */
      await this.audit.record({
        // ⚠️ `null` — কোনো মানুষ চাপেননি, আর সেটা লুকানোর কিছু নেই
        userId: null,
        action: 'agent_version.rollout_auto',
        targetType: 'agent_version',
        targetId: latest.version,
        meta: {
          from: latest.rolloutStage,
          to: updated.rolloutStage,
          onVersion: devices.length,
          soakHours: ROLLOUT_SOAK_HOURS,
          freshMinutes: ROLLOUT_FRESH_MINUTES,
        },
      });

      this.logger.log(
        `agent ${latest.version} rollout ${latest.rolloutStage} → ${updated.rolloutStage} ` +
          `· ${devices.length} device(s) on this build`,
      );

      return {
        version: latest.version,
        from: latest.rolloutStage,
        to: updated.rolloutStage,
        onVersion: devices.length,
        skipped: false,
      };
    });

    if (result === null) {
      this.logger.warn('Previous rollout check still going — skipping this tick');
      return { ...idle, skipped: true };
    }

    return result;
  }
}
