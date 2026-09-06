import { randomUUID } from 'node:crypto';

import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type { Device, Prisma } from '@prisma/client';

import { AppCategoryService } from '../activity/app-category.service';
import { matchCategory } from '../activity/category-matcher';
import { PrismaService } from '../prisma/prisma.service';
import { ClockDriftService, type Drift } from './clock-drift.service';
import type { AppUsageDto, EventDto, SegmentDto } from './dto';
import { deriveUuid } from './util/derive-uuid';
import { nextLocalMidnight, workDateOf } from './util/dhaka-time';

export interface IngestResult {
  accepted: number;
  duplicates: number;
  /** মধ্যরাত পার হওয়ায় যতগুলো রেকর্ড ভাগ করতে হয়েছে */
  split: number;
}

interface Span {
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
}

/** সেশন বন্ধ হওয়ার যেসব ইভেন্ট */
const SESSION_CLOSING = new Set(['logoff', 'shutdown', 'agent_stop']);

/**
 * Prisma-র foreign key ভাঙার কোড।
 *
 * ⚠️ `instanceof PrismaClientKnownRequestError` ব্যবহার করা হয়নি — ওটার
 * জন্য `@prisma/client` থেকে **রানটাইম** ইমপোর্ট লাগত, আর তাতে জেনারেট
 * করা ক্লায়েন্টের ভার্সনের সাথে শক্ত বাঁধন তৈরি হতো। কোডটা Prisma-র
 * প্রকাশ্য চুক্তির অংশ, তাই সেটাই দেখা হয়।
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2003'
  );
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockDriftService,
    private readonly categories: AppCategoryService,
  ) {}

  /**
   * স্পেক § ৪.১ — `client_uuid` ছাড়া রেকর্ড নেওয়া হয় না, আর স্ট্যাটাস হয় **422**।
   * (ValidationPipe দিলে 400 হতো, তাই যাচাইটা এখানে।)
   */
  private assertClientUuids(items: Array<{ clientUuid?: string }>): void {
    const missing = items.findIndex((i) => !i.clientUuid);
    if (missing >= 0) {
      throw new UnprocessableEntityException(
        `Record ${missing} has no client_uuid — it is required to prevent duplicates`,
      );
    }
  }

  /**
   * § ২.১-ক — কোনো রেকর্ড দুই work_date জুড়ে থাকতে পারবে না।
   * এজেন্টের ভাগ করে পাঠানোর কথা; এটা সার্ভারের রক্ষাকবচ (পুরোনো এজেন্টের জন্য)।
   */
  private splitAtMidnight(span: Span): Span[] {
    if (span.endedAt <= span.startedAt) {
      return [{ ...span, endedAt: span.startedAt, durationSec: 0 }];
    }

    const parts: Span[] = [];
    let cursor = span.startedAt;
    const wallMs = span.endedAt.getTime() - span.startedAt.getTime();

    while (cursor < span.endedAt) {
      const boundary = nextLocalMidnight(cursor);
      const end = boundary < span.endedAt ? boundary : span.endedAt;
      const partMs = end.getTime() - cursor.getTime();

      parts.push({
        startedAt: cursor,
        endedAt: end,
        // অখণ্ড রেকর্ডে এজেন্টের monotonic durationSec-ই রাখা হয় (সবচেয়ে নির্ভুল)।
        // ভাগ হলে সেটা অনুপাত করে ভাগ করে দেওয়া হয়, যাতে যোগফল অটুট থাকে।
        durationSec:
          parts.length === 0 && partMs === wallMs
            ? span.durationSec
            : Math.round((span.durationSec * partMs) / wallMs),
      });

      cursor = end;
    }

    return parts;
  }

  /**
   * সেগমেন্ট কোন `work_session`-এ বসবে।
   *
   * ⚠️ অফলাইন queue রিপ্লে হলে (A05) **পুরোনো ব্যাচ নতুনের পরে** আসতে পারে।
   *    তাই "শেষ খোলা সেশনটাই চলতি সেশন" ধরে নেওয়া যায় না — ধরলে পুরোনো
   *    ডেটা এসে চলতি সেশনকে অতীতের সময়ে বন্ধ করে দেয় (ended_at < started_at)।
   *    সেশন তাই সবসময় **(device, work_date)** ধরে খোঁজা হয়।
   */
  private async resolveSession(
    tx: Prisma.TransactionClient,
    device: Device,
    employeeId: number,
    workDate: Date,
    startedAt: Date,
    endedAt: Date,
  ): Promise<bigint> {
    /**
     * ⚠️⚠️ **`employeeId`-ও শর্তে, আর সেটাই এখানকার সবচেয়ে জরুরি লাইন**
     * *(৬ সেপ্টেম্বর ২০২৬)*।
     *
     * আগে মেলানো হতো কেবল (ডিভাইস, তারিখ) ধরে। ফলে একটা PC দিনের
     * মাঝখানে অন্য কর্মীকে দিলে নতুন কর্মীর সেগমেন্টগুলো **আগের কর্মীর**
     * সেশনে গিয়ে বসত। কোনো এরর নয় — শুধু টাইমলাইনে একজনের কাজ অন্যজনের
     * নামে, আর `trackedFromBy()` (যা `work_sessions` পড়ে) আসল কর্মীর
     * ট্র্যাকিং-শুরু পিছিয়ে দিত।
     *
     * ⚠️ নিচের ৩ নম্বর শাখাটা ইচ্ছাকৃতভাবে কর্মী ধরে ছাঁকে **না** —
     *    আগের দিনের খোলা সেশন বন্ধ করা ডিভাইসের কাজ, কর্মীর নয়।
     */

    // ১· ওই তারিখেরই খোলা সেশন
    const open = await tx.workSession.findFirst({
      where: { deviceId: device.id, employeeId, workDate, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (open) {
      await this.widen(tx, open, startedAt, endedAt);
      return open.id;
    }

    // ২· ওই তারিখের বন্ধ সেশন — backfill হলে সেটাতেই বসবে, নতুন সেশন নয়
    const closed = await tx.workSession.findFirst({
      where: { deviceId: device.id, employeeId, workDate },
      orderBy: { startedAt: 'desc' },
    });
    if (closed) {
      await this.widen(tx, closed, startedAt, endedAt);
      return closed.id;
    }

    // ৩· আগের কোনো তারিখের সেশন খোলা পড়ে আছে? তাকে **তার নিজের** মধ্যরাতে
    //    বন্ধ করা হয় — নতুন সেগমেন্টের সময়ে নয় (§ ২.১-ক)
    const stale = await tx.workSession.findFirst({
      where: { deviceId: device.id, endedAt: null, workDate: { lt: workDate } },
      orderBy: { startedAt: 'desc' },
    });
    if (stale) {
      await tx.workSession.update({
        where: { id: stale.id },
        data: {
          endedAt: nextLocalMidnight(stale.startedAt),
          endReason: 'day_rollover',
        },
      });
    }

    const created = await tx.workSession.create({
      data: { employeeId, deviceId: device.id, workDate, startedAt },
    });
    return created.id;
  }

  /**
   * সেশনের সীমা তার ভেতরের সেগমেন্টগুলোকে ধরে রাখা উচিত।
   * backfill-এ পুরোনো সেগমেন্ট এলে সেশনের শুরু পিছিয়ে দিতে হয়,
   * নইলে টাইমলাইনে সেগমেন্ট সেশনের বাইরে পড়ে যায়।
   */
  private async widen(
    tx: Prisma.TransactionClient,
    session: { id: bigint; startedAt: Date; endedAt: Date | null },
    startedAt: Date,
    endedAt: Date,
  ): Promise<void> {
    const data: Prisma.WorkSessionUpdateInput = {};

    if (startedAt < session.startedAt) data.startedAt = startedAt;
    // খোলা সেশনের শেষ নেই — সেটা logoff বা দিন-ক্লোজেই বসবে
    if (session.endedAt !== null && endedAt > session.endedAt) {
      data.endedAt = endedAt;
    }

    if (Object.keys(data).length > 0) {
      await tx.workSession.update({ where: { id: session.id }, data });
    }
  }

  // ── segments ──────────────────────────────────────────────────────────────

  async ingestSegments(
    device: Device,
    drift: Drift,
    segments: SegmentDto[],
  ): Promise<IngestResult> {
    this.assertClientUuids(segments);
    if (segments.length === 0) return { accepted: 0, duplicates: 0, split: 0 };

    const employeeId = device.employeeId;
    if (employeeId === null) {
      throw new UnprocessableEntityException(
        'This device is not linked to any staff member',
      );
    }

    let split = 0;

    // সেশন তৈরি আর সেগমেন্ট insert — একই ট্রানজেকশনে, নইলে insert ব্যর্থ হলে
    // অনাথ work_session পড়ে থাকত
    const { count, total } = await this.prisma.$transaction(async (tx) => {
      const rows: Prisma.ActivitySegmentCreateManyInput[] = [];
      const sessionByDate = new Map<number, bigint>();

      /**
       * ⭐⭐⭐ **আগে খাম মাপা, তারপর সেশন** *(৬ সেপ্টেম্বর ২০২৬, G164)*।
       *
       * ⚠️⚠️ **যে বাগটা এটা সারায়:** আগে সেশনটা ব্যাচের **প্রথম** খণ্ডের
       * সময় নিয়ে তৈরি/চওড়া হতো, আর বাকি খণ্ডগুলো memo-হিটে সোজা ওই
       * সেশনে বসত — `widen()` তাদের দেখতই না। ফলে সেশনের নিজের সীমা তার
       * ভেতরের সেগমেন্টগুলোকে আর ধরে রাখত না, অথচ `widen()`-এর মন্তব্যেই
       * লেখা আছে ঠিক সেটাই তার কাজ।
       *
       * ⚠️ মাঠে মাপা: ২২৬টা সেশনের **৭টা** ভাঙা — ৫২টা সেগমেন্ট,
       * **২৪.৪৭ ঘণ্টা** নিজের সেশনের বাইরে। সবচেয়ে বড়টা ৬ ঘণ্টা (রাতের
       * লক-সেগমেন্ট), আরেকটায় সেশন শুরু হয়েছে তার নিজের প্রথম
       * সেগমেন্টের **৮ ঘণ্টা ৩৪ মিনিট পরে**।
       *
       * ⚠️ কেন এলোমেলো ক্রমে আসে: এজেন্ট প্রতিটা বন্ধ সেগমেন্ট
       * fire-and-forget কিউয়ে ফেলে (`AgentHost.Record`), তাই একই মুহূর্তে
       * বন্ধ হওয়া ছোট idle সারিটা লম্বা lock সারিটাকে হারিয়ে দিতে পারে।
       *
       * ⭐ **memo সরানো হয়নি** — সরালে ৫০০ সেগমেন্টের ব্যাচে ৫০০ বার
       * `resolveSession` চলত (প্রতিবার ১–৩টা findFirst) একই ট্রানজেকশনের
       * ভেতরে। খরচ আগের মতোই: তারিখপ্রতি একবার।
       */
      type PreparedPart = {
        workDate: Date;
        part: Span;
        clientUuid: string;
        state: SegmentDto['state'];
        inputScore: number | null;
      };

      const prepared: PreparedPart[] = [];
      const bounds = new Map<
        number,
        { workDate: Date; startedAt: Date; endedAt: Date }
      >();

      for (const seg of segments) {
        const corrected: Span = {
          startedAt: this.clock.correct(seg.startedAt, drift),
          endedAt: this.clock.correct(seg.endedAt, drift),
          durationSec: seg.durationSec,
        };

        const parts = this.splitAtMidnight(corrected);
        if (parts.length > 1) split += parts.length - 1;

        for (const [i, part] of parts.entries()) {
          const workDate = workDateOf(part.startedAt);
          const key = workDate.getTime();

          prepared.push({
            workDate,
            part,
            clientUuid: deriveUuid(seg.clientUuid as string, i),
            state: seg.state,
            inputScore: seg.inputScore ?? null,
          });

          const known = bounds.get(key);
          if (known === undefined) {
            bounds.set(key, {
              workDate,
              startedAt: part.startedAt,
              endedAt: part.endedAt,
            });
            continue;
          }

          if (part.startedAt < known.startedAt) known.startedAt = part.startedAt;
          if (part.endedAt > known.endedAt) known.endedAt = part.endedAt;
        }
      }

      /**
       * ⚠️⚠️ **পুরোনো তারিখ আগে** — `resolveSession()`-এর ৩ নম্বর শাখা
       * আগের দিনের খোলা সেশনকে **তার নিজের** মধ্যরাতে বন্ধ করে। উল্টো
       * ক্রমে চললে নতুন দিনের সেশন আগে তৈরি হতো, আর পুরোনো দিনটা তখন
       * ওই শাখার `workDate: { lt: … }` শর্তে আর পড়ত না।
       */
      for (const key of [...bounds.keys()].sort((a, b) => a - b)) {
        const envelope = bounds.get(key)!;

        sessionByDate.set(
          key,
          await this.resolveSession(
            tx,
            device,
            employeeId,
            envelope.workDate,
            envelope.startedAt,
            envelope.endedAt,
          ),
        );
      }

      for (const p of prepared) {
        rows.push({
          sessionId: sessionByDate.get(p.workDate.getTime())!,
          employeeId,
          deviceId: device.id,
          clientUuid: p.clientUuid,
          workDate: p.workDate,
          state: p.state,
          startedAt: p.part.startedAt,
          endedAt: p.part.endedAt,
          durationSec: p.part.durationSec,
          inputScore: p.inputScore,
          // § ২.১ — শুধু ACTIVE গোনা হয়, আর কিছু নয়
          countsAsWork: p.state === 'active',
        });
      }

      const res = await tx.activitySegment.createMany({
        data: rows,
        skipDuplicates: true, // ← client_uuid UNIQUE, তাই রি-আপলোড নিরাপদ
      });

      /**
       * ⭐⭐⭐ **দেরিতে আসা দিনটা আবার গুনতে হবে** *(৬ সেপ্টেম্বর ২০২৬)*।
       *
       * ⚠️⚠️ **যে বাগটা এটা সারায়:** rollup চলত কেবল **দুটো** দিনের উপর —
       * আজ (K06, প্রতি ১৫ মিনিটে) আর গতকাল (K05, ০০:১৫-তে, **একবার**)।
       * এর বাইরের কোনো দিনের সেগমেন্ট পরে এলে সেটা এখানে ঠিকই বসত, কিন্তু
       * `daily_summary`-তে **কোনোদিন উঠত না** — আর সেখান থেকে মাসিক সারি,
       * আর সেখান থেকে বেতনের ঘাটতি।
       *
       * ⚠️ ঘটনাটা বিরল নয়, রোজকার: সন্ধ্যায় PC বন্ধ হলে শেষ সেগমেন্টটা
       * আউটবক্সে থেকে যায়, আর পরদিন সকালে লগইনের পর আপলোড হয় — ততক্ষণে
       * ০০:১৫-র দিন-ক্লোজ পেরিয়ে গেছে। মাঠে মাপা: আগস্ট–সেপ্টেম্বরে
       * **৩৯টা (কর্মী, দিন) জোড়া, ১৭.৭৮ ঘণ্টা** এভাবে হারিয়েছিল।
       *
       * ⭐ **আজকের দিনটা চিহ্নিত হয় না** — K06 এমনিতেই প্রতি ১৫ মিনিটে
       * ওটা গোনে, তাই চিহ্ন বসালে একই কাজ দুবার হতো। গতকাল ও তার আগের
       * সবই চিহ্নিত হয়, কারণ ওদের নির্ধারিত সুযোগ ইতিমধ্যেই পেরিয়ে গেছে।
       *
       * ⚠️ চিহ্নটা **একই ট্রানজেকশনে** বসে। আলাদা করলে সেগমেন্ট লেখা
       * সফল হয়ে চিহ্ন বসানো ব্যর্থ হতে পারত — আর তখন ঘণ্টাগুলো ঠিক
       * আগের মতোই নীরবে হারাত, কেবল আরও দুর্লভভাবে।
       */
      const today = workDateOf(this.clock.correct(new Date(), drift)).getTime();
      const stale = [...sessionByDate.keys()].filter((ms) => ms < today);

      if (stale.length > 0) {
        await tx.summaryDirty.createMany({
          data: stale.map((ms) => ({ workDate: new Date(ms) })),
          // ⚠️ একই দিন বারবার আসতেই পারে — প্রথম চিহ্নের `marked_at`
          //    রেখে দেওয়াই ঠিক, নইলে নিষ্কাশনের ক্রমে ওটা চিরকাল
          //    পিছিয়ে যেত আর পুরোনো দিনটা কখনো নাগাল পেত না
          skipDuplicates: true,
        });
      }

      return { count: res.count, total: rows.length };
    });

    if (split > 0) {
      await this.logSplit(device, employeeId, split);
    }

    return { accepted: count, duplicates: total - count, split };
  }

  private async logSplit(
    device: Device,
    employeeId: number,
    split: number,
  ): Promise<void> {
    this.logger.warn(
      `device ${device.id}: ${split} segment(s) had to be split at midnight on the server — ` +
        'the agent was supposed to split them itself',
    );
    await this.prisma.event.create({
      data: {
        deviceId: device.id,
        employeeId,
        clientUuid: randomUUID(),
        type: 'segment_split',
        occurredAt: new Date(),
        meta: { count: split, by: 'server' },
      },
    });
  }

  // ── app usage ─────────────────────────────────────────────────────────────

  async ingestAppUsage(
    device: Device,
    drift: Drift,
    items: AppUsageDto[],
  ): Promise<IngestResult> {
    this.assertClientUuids(items);
    if (items.length === 0) return { accepted: 0, duplicates: 0, split: 0 };

    const employeeId = device.employeeId;
    if (employeeId === null) {
      throw new UnprocessableEntityException(
        'This device is not linked to any staff member',
      );
    }

    // ⚠️ নিয়মগুলো একবার — প্রতি সারিতে await করলে ৫০০ সারির ব্যাচে
    //    ৫০০ বার ক্যাশ-চেক হতো, আর প্রতিটাই একটা microtask।
    const rules = await this.categories.rules();

    const rows: Prisma.AppUsageCreateManyInput[] = [];
    let split = 0;

    for (const item of items) {
      const parts = this.splitAtMidnight({
        startedAt: this.clock.correct(item.startedAt, drift),
        endedAt: this.clock.correct(item.endedAt, drift),
        durationSec: item.durationSec,
      });
      if (parts.length > 1) split += parts.length - 1;

      for (const [i, part] of parts.entries()) {
        rows.push({
          employeeId,
          deviceId: device.id,
          clientUuid: deriveUuid(item.clientUuid as string, i),
          workDate: workDateOf(part.startedAt),
          startedAt: part.startedAt,
          endedAt: part.endedAt,
          durationSec: part.durationSec,
          processName: item.processName,
          appName: item.appName ?? null,
          windowTitle: item.windowTitle ?? null,
          // ADR-013 — ডোমেইন ছাড়া কিছু জমা হয় না
          domain: item.domain ?? null,
          isBrowser: item.isBrowser ?? false,

          /**
           * ⭐ **R22a** — খণ্ডটা কোন অবস্থায় দেখা হয়েছে।
           *
           * ⚠️ পুরোনো এজেন্ট ঘরটা পাঠায় না, তাই `undefined` হলে কলামের
           *    ডিফল্ট (`active`) বসতে দেওয়া হয় — জোর করে `'active'` লিখলে
           *    "এজেন্ট বলেছে" আর "আমরা ধরে নিয়েছি" এক হয়ে যেত।
           */
          ...(item.state === undefined ? {} : { segmentState: item.state }),

          // D05 — ⚠️ **এখানেই** ক্যাটাগরি বসে, পড়ার সময় নয়। রিপোর্ট
          //    (D07, D08) মাসের লাখখানেক সারির উপর group by করে; প্রতিবার
          //    ১০৯টা নিয়ম মেলালে ওই কোয়েরি ব্যবহারের অযোগ্য হতো।
          //    দাম: নিয়ম বদলালে পুরোনো সারি পুরোনো সিদ্ধান্তেই থাকে —
          //    সেজন্যই `AppCategoryService.recategorize()`।
          categoryId: matchCategory(rules, {
            processName: item.processName,
            domain: item.domain,
            windowTitle: item.windowTitle,
          })?.id ?? null,
        });
      }
    }

    const count = await this.insertAppUsage(rows);

    return { accepted: count, duplicates: rows.length - count, split };
  }

  /**
   * ⚠️ ক্যাটাগরির নিয়ম **মুছে ফেলা হলে** ক্যাশে তার id বসে থাকে, আর তখন
   * প্রতিটা insert foreign key ভেঙে ৫০০ দেয় — TTL ফুরানো পর্যন্ত, অর্থাৎ
   * পাঁচ মিনিট ধরে ১৫টা PC-র কোনো app-usage ঢুকত না।
   *
   * ডেটা হারাত না (৫xx এজেন্টের কাছে transient, সে আবার পাঠায়), কিন্তু
   * পাঁচ মিনিটের অচলাবস্থা একটা রুল মোছার শাস্তি হিসেবে বেশি। তাই
   * একবার ক্যাশ ফেলে দিয়ে আবার চেষ্টা — দ্বিতীয়বারেও ব্যর্থ হলে সত্যিই
   * অন্য কোনো সমস্যা, সেটা উপরে যাক।
   */
  private async insertAppUsage(
    rows: Prisma.AppUsageCreateManyInput[],
  ): Promise<number> {
    try {
      const { count } = await this.prisma.appUsage.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return count;
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;

      this.logger.warn(
        'Category rules changed — dropping the cache and retrying',
      );
      this.categories.invalidate();

      const rules = await this.categories.rules();
      const retried = rows.map((row) => ({
        ...row,
        categoryId:
          matchCategory(rules, {
            processName: row.processName,
            domain: row.domain ?? null,
            windowTitle: row.windowTitle ?? null,
          })?.id ?? null,
      }));

      const { count } = await this.prisma.appUsage.createMany({
        data: retried,
        skipDuplicates: true,
      });
      return count;
    }
  }

  // ── events ────────────────────────────────────────────────────────────────

  async ingestEvents(
    device: Device,
    drift: Drift,
    events: EventDto[],
  ): Promise<IngestResult> {
    this.assertClientUuids(events);
    if (events.length === 0) return { accepted: 0, duplicates: 0, split: 0 };

    const rows: Prisma.EventCreateManyInput[] = events.map((e) => ({
      deviceId: device.id,
      employeeId: device.employeeId,
      clientUuid: e.clientUuid as string,
      type: e.type,
      occurredAt: this.clock.correct(e.occurredAt, drift),
      meta: (e.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    }));

    const { count } = await this.prisma.event.createMany({
      data: rows,
      skipDuplicates: true,
    });

    await this.applySessionEffects(device, rows);

    return { accepted: count, duplicates: rows.length - count, split: 0 };
  }

  /**
   * logoff / shutdown / agent_stop এলে খোলা সেশন বন্ধ করা হয় —
   * নইলে `ended_at` চিরকাল NULL পড়ে থাকত (G24)।
   */
  private async applySessionEffects(
    device: Device,
    rows: Prisma.EventCreateManyInput[],
  ): Promise<void> {
    const closing = rows
      .filter((r) => SESSION_CLOSING.has(r.type))
      .sort(
        (a, b) =>
          new Date(a.occurredAt as Date).getTime() -
          new Date(b.occurredAt as Date).getTime(),
      )
      .pop();

    if (!closing) return;

    const at = closing.occurredAt as Date;
    const workDate = workDateOf(at);

    /**
     * ওই দিনের সেশন — ইভেন্টের সময়েই বন্ধ।
     *
     * ⭐⭐⭐ **কিন্তু নিজের শুরুর আগে নয়** *(৬ সেপ্টেম্বর ২০২৬, G165)*।
     *
     * ⚠️⚠️ **যে বাগটা এটা সারায়:** বিদায়ী ইভেন্ট আউটবক্সে আটকে গেলে
     * (রিবুটের পর নেট আসার আগে প্রথম চেষ্টা ব্যর্থ) `SyncWorker` পরের
     * চক্রে **সেগমেন্ট আগে** পাঠায়, ইভেন্ট পরে। তখন দিনের সেশনটা
     * রিবুট-পরবর্তী সময়ে তৈরি হয়ে গেছে, আর তার পরে আসা **পুরোনো**
     * shutdown ইভেন্টটা তাকে **তার নিজের শুরুর আগে** বন্ধ করে দিত —
     * অর্থাৎ `ended_at < started_at`, ঋণাত্মক দৈর্ঘ্যের সেশন।
     *
     * ⚠️ মাঠে এখনো ঘটেনি, তবে ২৪ আগস্ট ৩ মিনিট ৩০ সেকেন্ডের ব্যবধানে
     * ফসকেছে (ডিভাইস ২৫: ইভেন্ট ০৯:৫৯:১৪, সেশন শুরু ১০:০১:৩৮ — দুটো
     * ব্যাচের ক্রম উল্টো হলেই −১৪৪ সেকেন্ডের সেশন)। আর দেরিতে আসা
     * বিদায়ী ইভেন্ট বিরল নয়: ৩ সপ্তাহে ৩৬৪টার মধ্যে **৫০টা** এক
     * মিনিটেরও বেশি দেরিতে, সর্বোচ্চ ৫০ মিনিট।
     *
     * ⚠️ **ক্ল্যাম্প করা হয় না, বাদ দেওয়া হয়।** `max(at, startedAt)`
     * বসালে এখনো চলতে থাকা সেশনের গায়ে শূন্য-দৈর্ঘ্য আর একটা মিথ্যা
     * `end_reason: shutdown` বসত। খোলা থাকাটা হারানো নয় — ০০:১৫-র
     * দিন-ক্লোজ তাকে তার নিজের মধ্যরাতে `day_rollover` দিয়ে বন্ধ করে।
     *
     * ⚠️ তুলনাটা **মুহূর্তে-মুহূর্তে** (`startedAt` বনাম `at`), লেবেলে নয় —
     * `workDate`-এর সাথে মেলালে ওটা ঢাকার ভোর ৬টা হিসেবে পড়ত, আর তখন
     * প্রায় প্রতিটা বৈধ বন্ধ করাও বাদ পড়ত।
     */
    await this.prisma.workSession.updateMany({
      where: {
        deviceId: device.id,
        workDate,
        endedAt: null,
        startedAt: { lte: at },
      },
      data: {
        endedAt: at,
        endReason: closing.type === 'logoff' ? 'logoff' : 'shutdown',
      },
    });

    // ⚠️ আগের দিনের কোনো সেশন খোলা পড়ে থাকলে সেটাকে আজকের logoff দিয়ে বন্ধ
    //    করা যাবে না — তাহলে একদিনের সেশন দুদিন লম্বা দেখাত।
    //    প্রত্যেকটাকে **তার নিজের** মধ্যরাতে বন্ধ করা হয়।
    const stale = await this.prisma.workSession.findMany({
      where: { deviceId: device.id, endedAt: null, workDate: { lt: workDate } },
      select: { id: true, startedAt: true },
    });

    for (const s of stale) {
      await this.prisma.workSession.update({
        where: { id: s.id },
        data: {
          endedAt: nextLocalMidnight(s.startedAt),
          endReason: 'day_rollover',
        },
      });
    }
  }
}
