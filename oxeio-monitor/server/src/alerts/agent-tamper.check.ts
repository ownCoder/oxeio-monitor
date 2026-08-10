import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  SHUTDOWN_PAIR_WINDOW_MIN,
  TAMPER_EVENT_TYPES,
  TAMPER_LOOKBACK_MIN,
  UNINSTALL_EVENT_TYPES,
} from './alerts.constants';
import { isTamperStop, tamperSeverity, type StopEvent } from './alerts.rules';
import { AlertsService, type RaiseInput } from './alerts.service';

/** এক দফায় সর্বোচ্চ কত ইভেন্ট দেখা হবে — কিউ জমে গেলেও কুয়েরি ছোট থাকে */
const MAX_EVENTS_PER_RUN = 500;

/**
 * G02 — এজেন্ট বন্ধ বা আনইনস্টলের চেষ্টা।
 *
 * ⭐ এটাই একমাত্র চেক যেখানে **মিথ্যা অ্যালার্টকে** নীরবতার চেয়ে কম ক্ষতিকর
 * ধরা হয়েছে। বাকি সব চেকে সন্দেহ হলে চুপ থাকা হয়; এখানে সন্দেহ হলে বলা হয়।
 * কারণ চুপচাপ বন্ধ করে রাখা এজেন্ট মানে ওই দিনের ঘণ্টা কোথাও নেই — আর
 * সেটা কেউ টের পায় মাসের শেষে, যখন আর কিছু করার থাকে না।
 */
@Injectable()
export class AgentTamperCheck {
  private readonly logger = new Logger(AgentTamperCheck.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - TAMPER_LOOKBACK_MIN * 60_000);

    const stops = await this.prisma.event.findMany({
      where: {
        type: { in: [...TAMPER_EVENT_TYPES] },
        // ⚠️ `receivedAt`, `occurredAt` নয় — এজেন্ট অফলাইনে ইভেন্ট জমিয়ে রাখে,
        //    তাই তিন দিন আগের একটা agent_stop আজ এসে পৌঁছাতে পারে। ঘটনার
        //    সময় ধরে খুঁজলে ওই দেরিতে আসা ঘটনাগুলো কোনোদিনই ধরা পড়ত না।
        receivedAt: { gte: since },
        deviceId: { not: null },
      },
      select: {
        deviceId: true,
        employeeId: true,
        type: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'asc' },
      take: MAX_EVENTS_PER_RUN,
    });

    if (stops.length === 0) return 0;

    const context = await this.shutdownContext(stops);
    const tampered = stops.filter((s) =>
      isTamperStop(s as StopEvent, context),
    );
    if (tampered.length === 0) return 0;

    const hostnames = await this.hostnames(tampered.map((t) => t.deviceId));

    const inputs: RaiseInput[] = tampered.map((t) => {
      const host = hostnames.get(t.deviceId ?? -1) ?? `device #${t.deviceId}`;
      const uninstall = UNINSTALL_EVENT_TYPES.includes(t.type);

      return {
        type: 'agent_killed' as const,
        severity: tamperSeverity(t.type),
        deviceId: t.deviceId,
        employeeId: t.employeeId,
        title: uninstall
          ? `এজেন্ট আনইনস্টলের চেষ্টা — ${host}`
          : `এজেন্ট বন্ধ করা হয়েছে — ${host}`,
        detail: uninstall
          ? `${host}-এ এজেন্ট সরানোর চেষ্টা হয়েছে (${t.type})।`
          : `${host}-এ এজেন্ট থেমেছে, কিন্তু আশেপাশে কোনো logoff/shutdown নেই — ` +
            'অর্থাৎ PC চালু রেখেই এজেন্ট বন্ধ করা হয়েছে।',
        meta: {
          eventType: t.type,
          occurredAt: t.occurredAt.toISOString(),
          hostname: host,
        },
      };
    });

    this.logger.warn(`${inputs.length}টি সম্ভাব্য হস্তক্ষেপ পাওয়া গেছে`);
    return this.alerts.raiseMany(inputs, now);
  }

  /**
   * ওই ডিভাইসগুলোর logoff/shutdown ইভেন্ট, ঘটনার সময়ের আশপাশ থেকে।
   * এগুলোই ঠিক করে কোন agent_stop স্বাভাবিক আর কোনটা নয়।
   */
  private async shutdownContext(
    stops: readonly { deviceId: number | null; occurredAt: Date }[],
  ): Promise<StopEvent[]> {
    const deviceIds = [
      ...new Set(
        stops
          .map((s) => s.deviceId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const times = stops.map((s) => s.occurredAt.getTime());
    const pad = SHUTDOWN_PAIR_WINDOW_MIN * 60_000;

    const rows = await this.prisma.event.findMany({
      where: {
        deviceId: { in: deviceIds },
        type: { in: ['logoff', 'shutdown'] },
        occurredAt: {
          gte: new Date(Math.min(...times) - pad),
          lte: new Date(Math.max(...times) + pad),
        },
      },
      select: { deviceId: true, type: true, occurredAt: true },
    });

    return rows.map((r) => ({
      deviceId: r.deviceId,
      type: r.type,
      occurredAt: r.occurredAt,
    }));
  }

  private async hostnames(
    ids: readonly (number | null)[],
  ): Promise<Map<number, string>> {
    const wanted = ids.filter((id): id is number => id !== null);
    const devices = await this.prisma.device.findMany({
      where: { id: { in: wanted } },
      select: { id: true, hostname: true },
    });
    return new Map(devices.map((d) => [d.id, d.hostname]));
  }
}
