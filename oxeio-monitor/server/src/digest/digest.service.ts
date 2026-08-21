import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { dhakaClock, workDateOf } from '../agent/util/dhaka-time';
import { AlertMailer, type SendOutcome } from '../alerts/alerts.mailer';
import { TelegramChannel } from '../alerts/telegram.channel';
import { PrismaService } from '../prisma/prisma.service';
import { monthBoundsOf, toIsoDate } from '../reports/reports.range';
import { ReportsService } from '../reports/reports.service';
import { buildDigest, digestBody, digestSubject, type Digest } from './digest.math';
import { asPreBlock, telegramDigest } from './digest.telegram';

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
    private readonly telegram: TelegramChannel,
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
     * ⭐⭐ **টেলিগ্রামেও** — মালিকের চাওয়া: *"telegram e staff der daily
     * kajer report cai, ke kaj korche ke kaj korche na."*
     *
     * ⚠️ ইমেইলের **বিকল্প নয়, পাশাপাশি**। যেটা কনফিগ করা আছে সেটাই পায়;
     * SMTP না থাকলেও (এখন যেমন) টেলিগ্রামে চলে যাবে।
     *
     * ⚠️⚠️ **সাপ্তাহিকের গ্রুপ-প্রহরীটা এখানে নেই** — ইচ্ছাকৃত নয়,
     * বরং এটাই সঠিক: `TelegramChannel.send()` নিজেই কনফিগ করা চ্যাটে
     * পাঠায়, আর সেই চ্যাটটা মালিক নিজে বেছেছেন। সাপ্তাহিকে বাড়তি
     * প্রহরীটা ছিল কারণ ওটা **অনেক বেশি বিস্তারিত** (প্রতিটা কর্মীর
     * সপ্তাহভর ঘণ্টা); দৈনিকটা সংক্ষিপ্ত সারাংশ।
     */
    /**
     * ⚠️⚠️ **টেলিগ্রামে ইমেইলের বডি আর যায় না** *(১৮ আগস্ট)*। আগে হুবহু
     * ওটাই যেত — সব কর্মীর এক তালিকা + আট লাইনের "How to read these
     * numbers"। ফোনে সেটা একটা ধূসর দেয়াল, আর মালিকের দুটো প্রশ্ন
     * (*কে কত ঘণ্টা*, *কে টার্গেট ছুঁল*) ওর ভেতরে হারিয়ে যেত।
     *
     * ⭐ ইমেইলটা **অপরিবর্তিত** — ওখানে বিস্তারিত ব্যাখ্যাটা ঠিক আছে।
     * দুই মাধ্যমের দুই চেহারা, কিন্তু সংখ্যা একই `Digest` থেকে, তাই
     * কোনোদিন দুটো আলাদা কথা বলবে না।
     */
    const plain = telegramDigest(digest, this.orgName, {
      silentPcs: await this.silentPcsToday(now),
      atTime: dhakaClock(now),
      designs: await this.designsToday(digest.workDate),
    });

    const telegramOutcome = await this.telegram.sendHtml(asPreBlock(plain), plain);

    if (telegramOutcome === 'sent') {
      this.logger.log('Daily digest also sent to Telegram');
    } else if (telegramOutcome === 'failed') {
      this.logger.warn('Daily digest could not be sent to Telegram — see the body below');
    }

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
        `Digest sent · ${digest.workDate} · ` +
          `${digest.totals.employees} staff · ${digest.behind.length} behind · ` +
          `${recipients.length} recipients`,
      );
    } else {
      this.logger.warn(
        `Digest was not emailed (${outcome}) — full summary below:\n${subject}\n${body}`,
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

  /**
   * আজ কর্মঘণ্টায় কতগুলো **আলাদা** PC চুপ ছিল।
   *
   * ⚠️⚠️ **আলাদা PC গোনা হয়, অ্যালার্ট নয়।** একটা মেশিন দিনে পাঁচবার
   * চুপ হলে পাঁচটা সারি তৈরি হয় — সেগুলো গুনলে সংখ্যাটা আতঙ্কজনক
   * দেখাত অথচ সমস্যা একটাই। `DISTINCT device_id`-ই এখানে সত্যি।
   *
   * ⚠️ কখনো throw করে না — এই এক লাইনের জন্য পুরো রিপোর্ট আটকানো যাবে না।
   */
  private async silentPcsToday(now: Date): Promise<number> {
    try {
      const since = new Date(now.getTime() - 24 * 3_600_000);
      const rows = await this.prisma.alert.findMany({
        where: {
          type: 'agent_down',
          createdAt: { gte: since },
          deviceId: { not: null },
        },
        select: { deviceId: true },
        distinct: ['deviceId'],
      });

      return rows.length;
    } catch (err) {
      this.logger.warn(
        `Could not count silent PCs: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /**
   * ⭐ আজ কে কতগুলো ডিজাইন করেছেন — `empCode` ধরে *(২১ আগস্ট)*।
   *
   * ⚠️⚠️ **কেবল `staff_type = 'designer'`**, আর কেবল টার্গেট চালু থাকলে।
   * সবাইকে ধরলে গবেষকেরা রোজ "০/২৫" হয়ে তালিকায় উঠতেন — অভিযোগ, তথ্য নয়।
   *
   * ⚠️ কখনো throw করে না — ডিজাইনের সংখ্যা বাড়তি মাপ; ওটার জন্য গোটা
   * দৈনিক রিপোর্ট আটকে যাওয়া চলবে না।
   */
  private async designsToday(
    workDate: string,
  ): Promise<Map<string, { done: number; target: number }>> {
    const out = new Map<string, { done: number; target: number }>();

    try {
      const designers = await this.prisma.employee.findMany({
        where: { status: 'active', staffType: 'designer' },
        select: {
          id: true,
          empCode: true,
          policy: { select: { dailyDesignTarget: true } },
        },
      });
      if (designers.length === 0) return out;

      const counts = await this.prisma.designCredit.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: designers.map((d) => d.id) },
          firstWorkDate: new Date(`${workDate}T00:00:00.000Z`),
        },
        _count: { _all: true },
      });
      const byId = new Map(counts.map((c) => [c.employeeId, c._count._all]));

      for (const d of designers) {
        const target = d.policy?.dailyDesignTarget ?? 0;
        // ⚠️ টার্গেট ০ = বন্ধ, তখন সারিটাই দেখানো হয় না
        if (target > 0) out.set(d.empCode, { done: byId.get(d.id) ?? 0, target });
      }
    } catch (err) {
      this.logger.warn(
        `Could not count designs: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return out;
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
      /**
       * ⭐⭐ প্রত্যাশা F02-র **meta** থেকে, সারি থেকে নয়। সারিতে আছে
       * "মাসের ১ তারিখ → আজ"-এর টার্গেট; meta-তে আছে ঠিক সেই জানালার
       * হিসাব যেটা tray, Live Board আর Monthly পাতা ব্যবহার করে
       * (ট্র্যাকিং শুরু → গতকাল)। এখানে সারি থেকে বিয়োগ করে বানালে
       * ইমেইল আর ড্যাশবোর্ড একই কর্মীর নামে দু-রকম ঘাটতি বলত।
       */
      expectedHours: month.meta.expectedHours,
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
