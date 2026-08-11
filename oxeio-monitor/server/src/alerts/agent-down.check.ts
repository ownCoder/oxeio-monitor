import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AGENT_SILENCE_MIN } from './alerts.constants';
import {
  agentDownCandidates,
  silentMinutes,
  CLEAN_STOP_EVENTS,
  type DeviceSilence,
} from './alerts.rules';
import { AlertsService, type RaiseInput } from './alerts.service';

/** ⚠️ কত পুরোনো বিদায়ী ইভেন্ট পর্যন্ত দেখা হবে — কুয়েরিটা ছোট রাখার জন্য */
const STOP_LOOKBACK_DAYS = 7;

/**
 * G01 — কোনো এজেন্ট ১০ মিনিট ধরে চুপ (স্পেক § ৬.৪, প্রতি ৫ মিনিটে)।
 *
 * ⚠️ "চুপ" মানেই "সমস্যা" নয়। PC বন্ধ করে বাড়ি যাওয়াও চুপ। পার্থক্যটা
 *    alerts.rules.ts-এর `isExpectedSilence()` করে — বিস্তারিত কারণ ওখানে।
 */
@Injectable()
export class AgentDownCheck {
  private readonly logger = new Logger(AgentDownCheck.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const silenceFloor = new Date(now.getTime() - AGENT_SILENCE_MIN * 60_000);

    const devices = await this.prisma.device.findMany({
      where: {
        // ⚠️ revoke করা ডিভাইস বাদ — ওগুলোর চুপ থাকাটাই তো উদ্দেশ্য
        status: 'active',
        lastSeenAt: { not: null, lt: silenceFloor },
      },
      select: {
        id: true,
        hostname: true,
        lastSeenAt: true,
        employeeId: true,
        employee: { select: { fullName: true } },
      },
    });

    if (devices.length === 0) return 0;

    const lastStops = await this.lastCleanStops(
      devices.map((d) => d.id),
      now,
    );

    const silences: DeviceSilence[] = devices.map((d) => ({
      deviceId: d.id,
      lastSeenAt: d.lastSeenAt,
      lastCleanStopAt: lastStops.get(d.id) ?? null,
    }));

    const down = new Set(
      agentDownCandidates(silences, now).map((s) => s.deviceId),
    );
    if (down.size === 0) return 0;

    const inputs: RaiseInput[] = devices
      .filter((d) => down.has(d.id))
      .map((d) => {
        const minutes = silentMinutes(d.lastSeenAt, now) ?? 0;
        return {
          type: 'agent_down' as const,
          severity: 'warning' as const,
          deviceId: d.id,
          employeeId: d.employeeId,
          title: `Agent silent — ${d.hostname}`,
          detail:
            `${d.hostname}${d.employee ? ` (${d.employee.fullName})` : ''} ` +
            `has sent nothing for ${minutes} minutes, and no shutdown event arrived either. ` +
            'Check whether the PC is on, the network is working, and the agent is running.',
          meta: { silentMinutes: minutes, hostname: d.hostname },
        };
      });

    this.logger.warn(`${inputs.length} devices silent with no explanation`);
    return this.alerts.raiseMany(inputs, now);
  }

  /**
   * প্রতিটা ডিভাইসের **সর্বশেষ বিদায়ী ইভেন্ট**।
   *
   * ⚠️ `groupBy` ব্যবহার করা হয়েছে, `findMany + distinct` নয় — Prisma-র
   *    `distinct` সব সারি টেনে এনে মেমোরিতে ছাঁকে, আর ইভেন্ট টেবিল দ্রুত
   *    বড় হয়। এখানে কাজটা ডাটাবেসেই `MAX(occurred_at)` দিয়ে হয়।
   */
  private async lastCleanStops(
    deviceIds: number[],
    now: Date,
  ): Promise<Map<number, Date>> {
    const rows = await this.prisma.event.groupBy({
      by: ['deviceId'],
      where: {
        deviceId: { in: deviceIds },
        type: { in: [...CLEAN_STOP_EVENTS] },
        occurredAt: {
          gte: new Date(now.getTime() - STOP_LOOKBACK_DAYS * 86_400_000),
        },
      },
      _max: { occurredAt: true },
    });

    const map = new Map<number, Date>();
    for (const row of rows) {
      if (row.deviceId !== null && row._max.occurredAt) {
        map.set(row.deviceId, row._max.occurredAt);
      }
    }
    return map;
  }
}
