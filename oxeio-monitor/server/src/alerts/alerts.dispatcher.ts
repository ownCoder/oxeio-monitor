import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  DISPATCH_BATCH,
  DISPATCH_MAX_AGE_HOURS,
  MAX_EMAIL_ATTEMPTS,
} from './alerts.constants';
import { AlertMailer } from './alerts.mailer';
import { severityLabel } from './alerts.rules';

const PENDING_SELECT = {
  id: true,
  type: true,
  severity: true,
  title: true,
  detail: true,
  createdAt: true,
  device: { select: { hostname: true } },
  employee: { select: { fullName: true } },
} satisfies Prisma.AlertSelect;

type PendingAlert = Prisma.AlertGetPayload<{ select: typeof PENDING_SELECT }>;

/**
 * G07 — যেসব অ্যালার্ট এখনো কোনো চ্যানেলে যায়নি (`channels_sent` খালি),
 * সেগুলো তুলে নিয়ে ইমেইলে পাঠায়।
 *
 * ⭐ পাঠানোটা তৈরি করার জায়গা থেকে আলাদা রাখার তিনটে কারণ:
 *
 *  ১. **G05 আপনাআপনি ঢেকে যায়।** clock_drift অ্যালার্ট বসায়
 *     src/agent/clock-drift.service.ts, আমরা নই। সেটাও `channels_sent = {}`
 *     রেখে যায়, তাই এখান দিয়েই ইমেইলে চলে যায় — অথচ আমাদের কোথাও
 *     clock_drift **তৈরি** করতে হয় না (দুবার বসানোর ঝুঁকিই নেই)।
 *  ২. SMTP ধীর বা মৃত হলে সেটা যেন চেকগুলোকে ধীর না করে।
 *  ৩. পাঠানোর একটাই পথ থাকলে "এই অ্যালার্টটা ইমেইলে গিয়েছিল কি না" প্রশ্নের
 *     উত্তর সবসময় `channels_sent` কলামেই মেলে।
 */
@Injectable()
export class AlertDispatcher {
  private readonly logger = new Logger(AlertDispatcher.name);
  private readonly explicitRecipients: string[];
  /**
   * ⚠️ ইন-মেমরি, ইচ্ছাকৃতভাবে। সার্ভার রিস্টার্ট করলে গোনা শুরু থেকে হয় —
   *    আর সেটাই ঠিক আচরণ: রিস্টার্টের কারণ সাধারণত কনফিগ ঠিক করা।
   */
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: AlertMailer,
    config: ConfigService,
  ) {
    this.explicitRecipients = (config.get<string>('ALERT_EMAIL_TO') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** ফেরত দেয় কতগুলো অ্যালার্টের নিষ্পত্তি হলো (পাঠানো বা হাল ছাড়া) */
  async runOnce(now = new Date()): Promise<number> {
    const pending = await this.prisma.alert.findMany({
      where: {
        channelsSent: { isEmpty: true },
        createdAt: {
          gte: new Date(now.getTime() - DISPATCH_MAX_AGE_HOURS * 3_600_000),
        },
      },
      select: PENDING_SELECT,
      orderBy: { createdAt: 'asc' },
      take: DISPATCH_BATCH,
    });

    if (pending.length === 0) return 0;

    if (!this.mailer.configured) {
      return this.markLogged(pending);
    }

    const recipients = await this.recipients();
    // ⭐ পুরো ব্যাচ **একটাই** ইমেইলে। বারোটা PC একসাথে বন্ধ হলে বারোটা মেইল
    //    নয়, একটা মেইলে বারোটা লাইন — এটাই বন্যা ঠেকানোর শেষ স্তর।
    const outcome = await this.mailer.send(
      recipients,
      subjectFor(pending),
      bodyFor(pending),
    );

    if (outcome === 'sent') {
      await this.markSent(pending, 'email');
      for (const a of pending) this.attempts.delete(a.id.toString());
      return pending.length;
    }

    if (outcome === 'not_configured') {
      return this.markLogged(pending);
    }

    return this.countFailures(pending);
  }

  /**
   * SMTP নেই — অ্যালার্ট তবু হারায় না, লগে যায়।
   * ⚠️ `channels_sent`-এ `log` বসানো হয় যাতে পরের sweep-এ আবার একই জিনিস
   *    না তোলে; নইলে প্রতি মিনিটে একই লাইন লগে লেখা হতো আর আসল পেন্ডিং
   *    অ্যালার্টগুলো ওই ব্যাচেই আটকে থাকত।
   */
  private async markLogged(pending: PendingAlert[]): Promise<number> {
    for (const a of pending) {
      this.logger.warn(`[অ্যালার্ট] ${lineFor(a)}`);
    }
    await this.markSent(pending, 'log');
    return pending.length;
  }

  private async markSent(
    pending: PendingAlert[],
    channel: 'email' | 'log' | 'email_failed',
  ): Promise<void> {
    await this.prisma.alert.updateMany({
      where: { id: { in: pending.map((a) => a.id) } },
      data: { channelsSent: [channel] },
    });
  }

  /**
   * পাঠানো যায়নি — তিনবার চেষ্টার পর হাল ছাড়া হয়।
   *
   * ⚠️ অনন্তকাল চেষ্টা করলে একটা ভুল কনফিগ পুরো কিউ আটকে রাখত, আর তার
   *    পেছনে জমতে থাকা নতুন অ্যালার্টগুলো কোনোদিন সামনের সারিতে আসত না।
   */
  private async countFailures(pending: PendingAlert[]): Promise<number> {
    const exhausted: PendingAlert[] = [];

    for (const a of pending) {
      const key = a.id.toString();
      const count = (this.attempts.get(key) ?? 0) + 1;
      this.attempts.set(key, count);
      if (count >= MAX_EMAIL_ATTEMPTS) exhausted.push(a);
    }

    if (exhausted.length === 0) return 0;

    for (const a of exhausted) {
      this.logger.error(`[অ্যালার্ট · ইমেইল যায়নি] ${lineFor(a)}`);
      this.attempts.delete(a.id.toString());
    }
    await this.markSent(exhausted, 'email_failed');
    return exhausted.length;
  }

  /**
   * কার কাছে যাবে — `ALERT_EMAIL_TO` থাকলে সেটাই, নইলে সক্রিয় owner-দের ইমেইল।
   *
   * ⚠️ ম্যানেজারদের পাঠানো হয় না। অ্যালার্টে হোস্টনেম ও কর্মীর নাম থাকে, আর
   *    এই তালিকাটা owner-only endpoint-এর সমান জিনিস — ইমেইলে পাঠিয়ে
   *    role-এর দেয়ালটা ফাঁকি দেওয়া চলবে না।
   */
  private async recipients(): Promise<string[]> {
    if (this.explicitRecipients.length > 0) return this.explicitRecipients;

    const owners = await this.prisma.user.findMany({
      where: { role: 'owner', isActive: true },
      select: { email: true },
    });
    return owners.map((o) => o.email);
  }
}

function subjectFor(pending: PendingAlert[]): string {
  const worst = pending.some((a) => a.severity === 'critical')
    ? 'critical'
    : pending.some((a) => a.severity === 'warning')
      ? 'warning'
      : 'info';

  return pending.length === 1
    ? `[oXeio · ${severityLabel(worst)}] ${pending[0].title}`
    : `[oXeio · ${severityLabel(worst)}] ${pending.length}টি নতুন অ্যালার্ট`;
}

function bodyFor(pending: PendingAlert[]): string {
  const lines = pending.map((a) => `• ${lineFor(a)}`);
  return [
    'oXeio মনিটরিং সার্ভার থেকে:',
    '',
    ...lines,
    '',
    'ড্যাশবোর্ডের Alerts পাতায় গিয়ে acknowledge করলে এগুলো তালিকা থেকে সরে যাবে।',
  ].join('\n');
}

/** ⚠️ কখনো URL, উইন্ডোর টেক্সট বা ফাইলের নাম নয় — শুধু হোস্টনেম ও কর্মীর নাম */
function lineFor(a: PendingAlert): string {
  const who = [a.employee?.fullName, a.device?.hostname]
    .filter(Boolean)
    .join(' · ');
  const when = a.createdAt.toISOString();
  const detail = a.detail ? ` — ${a.detail}` : '';
  return `[${severityLabel(a.severity)}] ${a.title}${who ? ` (${who})` : ''}${detail} · ${when}`;
}
