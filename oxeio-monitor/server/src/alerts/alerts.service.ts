import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AlertSeverity, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { type AlertType } from './alerts.constants';
import type { ListAlertsDto } from './alerts.dto';
import {
  dedupeKey,
  suppressFlood,
  throttleFloor,
  type AlertKey,
} from './alerts.rules';

export interface RaiseInput extends AlertKey {
  severity: AlertSeverity;
  title: string;
  detail?: string;
  meta?: Prisma.InputJsonValue;
}

export interface AlertRow {
  /**
   * ⚠️ স্ট্রিং, সংখ্যা নয়। `alerts.id` হলো BIGSERIAL, আর Prisma সেটা `bigint`
   *    হিসেবে ফেরত দেয় — `JSON.stringify(1n)` সরাসরি TypeError ছোড়ে।
   *    app.setup.ts-এ BigInt-এর কোনো গ্লোবাল সিরিয়ালাইজার বসানো নেই, তাই
   *    এখানে হাতে না বদলালে প্রতিটা রিকোয়েস্ট ৫০০ হতো।
   */
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  deviceId: number | null;
  deviceHostname: string | null;
  employeeId: number | null;
  employeeName: string | null;
  meta: Prisma.JsonValue;
  channelsSent: string[];
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
}

export interface AlertPage {
  total: number;
  page: number;
  limit: number;
  /** এখনো acknowledge হয়নি এমন কতগুলো আছে — ফিল্টার যাই হোক */
  openCount: number;
  rows: AlertRow[];
}

const DEFAULT_LIMIT = 50;

const ROW_SELECT = {
  id: true,
  type: true,
  severity: true,
  title: true,
  detail: true,
  deviceId: true,
  employeeId: true,
  meta: true,
  channelsSent: true,
  acknowledgedAt: true,
  createdAt: true,
  device: { select: { hostname: true } },
  employee: { select: { fullName: true } },
  acknowledgedBy: { select: { fullName: true } },
} satisfies Prisma.AlertSelect;

type AlertWithNames = Prisma.AlertGetPayload<{ select: typeof ROW_SELECT }>;

/**
 * G01–G07 — অ্যালার্ট তৈরি, তালিকা আর acknowledge।
 *
 * ⭐ অ্যালার্ট বসানোর **একমাত্র** দরজা `raiseMany()`। প্রতিটা চেক নিজে
 * `prisma.alert.create()` ডাকলে throttle-টা প্রতিটা চেকে আলাদা করে লিখতে হতো,
 * আর একটা জায়গায় ভুল হলেই ওই কারণটা রাতারাতি শত শত অ্যালার্ট বানাত।
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** একটা অ্যালার্ট — ফেরত `true` মানে সত্যিই বসেছে, `false` মানে throttle-এ আটকেছে */
  async raise(input: RaiseInput, now = new Date()): Promise<boolean> {
    return (await this.raiseMany([input], now)) === 1;
  }

  /**
   * ⭐ বন্যা ঠেকানোর একমাত্র জায়গা।
   *
   * ⚠️ `clock_drift` এখানে দিয়ে বসানো হয় **না** — ওটা
   *    src/agent/clock-drift.service.ts ইতিমধ্যেই বসায় (নিজস্ব throttle সহ)।
   *    দুই জায়গা থেকে বসালে একই ঘটনার দুটো অ্যালার্ট হতো, আর দুটোই
   *    আলাদাভাবে acknowledge করতে হতো। ওই অ্যালার্টগুলো আমরা শুধু
   *    **পাঠাই** (AlertDispatcher), তৈরি করি না।
   */
  async raiseMany(inputs: readonly RaiseInput[], now = new Date()): Promise<number> {
    if (inputs.length === 0) return 0;

    const types = [...new Set(inputs.map((i) => i.type))];
    const recent = await this.prisma.alert.findMany({
      where: { type: { in: types }, createdAt: { gte: throttleFloor(now) } },
      select: {
        type: true,
        deviceId: true,
        employeeId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const lastRaisedByKey = new Map<string, Date>();
    for (const row of recent) {
      const key = dedupeKey({
        type: row.type as AlertType,
        deviceId: row.deviceId,
        employeeId: row.employeeId,
      });
      // orderBy desc — প্রথমবার যেটা পাই সেটাই সর্বশেষ
      if (!lastRaisedByKey.has(key)) lastRaisedByKey.set(key, row.createdAt);
    }

    const kept = suppressFlood(inputs, lastRaisedByKey, now);
    const suppressed = inputs.length - kept.length;
    if (kept.length === 0) {
      this.logger.debug(`${suppressed}টি অ্যালার্ট throttle-এ আটকেছে`);
      return 0;
    }

    await this.prisma.alert.createMany({
      data: kept.map((k) => ({
        type: k.type,
        severity: k.severity,
        deviceId: k.deviceId ?? null,
        employeeId: k.employeeId ?? null,
        title: k.title,
        detail: k.detail ?? null,
        meta: k.meta,
        // ⚠️ খালি — পাঠানোর কাজটা AlertDispatcher করে। এখানে ইমেইল পাঠালে
        //    SMTP ধীর হলে চেকগুলোও ধীর হয়ে যেত।
        channelsSent: [],
      })),
    });

    this.logger.warn(
      `${kept.length}টি নতুন অ্যালার্ট: ${kept.map((k) => k.type).join(', ')}` +
        (suppressed > 0 ? ` (${suppressed}টি throttle-এ আটকেছে)` : ''),
    );

    return kept.length;
  }

  async list(query: ListAlertsDto): Promise<AlertPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const where: Prisma.AlertWhereInput = {
      ...(query.status === 'all' ? {} : { acknowledgedAt: null }),
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
    };

    const [total, openCount, rows] = await Promise.all([
      this.prisma.alert.count({ where }),
      this.prisma.alert.count({ where: { acknowledgedAt: null } }),
      this.prisma.alert.findMany({
        where,
        select: ROW_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { total, page, limit, openCount, rows: rows.map(toRow) };
  }

  /**
   * ⭐ acknowledge করা idempotent, আর **প্রথমজনের নামই থেকে যায়**।
   *
   * দ্বিতীয়বার ডাকলে নতুন নাম বসিয়ে দিলে "কে আসলে সাড়া দিয়েছিল" তথ্যটা
   * নীরবে মুছে যেত — অথচ অ্যালার্টের গোটা উদ্দেশ্যই ওই জবাবদিহি।
   */
  async acknowledge(rawId: string, userId: number): Promise<AlertRow> {
    const id = parseAlertId(rawId);

    const existing = await this.prisma.alert.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('এমন কোনো অ্যালার্ট নেই');

    await this.prisma.alert.updateMany({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedById: userId, acknowledgedAt: new Date() },
    });

    const updated = await this.prisma.alert.findUniqueOrThrow({
      where: { id },
      select: ROW_SELECT,
    });
    return toRow(updated);
  }
}

/**
 * ⚠️ `ParseIntPipe` ব্যবহার করা হয়নি — আইডি BIGINT, আর `Number` ৯,০০৭
 * ট্রিলিয়নের পরে নীরবে ভুল মান দেয়। বাস্তবে এত অ্যালার্ট হবে না, কিন্তু
 * "বাস্তবে হবে না" ধরে নিয়ে লেখা কোডই পরে সবচেয়ে অদ্ভুত বাগ বানায়।
 */
function parseAlertId(raw: string): bigint {
  if (!/^\d{1,19}$/.test(raw)) {
    throw new BadRequestException('অ্যালার্ট আইডি ঠিক নেই');
  }
  return BigInt(raw);
}

function toRow(a: AlertWithNames): AlertRow {
  return {
    id: a.id.toString(),
    type: a.type,
    severity: a.severity,
    title: a.title,
    detail: a.detail,
    deviceId: a.deviceId,
    deviceHostname: a.device?.hostname ?? null,
    employeeId: a.employeeId,
    employeeName: a.employee?.fullName ?? null,
    meta: a.meta,
    channelsSent: a.channelsSent,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: a.acknowledgedBy?.fullName ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}
