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
  agentPresence,
  latestHeartbeat,
  type AgentPresence,
  monthStartOf,
  parseWorkDate,
  previousWorkDate,
  spreadIntoHourBuckets,
  spreadTeamIntoHourBuckets,
  type DeviceReport,
  type LiveStatus,
  type TeamHour,
} from './dashboard.math';

import {
  countWorkdays,
  dailyTargetSec as dailyTargetSecOf,
  isWorkday,
  monthBoundsOf,
} from '../reports/reports.range';

const HOUR = 3600;

/**
 * fallback state বের করতে কত পুরোনো সেগমেন্ট পর্যন্ত দেখা হবে।
 *
 * এজেন্ট সেগমেন্ট **ব্যাচে** পাঠায়, তাই heartbeat তাজা হলেও শেষ সেগমেন্ট
 * কয়েক মিনিট পুরোনো হতে পারে। ১৫ মিনিট ধরা হয়েছে কারণ ৯০ সেকেন্ডের
 * বেশি পুরোনো heartbeat-এ এমনিতেই offline বসে যায় — অর্থাৎ এর চেয়ে বড়
 * জানালা রাখলেও উত্তর বদলাত না, শুধু বেশি সারি টানা হতো।
 */
const LIVE_STATE_LOOKBACK_SEC = 900;

/** কর্মীর একটাও সচল ডিভাইস না থাকলে — প্রতি কার্ডে নতুন অ্যারে বানানো নয় */
const NO_DEVICES: readonly DeviceReport[] = [];

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
  /**
   * ⭐ এক কর্মদিবসের টার্গেট — Live Board-এর রিং এখন **এটার** বিপরীতে।
   *
   * ⚠️ ৮ ঘণ্টা কোনো ধ্রুবক **নয়**, বের করা সংখ্যা: মাসিক টার্গেট ÷ ওই
   * মাসের কর্মদিবস। আগস্ট ২০২৬-এ ২০৮ ÷ ২৬ = ৮ ঘণ্টা, কিন্তু ২৭ কর্মদিবসের
   * মাসে ৭ঘ ৪২মি। ক্লায়েন্টে ৮ হার্ডকোড করলে কোনো কোনো মাসে টার্গেট
   * নীরবে ভুল দেখাত — আর ঠিক এই ভুলটাই মাসিক পাতায় ধরা পড়েছে (২০৮ vs ২১৬)।
   *
   * সংজ্ঞাটা রিপোর্টের সাথে **একই ফাংশন** থেকে আসে, নইলে দুটো পাতা দুই
   * রকম টার্গেট দেখাত।
   */
  dailyTargetSec: number;

  /**
   * আজ কর্মদিবস কি না (সাপ্তাহিক ছুটি বা সরকারি ছুটি নয়)।
   * ⚠️ ছুটির দিনে "০ / ৮ ঘণ্টা" দেখানো অন্যায় — ওই দিনে কারো কিছু করার কথাই নয়।
   */
  todayIsWorkday: boolean;

  /** মাসের হিসাব — এখন গৌণ, কিন্তু বেতনের ভিত্তি এটাই */
  monthWorkedSec: number;
  monthTargetSec: number;
  /** শেষ heartbeat — কোনো **সচল** ডিভাইস সাড়া না দিলে null */
  lastHeartbeatAt: Date | null;

  /**
   * ⭐ `lastHeartbeatAt === null` কেন — সেটার ব্যাখ্যা।
   *
   * ⚠️ এটা ছাড়া পর্দা "কখনো সাড়া দেয়নি" লিখত, অথচ কারণটা হতে পারত
   * "ডিভাইসটা বন্ধ করে দেওয়া হয়েছে" — দুটোর করণীয় সম্পূর্ণ আলাদা।
   */
  agentPresence: AgentPresence;
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

/** E01 — লাইভ বোর্ডের দিনের-ছন্দ চার্ট (`GET /live/pulse`) */
export interface TeamPulse {
  /** ঢাকার কর্মদিবস, `YYYY-MM-DD` */
  date: string;
  /** ⭐ সবসময় ২৪টা — খালি ঘণ্টাও `activeSec: 0, people: 0` নিয়ে থাকে */
  hours: TeamHour[];
  totalActiveSec: number;
  /** দিনের সর্বোচ্চ একসাথে কতজন — চার্টের y-অক্ষের সীমা */
  peakPeople: number;
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
   *    ৩০ সেকেন্ডে, প্রতিটি খোলা ব্রাউজার ট্যাব থেকে। তাই জোড়া লাগানো
   *    হয় **কোডে**, কর্মীপ্রতি কোয়েরিতে নয় — মোট **পাঁচটি** কোয়েরি,
   *    কর্মীসংখ্যা যাই হোক।
   *
   * ⭐ কার্ডের রঙ আসে `devices.last_state` থেকে — heartbeat-এ এজেন্ট নিজে
   *    যা বলেছে। আগে সেটা শেষ `activity_segments` সারি থেকে **অনুমান**
   *    করা হতো, আর এজেন্ট সেগমেন্ট ব্যাচে পাঠায় বলে বোর্ড কয়েক মিনিট
   *    পিছিয়ে থাকত: কর্মী উঠে চলে গেলেও কার্ড সবুজ, ফিরে এলেও ধূসর।
   *    ৩০ সেকেন্ডে রিফ্রেশ হওয়া বোর্ডে ৩ মিনিট পুরোনো উত্তর মানে
   *    রিফ্রেশটাই অর্থহীন। সেগমেন্ট এখন কেবল fallback (নিচে দেখো)।
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
   *    ব্যাপারটা অদৃশ্য নয়।
   *
   *    ⚠️⚠️ **এই যুক্তিটা ১২ আগস্ট পর্যন্ত ফাঁপা ছিল** — অ্যালার্টটার
   *    প্রযোজক কোনোদিন লেখাই হয়নি (G32), অর্থাৎ "অদৃশ্য নয়" কথাটা
   *    ভুল ছিল, আর দ্বিগুণ গোনা সত্যিই অদৃশ্য ছিল। এখন
   *    `alerts/device-overlap.check.ts` ঘণ্টায় একবার চলে, তাই রক্ষাকবচটা
   *    সত্যি — কিন্তু মনে রাখতে হবে, এখানে যোগফল রাখার সিদ্ধান্তটা
   *    ওই অ্যালার্টের উপরেই দাঁড়িয়ে।
   *
   *    আসল সমাধান দৈনিক rollup জব (daily_summary.worked_sec) — সেটা এলে
   *    **এই দুই জায়গা একসাথে** বদলাতে হবে, আলাদা করে নয়।
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
        policy: { select: { monthlyTargetHours: true, weeklyOffDay: true } },
      },
      orderBy: { empCode: 'asc' },
    });

    if (employees.length === 0) {
      return { workDate: formatWorkDate(today), generatedAt: now, cards: [] };
    }

    // ⭐ দৈনিক টার্গেট বের করতে ওই মাসের কর্মদিবস লাগে, আর কর্মদিবস গুনতে
    //    সরকারি ছুটি লাগে। ছুটি বাদ না দিলে ভাগফল ছোট হতো — অর্থাৎ দৈনিক
    //    টার্গেট কম, আর মাস শেষে যোগফল ২০৮-এ পৌঁছাত না।
    const { first: monthFirst, last: monthLast } = monthBoundsOf(today);
    const holidayRows = await this.prisma.holiday.findMany({
      where: { holidayDate: { gte: monthFirst, lte: monthLast } },
      select: { holidayDate: true },
    });
    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));

    const ids = employees.map((e) => e.id);

    const [devices, todaySums, monthSums, recentSegments] = await Promise.all([
      // ⚠️ revoked ডিভাইস বাদ — ওগুলোর lastSeenAt চিরকাল পুরোনো হয়ে
      //    আটকে থাকে, ফলে PC বদলে দেওয়া কর্মীও চিরকাল 🔴 দেখাত।
      //
      // ⭐ `groupBy(_max: lastSeenAt)` নয়, সারিগুলোই — কারণ এখন state-ও
      //    লাগে, আর `_max(lastSeenAt)` ও `_max(lastStateAt)` **আলাদা দুটো
      //    ডিভাইসের** হতে পারত: SQL aggregate কলামগুলোকে জোড়া ভাঙে।
      //    তখন বন্ধ ডেস্কটপের বাসি `active` ল্যাপটপের তাজা সময়ের সাথে
      //    জোড়া লেগে যেত, আর কার্ড চিরকাল সবুজ দেখাত। ১৫ জনের ২০-৩০টা
      //    সারি — এটা এখনো একটাই কোয়েরি, N+1 নয়।
      this.prisma.device.findMany({
        /**
         * ⚠️⚠️ আগে এখানে `status: 'active'` ছাঁকা ছিল। ফলে বন্ধ করে দেওয়া
         * ডিভাইস তালিকা থেকেই উধাও হয়ে যেত, আর কার্ড "কখনো এজেন্ট বসেনি"
         * থেকে আলাদা করা যেত না — একই কার্ডে ১৬:৫০-এর স্ক্রিনশট আর পাশে
         * *"Never checked in"*।
         *
         * ⭐ ছাঁকাটা এখন `dashboard.math.ts`-এ, যেখানে সিদ্ধান্তটা নেওয়া হয়
         * আর টেস্টে বাঁধা যায়।
         */
        where: { employeeId: { in: ids } },
        select: {
          employeeId: true,
          status: true,
          lastSeenAt: true,
          lastState: true,
          lastStateAt: true,
        },
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
      // ⚠️ এটা এখন শুধু **fallback** (`devices.last_state` null হলে), তবু
      //    সবসময়ই চালানো হয় — কর্মীভেদে লাগবে কি না আগে থেকে জানা যায় না,
      //    আর "দরকার হলে তখন আনি" মানে কর্মীপ্রতি একটা কোয়েরি, অর্থাৎ
      //    ঠিক সেই N+1 যা এই মেথড এড়ানোর জন্য লেখা।
      //
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

    const byEmployee = new Map<number, DeviceReport[]>();
    for (const d of devices) {
      if (d.employeeId === null) continue;
      const list = byEmployee.get(d.employeeId);
      if (list) list.push(d);
      else byEmployee.set(d.employeeId, [d]);
    }

    const todaySec = sumByEmployee(todaySums);
    const monthSec = sumByEmployee(monthSums);

    // ⚠️ `orderBy endedAt desc` + "প্রথমটাই রাখা" — তাই কর্মীপ্রতি সবচেয়ে
    //    সাম্প্রতিক সেগমেন্টই থাকে। উল্টো ক্রমে লিখলে সবচেয়ে পুরোনোটা
    //    বসে যেত এবং কার্ড কখনো হালনাগাদ হতো না।
    const segmentState = new Map<number, SegmentState>();
    for (const s of recentSegments) {
      if (!segmentState.has(s.employeeId))
        segmentState.set(s.employeeId, s.state);
    }

    const cards = employees.map((e): LiveCard => {
      const own = byEmployee.get(e.id) ?? NO_DEVICES;
      const targetHours = Number(
        e.policy?.monthlyTargetHours ?? DEFAULT_TARGET_HOURS,
      );

      // ⚠️ নীতি আলাদা হলে সাপ্তাহিক ছুটির বারও আলাদা, তাই কর্মদিবস
      //    কর্মীপ্রতি গোনা হয় — সবার জন্য একটাই সংখ্যা ধরে নেওয়া যায় না।
      const rule = { weeklyOffDay: e.policy?.weeklyOffDay ?? null, holidays };
      const workdays = countWorkdays(monthFirst, monthLast, rule);

      return {
        employeeId: e.id,
        empCode: e.empCode,
        fullName: e.fullName,
        designation: e.designation,
        status: decideLiveStatus({
          devices: own,
          fallbackState: segmentState.get(e.id) ?? null,
          now,
        }),
        todayWorkedSec: todaySec.get(e.id) ?? 0,
        dailyTargetSec: Math.round(dailyTargetSecOf(targetHours * HOUR, workdays)),
        todayIsWorkday: isWorkday(today, rule),
        monthWorkedSec: monthSec.get(e.id) ?? 0,
        monthTargetSec: Math.round(targetHours * HOUR),
        lastHeartbeatAt: latestHeartbeat(own),
        agentPresence: agentPresence(own),
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
   * ⭐ E01 — **দলের দিনের ছন্দ**, লাইভ বোর্ডের চার্টের জন্য।
   *
   * ⚠️ এটা ছাড়া বোর্ডে সময়ের কোনো রেখা আঁকা যেত না: `/live` কেবল **এখনকার**
   *    অবস্থা পাঠায়, আর `/employees/:id/hourly` একজনের। দশজনের ছন্দ পেতে
   *    ব্রাউজারকে দশটা কল করতে হতো — প্রতি রিফ্রেশে, প্রতিটি খোলা ট্যাব
   *    থেকে। তাই যোগফলটা সার্ভারেই, **একটি** কোয়েরিতে।
   *
   * ⚠️ `/live`-এর সাথে **জোড়া লাগানো হয়নি** ইচ্ছাকৃতভাবে। বোর্ড ৩০ সেকেন্ডে
   *    রিফ্রেশ হয়, কিন্তু দিনের ছন্দ অত দ্রুত বদলায় না — এক ঘণ্টার বালতি
   *    ৩০ সেকেন্ডে একবার আনা মানে একই উত্তর ১২০ বার আনা। আলাদা রাখায়
   *    ওয়েব নিজের তালে (ধীরে) ডাকতে পারে।
   */
  async teamPulse(rawDate?: string): Promise<TeamPulse> {
    const workDate = this.resolveWorkDate(rawDate);

    // ⚠️ `hourly()`-র মতোই শুধু `countsAsWork` — idle বা locked ঢুকলে
    //    "কোন ঘণ্টায় কত কাজ" প্রশ্নের উত্তর ফুলে যেত।
    const rows = await this.prisma.activitySegment.findMany({
      where: { workDate, countsAsWork: true },
      select: {
        employeeId: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    const hours = spreadTeamIntoHourBuckets(rows, workDate);

    return {
      date: formatWorkDate(workDate),
      hours,
      totalActiveSec: hours.reduce((a, h) => a + h.activeSec, 0),
      /**
       * ⭐ দিনের **সর্বোচ্চ একসাথে** কতজন — চার্টের y-অক্ষ এটার উপরেই
       * দাঁড়ায়। ক্লায়েন্টে বের করলেও চলত, কিন্তু তখন অক্ষের সীমা আর
       * ডেটা দুই জায়গা থেকে আসত।
       */
      peakPeople: hours.reduce((m, h) => Math.max(m, h.people), 0),
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
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
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
    if (!employee) throw new NotFoundException('No such staff member');
    return employee;
  }
}

function sumByEmployee(
  rows: Array<{ employeeId: number; _sum: { durationSec: number | null } }>,
): Map<number, number> {
  return new Map(rows.map((r) => [r.employeeId, r._sum.durationSec ?? 0]));
}
