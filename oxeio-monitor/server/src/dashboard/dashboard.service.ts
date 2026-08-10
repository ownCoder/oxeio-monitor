import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SegmentState } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import {
  decideLiveStatus,
  formatWorkDate,
  monthStartOf,
  parseWorkDate,
  previousWorkDate,
  spreadIntoHourBuckets,
  type LiveStatus,
} from './dashboard.math';

const HOUR = 3600;

/**
 * লাইভ বোর্ডে state ঠিক করতে কত পুরোনো সেগমেন্ট পর্যন্ত দেখা হবে।
 *
 * এজেন্ট সেগমেন্ট **ব্যাচে** পাঠায়, তাই heartbeat তাজা হলেও শেষ সেগমেন্ট
 * কয়েক মিনিট পুরোনো হতে পারে। ১৫ মিনিট ধরা হয়েছে কারণ ৯০ সেকেন্ডের
 * বেশি পুরোনো heartbeat-এ এমনিতেই offline বসে যায় — অর্থাৎ এর চেয়ে বড়
 * জানালা রাখলেও উত্তর বদলাত না, শুধু বেশি সারি টানা হতো।
 */
const LIVE_STATE_LOOKBACK_SEC = 900;

/** ⚠️ ডিফল্ট মাসিক টার্গেট — পলিসি না থাকলে (§ ২.১-খ, ২০৮ ঘণ্টা) */
const DEFAULT_TARGET_HOURS = 208;

export interface LiveCard {
  employeeId: number;
  empCode: string;
  fullName: string;
  designation: string | null;
  status: LiveStatus;
  /** ঢাকার আজকের দিনে গোনা সেকেন্ড */
  todayWorkedSec: number;
  /** ⭐ E02 — রিংটা **মাসিক**, দৈনিক নয় */
  monthWorkedSec: number;
  monthTargetSec: number;
  /** শেষ heartbeat — কোনো ডিভাইস কখনো সাড়া না দিলে null */
  lastHeartbeatAt: Date | null;
}

export interface LiveBoard {
  /** ঢাকার আজকের কর্মদিবস, `YYYY-MM-DD` */
  workDate: string;
  generatedAt: Date;
  cards: LiveCard[];
}

export interface TimelineSegment {
  /** ⚠️ BigInt স্ট্রিং হিসেবে — কারণ নিচে দেখো */
  id: string;
  deviceId: number;
  state: SegmentState;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
}

export interface Timeline {
  employeeId: number;
  empCode: string;
  fullName: string;
  date: string;
  segments: TimelineSegment[];
  totals: { activeSec: number; idleSec: number; lockedSec: number };
}

export interface HourlyBucket {
  /** ঢাকার স্থানীয় ঘণ্টা, ০–২৩ */
  hour: number;
  activeSec: number;
}

export interface HourlyChart {
  employeeId: number;
  date: string;
  buckets: HourlyBucket[];
  totalActiveSec: number;
}

/**
 * E01/E02/E04/E05 — লাইভ বোর্ড, টাইমলাইন ও ঘণ্টাভিত্তিক চার্ট।
 *
 * ⚠️ কোনো হিসাব এখানে লেখা হয়নি — স্ট্যাটাস, বালতি, তারিখ সবই
 * `dashboard.math.ts`-এ। এই ক্লাসের কাজ শুধু ডেটা আনা ও সাজানো।
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * E01 — ১৫টা কার্ড, ৩০ সেকেন্ডে রিফ্রেশ।
   *
   * ⚠️ **N+1 লেখা যাবে না।** কর্মীপ্রতি লুপ করে ডিভাইস/সেগমেন্ট আনলে
   *    ১৫ জন × (ডিভাইস + আজ + মাস + state) = ৬০+ কোয়েরি হতো — প্রতি
   *    ৩০ সেকেন্ডে, প্রতিটি খোলা ব্রাউজার ট্যাব থেকে। তাই সবগুলো
   *    `groupBy` — মোট **পাঁচটি** কোয়েরি, কর্মীসংখ্যা যাই হোক।
   *
   * ⭐ worked সেকেন্ড এখানে **যোগফল**, UNION নয় — যদিও § ২.১-গ বলে UNION।
   *    ইচ্ছাকৃত, এবং কারণটা নির্ভুলতার চেয়েও ভারী:
   *
   *    এই একই দুটো সংখ্যা এজেন্টের tray-তেও দেখানো হয়
   *    (`src/agent/progress.service.ts`), আর সেখানে যোগফলই ব্যবহার হচ্ছে।
   *    এখানে UNION বসালে স্টাফ tray-তে এক সংখ্যা আর ম্যানেজার বোর্ডে
   *    আরেক সংখ্যা দেখত — "কোনটা সত্যি?" প্রশ্নের কোনো উত্তর থাকত না,
   *    আর যে ফিচারের পুরো উদ্দেশ্য আস্থা, সেটাই আস্থা ভাঙত।
   *
   *    ⚠️ ফল: কেউ একইসাথে দুই PC চালালে ওই সময়টা দুইবার গোনা হয়।
   *    ১৫ মিনিটের বেশি overlap-এ `device_overlap` অ্যালার্ট ওঠে, তাই
   *    ব্যাপারটা অদৃশ্য নয়। আসল সমাধান দৈনিক rollup জব (daily_summary.
   *    worked_sec) — সেটা এলে **এই দুই জায়গা একসাথে** বদলাতে হবে,
   *    আলাদা করে নয়।
   */
  async live(now: Date = new Date()): Promise<LiveBoard> {
    const today = workDateOf(now);
    const monthStart = monthStartOf(today);
    const stateCutoff = new Date(
      now.getTime() - LIVE_STATE_LOOKBACK_SEC * 1000,
    );

    const employees = await this.prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        empCode: true,
        fullName: true,
        designation: true,
        policy: { select: { monthlyTargetHours: true } },
      },
      orderBy: { empCode: 'asc' },
    });

    if (employees.length === 0) {
      return { workDate: formatWorkDate(today), generatedAt: now, cards: [] };
    }

    const ids = employees.map((e) => e.id);

    const [devices, todaySums, monthSums, recentSegments] = await Promise.all([
      // ⚠️ revoked ডিভাইস বাদ — ওগুলোর lastSeenAt চিরকাল পুরোনো হয়ে
      //    আটকে থাকে, ফলে PC বদলে দেওয়া কর্মীও চিরকাল 🔴 দেখাত।
      this.prisma.device.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids }, status: 'active' },
        _max: { lastSeenAt: true },
      }),
      this.prisma.activitySegment.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids }, countsAsWork: true, workDate: today },
        _sum: { durationSec: true },
      }),
      this.prisma.activitySegment.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: ids },
          countsAsWork: true,
          workDate: { gte: monthStart, lte: today },
        },
        _sum: { durationSec: true },
      }),
      // ⚠️ `workDate` দিয়েও ছাঁকা হয় শুধু ইনডেক্সের জন্য —
      //    (employeeId, workDate, state) ইনডেক্স তখনই কাজে লাগে। গতকালকে
      //    রাখতেই হয়: মধ্যরাতের ঠিক পরে আজকের কোনো সেগমেন্টই থাকে না,
      //    অথচ কর্মী তখনো কাজ করছে (§ ২.১-ক — রাতে কাজ স্বাভাবিক)।
      this.prisma.activitySegment.findMany({
        where: {
          employeeId: { in: ids },
          workDate: { in: [previousWorkDate(today), today] },
          endedAt: { gte: stateCutoff },
        },
        select: { employeeId: true, state: true, endedAt: true },
        orderBy: { endedAt: 'desc' },
      }),
    ]);

    const lastSeen = new Map<number, Date | null>();
    for (const d of devices) {
      if (d.employeeId !== null) lastSeen.set(d.employeeId, d._max.lastSeenAt);
    }

    const todaySec = sumByEmployee(todaySums);
    const monthSec = sumByEmployee(monthSums);

    // ⚠️ `orderBy endedAt desc` + "প্রথমটাই রাখা" — তাই কর্মীপ্রতি সবচেয়ে
    //    সাম্প্রতিক সেগমেন্টই থাকে। উল্টো ক্রমে লিখলে সবচেয়ে পুরোনোটা
    //    বসে যেত এবং কার্ড কখনো হালনাগাদ হতো না।
    const lastState = new Map<number, SegmentState>();
    for (const s of recentSegments) {
      if (!lastState.has(s.employeeId)) lastState.set(s.employeeId, s.state);
    }

    const cards = employees.map((e): LiveCard => {
      const seenAt = lastSeen.get(e.id) ?? null;
      const targetHours = Number(
        e.policy?.monthlyTargetHours ?? DEFAULT_TARGET_HOURS,
      );

      return {
        employeeId: e.id,
        empCode: e.empCode,
        fullName: e.fullName,
        designation: e.designation,
        status: decideLiveStatus({
          lastSeenAt: seenAt,
          hasDevice: lastSeen.has(e.id),
          lastState: lastState.get(e.id) ?? null,
          now,
        }),
        todayWorkedSec: todaySec.get(e.id) ?? 0,
        monthWorkedSec: monthSec.get(e.id) ?? 0,
        monthTargetSec: Math.round(targetHours * HOUR),
        lastHeartbeatAt: seenAt,
      };
    });

    return { workDate: formatWorkDate(today), generatedAt: now, cards };
  }

  /** E04 — ওই কর্মদিবসের সব সেগমেন্ট, সময় অনুযায়ী সাজানো */
  async timeline(employeeId: number, rawDate?: string): Promise<Timeline> {
    const workDate = this.resolveWorkDate(rawDate);
    const employee = await this.requireEmployee(employeeId);

    const rows = await this.prisma.activitySegment.findMany({
      where: { employeeId, workDate },
      select: {
        id: true,
        deviceId: true,
        state: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    const totals = { activeSec: 0, idleSec: 0, lockedSec: 0 };
    for (const r of rows) {
      if (r.state === 'active') totals.activeSec += r.durationSec;
      else if (r.state === 'idle') totals.idleSec += r.durationSec;
      else totals.lockedSec += r.durationSec;
    }

    return {
      employeeId,
      empCode: employee.empCode,
      fullName: employee.fullName,
      date: formatWorkDate(workDate),
      // ⚠️ `id` BigInt — app.setup.ts-এ BigInt-এর JSON সিরিয়ালাইজেশন
      //    বসানো নেই, তাই সরাসরি ফেরত দিলে রেসপন্স তৈরির সময়ই
      //    "Do not know how to serialize a BigInt" ছুড়ে ৫০০ হতো।
      //    স্ট্রিং রাখা এমনিতেও নিরাপদ — JS number ৯,০০৭ ট্রিলিয়নের পরে
      //    নীরবে নির্ভুলতা হারায়।
      segments: rows.map((r) => ({ ...r, id: r.id.toString() })),
      totals,
    };
  }

  /** E05 — ২৪টা বালতি, প্রতিটিতে active সেকেন্ড */
  async hourly(employeeId: number, rawDate?: string): Promise<HourlyChart> {
    const workDate = this.resolveWorkDate(rawDate);
    await this.requireEmployee(employeeId);

    // ⚠️ শুধু `countsAsWork` — idle বা locked ঘণ্টার চার্টে ঢুকলে
    //    "কোন ঘণ্টায় কত কাজ" প্রশ্নের উত্তর ফুলে যেত।
    const rows = await this.prisma.activitySegment.findMany({
      where: { employeeId, workDate, countsAsWork: true },
      select: { startedAt: true, endedAt: true, durationSec: true },
      orderBy: { startedAt: 'asc' },
    });

    const buckets = spreadIntoHourBuckets(rows, workDate);

    return {
      employeeId,
      date: formatWorkDate(workDate),
      buckets: buckets.map((activeSec, hour) => ({ hour, activeSec })),
      totalActiveSec: buckets.reduce((a, b) => a + b, 0),
    };
  }

  /**
   * ⚠️ `date` না দিলে ঢাকার আজকের দিন — সার্ভারের নয়। সার্ভার UTC-তে চললে
   *    ঢাকার সকাল ৬টার আগে `new Date()`-এর তারিখ আগের দিন দেখাত।
   */
  private resolveWorkDate(raw?: string): Date {
    if (raw === undefined) return workDateOf(new Date());

    const parsed = parseWorkDate(raw);
    if (!parsed) {
      throw new BadRequestException('date দিতে হবে বৈধ YYYY-MM-DD তারিখ');
    }
    return parsed;
  }

  private async requireEmployee(
    employeeId: number,
  ): Promise<{ empCode: string; fullName: string }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { empCode: true, fullName: true },
    });
    if (!employee) throw new NotFoundException('এই কর্মী নেই');
    return employee;
  }
}

function sumByEmployee(
  rows: Array<{ employeeId: number; _sum: { durationSec: number | null } }>,
): Map<number, number> {
  return new Map(rows.map((r) => [r.employeeId, r._sum.durationSec ?? 0]));
}
