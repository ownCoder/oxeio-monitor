import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { workDateOf } from '../agent/util/dhaka-time';
import { AlertMailer, type SendOutcome } from '../alerts/alerts.mailer';
import { PrismaService } from '../prisma/prisma.service';
import { monthBoundsOf, toIsoDate } from '../reports/reports.range';
import { ReportsService } from '../reports/reports.service';
import { buildDigest, digestBody, digestSubject, type Digest } from './digest.math';

/** লেটারহেড ও ইমেইলের শিরোনামে — `reports.service.ts`-এর সাথে একই env */
const DEFAULT_ORG_NAME = 'oXeio Monitoring';

export interface DigestResult {
  workDate: string;
  employees: number;
  behind: number;
  recipients: number;
  outcome: SendOutcome;
}

/**
 * **F07** — দৈনিক ডাইজেস্ট ইমেইল (সন্ধ্যা ৬:৩০, ঢাকা)।
 *
 * ⭐ সংখ্যাগুলো তৈরি হয় **`ReportsService` দিয়েই** — F01 (আজকের একদিন) আর
 * F02 (মাসের ১ তারিখ → আজ)। নিজে `daily_summary` পড়ে টার্গেট বের করলে
 * ছুটির ক্যালেন্ডার, সাপ্তাহিক ছুটি, যোগ/ছাড়ার তারিখ আর দৈনিক টার্গেটের
 * ভাগ — সবকটার একটা করে নতুন বাস্তবায়ন দাঁড়াত। তখন একদিন ইমেইল আর
 * রিপোর্ট দু-রকম ঘণ্টা বলত, আর মালিক দুটোর কোনোটাই আর বিশ্বাস করতেন না।
 *
 * ⚠️ এই ক্লাস **কখনো throw করে না বলে ধরে নেওয়া যাবে না** — `ReportsService`
 * active work policy না পেলে ৫০০ ছোড়ে। ডাইজেস্ট ব্যর্থ হলে সার্ভার নামা
 * চলবে না, তাই ব্যতিক্রম ধরা হয় `DigestJob`-এ (একটাই জায়গা, শিডিউলড
 * ডাক আর হাতে ডাক দুটোরই)।
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);
  private readonly orgName: string;
  private readonly explicitRecipients: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly mailer: AlertMailer,
    config: ConfigService,
  ) {
    this.orgName = config.get<string>('ORG_NAME')?.trim() || DEFAULT_ORG_NAME;

    // ⚠️ `ALERT_EMAIL_TO`-তে **ফেরত যাওয়া হয় না**। অ্যালার্ট আর ডাইজেস্ট
    //    দুটো আলাদা জিনিস: অ্যালার্ট "কিছু ভেঙেছে", ডাইজেস্ট "কে কত ঘণ্টা"।
    //    এক তালিকা ভাগ করলে যিনি শুধু সার্ভারের স্বাস্থ্য দেখেন তিনিও
    //    রোজ সবার ঘণ্টা পেয়ে যেতেন।
    this.explicitRecipients = (config.get<string>('DIGEST_EMAIL_TO') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async runOnce(now: Date = new Date()): Promise<DigestResult> {
    const digest = await this.collect(now);
    const recipients = await this.recipients();

    const subject = digestSubject(digest);
    const body = digestBody(digest, this.orgName);

    const outcome = await this.mailer.send(recipients, subject, body);

    /**
     * ⚠️ SMTP না থাকলে (বা পাঠানো না গেলে) **ক্র্যাশ নয়, লগ** — আর পুরো
     * বডিটাই লগে যায়, শুধু "পাঠানো গেল না" নয়। ইমেইল বন্ধ থাকা অবস্থায়ও
     * সংখ্যাগুলো যেন কোথাও থাকে; নইলে যেদিন SMTP ঠিক করা হবে সেদিন
     * পেছনের দিনগুলো চিরতরে হারিয়ে যেত।
     *
     * ⚠️ লগে যাওয়াটা নিরাপদ, কারণ বডিতে কেবল নাম ও ঘণ্টা — কোনো ডোমেইন,
     * অ্যাপের নাম বা স্ক্রিনশটের পথ নেই (`digest.math.ts` দেখুন)।
     */
    if (outcome === 'sent') {
      this.logger.log(
        `ডাইজেস্ট পাঠানো হয়েছে · ${digest.workDate} · ` +
          `${digest.totals.employees} জন · ${digest.behind.length} জন পিছিয়ে · ` +
          `${recipients.length} প্রাপক`,
      );
    } else {
      this.logger.warn(
        `ডাইজেস্ট ইমেইলে যায়নি (${outcome}) — নিচে পুরো সারাংশ:\n${subject}\n${body}`,
      );
    }

    return {
      workDate: digest.workDate,
      employees: digest.totals.employees,
      behind: digest.behind.length,
      recipients: recipients.length,
      outcome,
    };
  }

  /** ⭐ শুধু সংখ্যা — ইমেইল ছাড়াই টেস্ট বা ভবিষ্যতের কোনো প্রিভিউ ডাকতে পারে */
  async collect(now: Date = new Date()): Promise<Digest> {
    // ⚠️ "আজ" মানে **ঢাকার** আজ — সার্ভার UTC-তে চললে সন্ধ্যা ৬:৩০-এ
    //    `new Date()`-এর তারিখ ঠিকই থাকত, কিন্তু ধরে নেওয়াটা ভুল হতো
    //    এবং রাত ১১টার কোনো manual রানে একদিন পিছিয়ে যেত
    const today = workDateOf(now);
    const workDate = toIsoDate(today);
    const monthFrom = toIsoDate(monthBoundsOf(today).first);

    const [today1, month] = await Promise.all([
      this.reports.attendance({ from: workDate, to: workDate }),
      this.reports.summary({ from: monthFrom, to: workDate, groupBy: 'month' }),
    ]);

    return buildDigest({
      workDate,
      monthFrom,
      monthTo: workDate,
      today: today1.rows,
      month: month.rows,
    });
  }

  /**
   * কার কাছে যাবে — `DIGEST_EMAIL_TO` থাকলে সেটাই, নইলে সক্রিয় owner-রা।
   *
   * ⚠️ ম্যানেজারদের **ডিফল্টে পাঠানো হয় না**, যদিও তাঁরা ড্যাশবোর্ডে এই
   * সংখ্যাগুলো দেখতে পান (§ ৪.৩)। "দেখতে পারা" আর "রোজ ইনবক্সে পাওয়া"
   * এক নয় — ইমেইল ফরওয়ার্ড হয় ও আর্কাইভে থেকে যায়, আর কাকে পাঠানো হবে
   * সেটা প্রতিষ্ঠানের সিদ্ধান্ত। দরকার হলে `DIGEST_EMAIL_TO`-তে ঠিকানা
   * বসানো যায়; নিজে থেকে তালিকা বাড়িয়ে দিলে সেটা নীরবে নীতি হয়ে যেত।
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
