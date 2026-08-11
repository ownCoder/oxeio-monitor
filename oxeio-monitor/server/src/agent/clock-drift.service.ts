import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/** § ২ — 02-Workflow-এর তিন ধাপ */
export const DRIFT_IGNORE_SEC = 5;
export const DRIFT_ALERT_SEC = 300;

export interface Drift {
  /** server_time − client_time · ধনাত্মক = PC-র ঘড়ি পিছিয়ে */
  seconds: number;
  level: 'none' | 'corrected' | 'alert';
}

@Injectable()
export class ClockDriftService {
  private readonly logger = new Logger(ClockDriftService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * এজেন্টের ঘড়ি আর সার্ভারের ঘড়ির পার্থক্য।
   * `X-Client-Time` না এলে drift = 0 ধরা হয় (পুরোনো এজেন্ট)।
   */
  measure(clientTime: Date | null, serverTime = new Date()): Drift {
    if (!clientTime || Number.isNaN(clientTime.getTime())) {
      return { seconds: 0, level: 'none' };
    }

    const seconds = Math.round(
      (serverTime.getTime() - clientTime.getTime()) / 1000,
    );
    const abs = Math.abs(seconds);

    if (abs <= DRIFT_IGNORE_SEC) return { seconds: 0, level: 'none' };
    if (abs <= DRIFT_ALERT_SEC) return { seconds, level: 'corrected' };
    return { seconds, level: 'alert' };
  }

  /**
   * এজেন্টের ঘড়িতে মাপা সময়কে সার্ভারের সময়ে নিয়ে আসে।
   * ⚠️ সেগমেন্টের **দৈর্ঘ্য** এতে বদলায় না — সেটা এজেন্টের monotonic clock
   *    থেকে আসে, তাই ঘড়ি বদলালেও অটুট (§ ৩.২)।
   */
  correct(t: Date, drift: Drift): Date {
    return drift.seconds === 0 ? t : new Date(t.getTime() + drift.seconds * 1000);
  }

  /** ডিভাইসে drift-এর রেকর্ড রাখা, আর বেশি হলে অ্যালার্ট */
  async record(
    deviceId: number,
    employeeId: number | null,
    drift: Drift,
  ): Promise<void> {
    if (drift.level === 'none') return;

    const abs = Math.abs(drift.seconds);

    // "শুধু আগেরটার চেয়ে বড় হলে বসাও" — Prisma-র API-তে সরাসরি নেই, তাই raw
    await this.prisma.$executeRaw`
      UPDATE devices
         SET last_drift_sec = ${drift.seconds},
             max_drift_sec  = GREATEST(max_drift_sec, ${abs})
       WHERE id = ${deviceId}`;

    if (drift.level !== 'alert') return;

    // ⚠️ এজেন্ট প্রতি মিনিটেই ডেটা পাঠায় — প্রতিবার অ্যালার্ট বানালে
    // ঘড়ি ভুল থাকা একটা PC দিনে হাজারখানেক অ্যালার্ট তৈরি করত।
    // ৬ ঘণ্টায় একটাই, আর সেটা acknowledge না করা পর্যন্ত আর নয়।
    const recent = await this.prisma.alert.findFirst({
      where: {
        type: 'clock_drift',
        deviceId,
        acknowledgedAt: null,
        createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recent) return;

    this.logger.warn(
      `device ${deviceId} clock is off by ${drift.seconds}s — raising an alert`,
    );

    await this.prisma.alert.create({
      data: {
        type: 'clock_drift',
        severity: 'warning',
        deviceId,
        employeeId,
        title: 'PC clock is wrong',
        detail:
          `${Math.round(abs / 60)} minutes off from the server. ` +
          'Turn on Windows time sync (w32time) on that PC.',
        meta: { driftSec: drift.seconds },
        channelsSent: [],
      },
    });
  }
}
