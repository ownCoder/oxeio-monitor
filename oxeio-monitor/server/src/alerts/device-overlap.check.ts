import { Injectable, Logger } from '@nestjs/common';

import { workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import { overlapSec, unionSec, type Span } from '../summary/summary.math';
import { shouldFlagOverlap } from './alerts.rules';
import { AlertsService, type RaiseInput } from './alerts.service';

/** জমানোর সময় লাগে; `DeviceSpans`-এর `spans` readonly, তাই আলাদা টাইপ */
interface MutableDeviceSpans {
  deviceId: number;
  spans: Span[];
}

/**
 * **G32** — একই স্টাফের দুটো ডিভাইস একই সময়ে চলছে।
 *
 * ⚠️⚠️ এতদিন `device_overlap` ছিল **নাম মাত্র**: টাইপের ইউনিয়নে ছিল,
 * ওয়েবের ফিল্টারে ছিল, ops-এর লেবেলে ছিল, স্পেকের তিন জায়গায় "অ্যালার্ট
 * উঠবে" লেখা ছিল — কিন্তু **তোলার কোড কোথাও ছিল না**। অর্থাৎ ফিল্টারটা
 * এমন এক ধরনের অ্যালার্ট বেছে নিত যেটা কোনোদিন তৈরিই হয়নি।
 *
 * ⭐ <b>এটা কারো বিরুদ্ধে অভিযোগ নয়</b>, আর সেটা এই ক্লাসের বার্তাগুলোতেও
 * সাবধানে রাখা হয়েছে। ঘণ্টার হিসাবে overlap-এর কোনো প্রভাব পড়ে না —
 * `worked_sec` এমনিতেই UNION (§ ২.১-গ), তাই সময় দুবার গোনা হয় না।
 * স্পেক বলে সাধারণ কারণ দুটো: এক PC দুজন ব্যবহার করছে, অথবা কোনো
 * ভুলে-ফেলে-রাখা মেশিন চালু আছে। দুটোই ব্যবস্থাপনার তথ্য, বিচারের নয়।
 */
@Injectable()
export class DeviceOverlapCheck {
  private readonly logger = new Logger(DeviceOverlapCheck.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const workDate = workDateOf(now);

    /**
     * ⚠️ `daily_summary` নয়, কাঁচা `activity_segments` — কারণ সারাংশে
     * ডিভাইসের ভাগটাই নেই (`daily_summary`-র প্রাইমারি কী employee + date)।
     * ওখান থেকে `active_sec − worked_sec` কষা যেত, কিন্তু সেটা ভুল হিসাব —
     * কেন, তা `overlapSec()`-এর ডকে।
     *
     * ⚠️ শুধু `countsAsWork` — idle বা locked খণ্ড দুই মেশিনে একসাথে
     * থাকাটা একেবারেই স্বাভাবিক (একটা মেশিন লক করা পড়ে আছে), ওটা নিয়ে
     * কাউকে জানানোর কিছু নেই।
     */
    const segments = await this.prisma.activitySegment.findMany({
      where: { workDate, countsAsWork: true },
      select: {
        employeeId: true,
        deviceId: true,
        startedAt: true,
        endedAt: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    if (segments.length === 0) return 0;

    // employee → device → খণ্ডগুলো
    //
    // ⚠️ গোছানোটা এখানে, SQL-এ নয়। `GROUP BY` দিয়ে overlap বের করতে হলে
    //    উইন্ডো ফাংশনে interval merge লিখতে হতো — সেটা পরীক্ষা করা যেত
    //    শুধু ডাটাবেস সহ, আর ভুল হলে ফল সরাসরি কারো নামে অ্যালার্ট।
    const byEmployee = new Map<number, Map<number, MutableDeviceSpans>>();

    for (const s of segments) {
      let devices = byEmployee.get(s.employeeId);
      if (!devices) {
        devices = new Map();
        byEmployee.set(s.employeeId, devices);
      }

      let device = devices.get(s.deviceId);
      if (!device) {
        device = { deviceId: s.deviceId, spans: [] };
        devices.set(s.deviceId, device);
      }

      device.spans.push({ startedAt: s.startedAt, endedAt: s.endedAt });
    }

    const flagged: Array<{ employeeId: number; overlap: number; worked: number; devices: number }> =
      [];

    for (const [employeeId, devices] of byEmployee) {
      // একটাই ডিভাইস — গোটা হিসাবটাই এড়ানো যায়
      if (devices.size < 2) continue;

      const list = [...devices.values()];
      const overlap = overlapSec(list);
      const worked = unionSec(list.flatMap((d) => d.spans));

      if (
        !shouldFlagOverlap({
          deviceCount: devices.size,
          overlapSec: overlap,
          workedSec: worked,
        })
      ) {
        continue;
      }

      flagged.push({ employeeId, overlap, worked, devices: devices.size });
    }

    if (flagged.length === 0) return 0;

    // নাম ছাড়া বার্তাটা পড়ে কেউ কিছু করতে পারত না
    const names = new Map(
      (
        await this.prisma.employee.findMany({
          where: { id: { in: flagged.map((f) => f.employeeId) } },
          select: { id: true, fullName: true },
        })
      ).map((e) => [e.id, e.fullName]),
    );

    const day = workDate.toISOString().slice(0, 10);

    const inputs: RaiseInput[] = flagged.map((f) => {
      const name = names.get(f.employeeId) ?? `employee ${f.employeeId}`;
      const minutes = Math.round(f.overlap / 60);

      return {
        type: 'device_overlap' as const,
        severity: 'warning' as const,
        /**
         * ⚠️ `deviceId` ইচ্ছাকৃতভাবে null — ঘটনাটা **দুটো** ডিভাইসের,
         * একটার নয়। যেকোনো একটাকে বেছে নিলে throttle-এর key ওই ডিভাইসের
         * সাথে বাঁধা পড়ত, আর পরের ঘণ্টায় অন্যটা বেছে নিলে একই দিনের
         * একই ঘটনায় দ্বিতীয় অ্যালার্ট বসত।
         */
        deviceId: null,
        employeeId: f.employeeId,
        title: `Two devices at once — ${name}`,
        detail:
          `${name} had ${f.devices} devices sending work at the same time on ${day} ` +
          `(${minutes} min of overlap). This does not change the hours — worked time is ` +
          'a union, so nothing is counted twice. It usually means one PC is shared, or a ' +
          'machine was left running and logged in.',
        meta: {
          workDate: day,
          overlapSec: f.overlap,
          workedSec: f.worked,
          deviceCount: f.devices,
        },
      };
    });

    this.logger.log(`${inputs.length} staff had two devices running at once`);
    return this.alerts.raiseMany(inputs, now);
  }
}
