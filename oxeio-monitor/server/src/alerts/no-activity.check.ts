import { Injectable, Logger } from '@nestjs/common';

import { workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import { isNoActivityWindow, shouldFlagNoActivity } from './alerts.rules';
import { AlertsService, type RaiseInput } from './alerts.service';

/**
 * G06 — কেউ পুরো দিন কোনো কাজ করেনি।
 *
 * ⭐ severity ইচ্ছাকৃতভাবে `info`, `warning` নয়।
 * ছুটির কোনো আবেদন-অনুমোদনের ব্যবস্থা এই সিস্টেমে নেই (ADR-011d), তাই
 * "আজ কেউ আসেনি" কোনো **ত্রুটি** নয় — নিছক তথ্য। এটাকে warning বানালে
 * আসল ত্রুটির (এজেন্ট মরে যাওয়া, ডিস্ক ভরা) সাথে এক কাতারে পড়ত, আর তখন
 * warning শব্দটার মানেই হালকা হয়ে যেত।
 */
@Injectable()
export class NoActivityCheck {
  private readonly logger = new Logger(NoActivityCheck.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    // সন্ধ্যার জানালার বাইরে প্রশ্নটাই অর্থহীন — কুয়েরিও করা হয় না
    if (!isNoActivityWindow(now)) return 0;

    const workDate = workDateOf(now);

    const [employees, holiday, worked] = await Promise.all([
      this.prisma.employee.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          fullName: true,
          joinedOn: true,
          leftOn: true,
          policy: { select: { weeklyOffDay: true } },
        },
      }),
      this.prisma.holiday.findUnique({
        where: { holidayDate: workDate },
        select: { name: true },
      }),
      /**
       * ⚠️ `daily_summary` নয়, সরাসরি `activity_segments`।
       *
       * rollup জব প্রতি ১৫ মিনিটে চলে (§ ৬.৪) — কিন্তু ওটা বন্ধ থাকলে বা
       * পিছিয়ে থাকলে সবাইকে "কাজ করেনি" দেখাত, আর তখন বারোজনের বারোটা
       * মিথ্যা অ্যালার্ট যেত। কাঁচা টেবিল কখনো মিথ্যা বলে না।
       */
      this.prisma.activitySegment.groupBy({
        by: ['employeeId'],
        where: { workDate, countsAsWork: true },
        _count: { _all: true },
      }),
    ]);

    const workedBy = new Map(worked.map((w) => [w.employeeId, w._count._all]));

    const inputs: RaiseInput[] = employees
      .filter((e) =>
        shouldFlagNoActivity({
          workedSegments: workedBy.get(e.id) ?? 0,
          weeklyOffDay: e.policy?.weeklyOffDay ?? null,
          isHoliday: holiday !== null,
          joinedOn: e.joinedOn,
          leftOn: e.leftOn,
          now,
        }),
      )
      .map((e) => ({
        type: 'no_activity_today' as const,
        severity: 'info' as const,
        deviceId: null,
        employeeId: e.id,
        title: `No work recorded today — ${e.fullName}`,
        detail:
          `${e.fullName} has no active segment at all today ` +
          `(${workDate.toISOString().slice(0, 10)}). If they were absent there is ` +
          'nothing to do; if they were in the office, check whether the agent is ' +
          'running on that PC.',
        meta: { workDate: workDate.toISOString().slice(0, 10) },
      }));

    if (inputs.length === 0) return 0;

    this.logger.log(`${inputs.length} staff have no work recorded today`);
    return this.alerts.raiseMany(inputs, now);
  }
}
