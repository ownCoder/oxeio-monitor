import { Injectable, Logger } from '@nestjs/common';

import { workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService, type RaiseInput } from './alerts.service';
import {
  findSyntheticInput,
  DEFAULT_SYNTHETIC_LIMITS,
  type ActiveSegment,
  type WindowSpan,
} from './synthetic-input.rules';

/**
 * **G46** — নকল ইনপুট (মাউস-জিগলার) সন্দেহে চিহ্নিত করা।
 *
 * ⚠️⚠️ **কেন এটা সার্ভারে, এজেন্টে নয়:** এজেন্ট চলে স্টাফের নিজের মেশিনে।
 * সেখানে বসানো যেকোনো পাহারা তিনি বন্ধ করতে, বদলাতে বা ফাঁকি দিতে পারেন —
 * আর সবচেয়ে খারাপ, **সেটা নীরবে**। বদলে এখানে দেখা হয় সার্ভারে পৌঁছানো
 * ডেটার **আকৃতি**, যেটা লুকানো যায় না: ঘণ্টা দাবি করতে হলে ডেটা পাঠাতেই
 * হবে, আর পাঠালেই আকৃতিটা ধরা পড়ে।
 *
 * ⭐⭐ ফাঁকির তিনটে পথ, তিনটেই কোথাও না কোথাও ধরা পড়ে:
 *
 *   ১· **জিগলার চালানো** → এই নিয়ম ধরে
 *   ২· **এজেন্ট বন্ধ করা** → ঘণ্টাও বন্ধ, আর `agent_down` ওঠে
 *   ৩· **এজেন্টে হাত দেওয়া** → `agent_tamper` ওঠে
 *
 * অর্থাৎ পাহারাটা এড়াতে গেলে **ঘণ্টা হারাতে হয়** — আর সেটাই আসল প্রতিরোধ,
 * কোনো একক কৌশল নয়।
 *
 * ⚠️ এটা **অভিযোগ নয়, দেখার অনুরোধ** — বার্তাটাও সেভাবেই লেখা।
 */
@Injectable()
export class SyntheticInputCheck {
  private readonly logger = new Logger(SyntheticInputCheck.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const workDate = workDateOf(now);

    /**
     * ⚠️ শুধু `active` — idle বা locked খণ্ড স্ট্রেচ **ভাঙার** জন্য দরকার,
     * আর সেটা এমনিতেই ঘটে: ওগুলো তালিকায় না থাকায় সময়ের ফাঁক তৈরি হয়,
     * আর `mergeActive` ওখানেই স্ট্রেচ কেটে দেয়।
     */
    const segments = await this.prisma.activitySegment.findMany({
      where: { workDate, state: 'active' },
      select: {
        employeeId: true,
        deviceId: true,
        startedAt: true,
        endedAt: true,
        inputScore: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    if (segments.length === 0) return 0;

    const usage = await this.prisma.appUsage.findMany({
      where: { workDate },
      select: {
        employeeId: true,
        deviceId: true,
        startedAt: true,
        endedAt: true,
        processName: true,
        windowTitle: true,
      },
    });

    /**
     * ⚠️⚠️ **কর্মী নয়, ডিভাইস ধরে ভাগ করা হয়।** কারো দুটো PC একসাথে চললে
     * (G32) তাদের খণ্ড মিশে গিয়ে একটা লম্বা "একটানা" স্ট্রেচ বানাত, আর
     * দুই মেশিনে কাজ করা সৎ কর্মীই সন্দেহে পড়তেন।
     */
    const byDevice = new Map<
      string,
      { employeeId: number; deviceId: number; segments: ActiveSegment[]; usage: WindowSpan[] }
    >();

    const bucket = (employeeId: number, deviceId: number) => {
      const key = `${employeeId}:${deviceId}`;
      let found = byDevice.get(key);
      if (!found) {
        found = { employeeId, deviceId, segments: [], usage: [] };
        byDevice.set(key, found);
      }
      return found;
    };

    for (const s of segments) {
      bucket(s.employeeId, s.deviceId).segments.push({
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        inputScore: s.inputScore,
      });
    }

    for (const u of usage) {
      bucket(u.employeeId, u.deviceId).usage.push({
        startedAt: u.startedAt,
        endedAt: u.endedAt,
        /**
         * ⭐ process **আর** শিরোনাম — শুধু process নিলে একই ব্রাউজারে
         * ট্যাব বদলানো "কোনো বদল নয়" মনে হতো, আর সারাদিন ব্রাউজারে কাজ
         * করা কর্মী সন্দেহে পড়তেন।
         *
         * ⚠️ শিরোনাম **এখানে জমে না, কোথাও লেখাও হয় না** — শুধু গোনার
         * জন্য একটা চাবি বানানো হয়, আর অ্যালার্টের `meta`-তেও কেবল
         * সংখ্যাটাই যায়। কে কোন নথি খুলেছিলেন সেটা এই অ্যালার্ট জানায় না।
         */
        key: `${u.processName}|${u.windowTitle ?? ''}`,
      });
    }

    const names = new Map(
      (
        await this.prisma.employee.findMany({
          where: { id: { in: [...new Set(segments.map((s) => s.employeeId))] } },
          select: { id: true, fullName: true },
        })
      ).map((e) => [e.id, e.fullName]),
    );

    const day = workDate.toISOString().slice(0, 10);
    const inputs: RaiseInput[] = [];

    for (const row of byDevice.values()) {
      for (const f of findSyntheticInput(row.segments, row.usage)) {
        const name = names.get(row.employeeId) ?? `employee ${row.employeeId}`;
        const hours = (f.durationSec / 3600).toFixed(1);

        inputs.push({
          type: 'synthetic_input' as const,
          /**
           * ⚠️ `warning`, `critical` নয়। এটা সন্দেহ, প্রমাণ নয় — আর একটা
           * ভুল "critical" মানুষের সম্পর্কে যা ক্ষতি করে, সেটা ফেরানো যায় না।
           */
          severity: 'warning' as const,
          deviceId: row.deviceId,
          employeeId: row.employeeId,
          title: `Unbroken activity — ${name}`,
          detail:
            `${name} shows ${hours} hours of continuous activity on ${day} with no pause ` +
            `longer than a minute, only ${f.windows} foreground window the whole time, and an ` +
            `almost flat input pattern. People normally pause and switch windows, so this ` +
            `shape usually comes from a tool that keeps the machine awake. ` +
            `⚠️ It is not proof — check the screenshots for that stretch before saying anything.`,
          meta: {
            workDate: day,
            startedAt: f.startedAt.toISOString(),
            endedAt: f.endedAt.toISOString(),
            durationSec: f.durationSec,
            windows: f.windows,
            scoreSpread: f.scoreSpread,
            /**
             * ⭐ কোন সীমায় ফেলা হয়েছে সেটাও লেখা — সীমা বদলালে পুরোনো
             * অ্যালার্টগুলো কেন উঠেছিল তা আর অনুমান করতে হয় না।
             *
             * ⚠️ ঘর ধরে ধরে লেখা, পুরো অবজেক্ট নয় — Prisma-র `InputJsonValue`
             * ইন্ডেক্স-সিগনেচারহীন interface মানে না।
             */
            minStretchSec: DEFAULT_SYNTHETIC_LIMITS.minStretchSec,
            maxWindows: DEFAULT_SYNTHETIC_LIMITS.maxWindows,
            maxScoreSpread: DEFAULT_SYNTHETIC_LIMITS.maxScoreSpread,
          },
        });
      }
    }

    if (inputs.length > 0) {
      this.logger.warn(`${inputs.length} unbroken-activity stretch(es) flagged for review`);
    }
    return this.alerts.raiseMany(inputs, now);
  }
}
