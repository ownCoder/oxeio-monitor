import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AlertMailer } from '../alerts/alerts.mailer';
import { TelegramChannel } from '../alerts/telegram.channel';
import { digestRecipients } from '../digest/digest.recipients';
import { PrismaService } from '../prisma/prisma.service';
import { XLSX_MIME } from './reports.download';
import {
  monthCaption,
  monthRange,
  monthReportName,
} from './month-delivery.rules';
import { ReportsService } from './reports.service';
import { summaryWorkbook } from './reports.sheets';

/**
 * **R26 — মাস বন্ধ হলে হিসাবের ফাইল নিজে থেকে চলে যায়।**
 *
 * ⭐⭐ আগে রিপোর্ট ছিল কেবল **অন-ডিমান্ড ডাউনলোড**, আর ডাইজেস্ট ছিল কেবল
 * **টেক্সট**। ফলে মাস বন্ধ করার পর মালিককে মনে করে পাতা খুলে, রেঞ্জ
 * বেছে, ফাইল নামাতে হতো — আর যেদিন ভুলে যেতেন, সেদিন ওই মাসের কোনো
 * স্থায়ী কপিই থাকত না।
 *
 * ⚠️⚠️ **এটা কখনো throw করে না, আর কখনো মাস বন্ধ হওয়া আটকায় না।**
 * `MonthCloseService.close()` এটাকে ডাকে fire-and-forget হিসেবে, commit-এর
 * পরে। কারণটা মাপা: একটা কয়েক-MB আপলোড ৬০ সেকেন্ড পর্যন্ত নিতে পারে, আর
 * সেটা await করলে মালিকের HTTP রিকোয়েস্ট ওতক্ষণ ঝুলত; throw করলে
 * **সম্পূর্ণ সফল** একটা মাস-বন্ধ ৫০০ হয়ে ফিরত, আর তিনি আবার চেষ্টা করে
 * ৪০৯ পেতেন ("মাস তো বন্ধই")।
 *
 * ⭐ **কোন রিপোর্ট যায়:** মাসের **সারাংশ** (ঘণ্টা), পে-রোল নয়।
 * ⚠️⚠️ এটা সচেতন সিদ্ধান্ত, অলসতা নয়: পে-রোলের শিটে **বেতন** থাকে, আর
 * টেলিগ্রামের বার্তা বাইরের একটা সেবার সার্ভারে জমে থাকে। বেতন ওখানে
 * পাঠানো মালিকের নিজের সিদ্ধান্ত হওয়া উচিত — কোড নিজে থেকে করে ফেলার
 * জিনিস নয়। দরকার হলে পরে একটা স্পষ্ট সেটিং দিয়ে যোগ করা যাবে।
 */
@Injectable()
export class MonthDeliveryService {
  private readonly logger = new Logger(MonthDeliveryService.name);
  private readonly orgName: string;
  private readonly digestEmailTo: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly telegram: TelegramChannel,
    private readonly mailer: AlertMailer,
    config: ConfigService,
  ) {
    this.orgName = config.get<string>('ORG_NAME')?.trim() || 'oXeio Monitoring';
    this.digestEmailTo = config.get<string>('DIGEST_EMAIL_TO')?.trim();
  }

  /**
   * এক মাসের ফাইল বানিয়ে যে চ্যানেলগুলো কনফিগার করা আছে সেগুলোয় পাঠায়।
   *
   * ফেরত দেয় কোথায় কী হলো — টেস্ট ও ভবিষ্যতের ops-পর্দার জন্য।
   * ⚠️ কখনো throw করে না; ভেতরের সবটুকু try/catch-এ মোড়া, তাই কল-সাইটের
   *    `.catch()` দ্বিতীয় জাল, একমাত্র জাল নয়।
   */
  async deliverClosedMonth(yearMonth: string): Promise<{
    telegram: 'sent' | 'not_configured' | 'failed' | 'skipped';
    email: 'sent' | 'not_configured' | 'failed' | 'skipped';
  }> {
    try {
      const { from, to } = monthRange(yearMonth);

      /**
       * ⚠️ `summaryFile()` নয়, `summary()` + `summaryWorkbook()`।
       *
       * ⭐⭐ কারণটা audit খাতার সততা: `*File()` ভেতরে `export_report` সারি
       * লেখে, আর তাতে একজন **ব্যবহারকারীর আইডি** লাগে। জব হিসেবে ডাকলে
       * ওখানে কারো নাম বসাতে হতো, আর খাতায় এমন একটা ডাউনলোড দেখাত যা
       * কোনো মানুষ করেনি — "কে আমার হিসাব দেখল" প্রশ্নের উত্তরটাই নষ্ট।
       */
      const report = await this.reports.summary({
        from,
        to,
        groupBy: 'month',
      });

      // ⚠️ সারি না থাকলে ফাইল পাঠানোর মানে নেই — খালি শিট পাঠালে সেটা
      //    "কেউ কাজ করেনি" বলে পড়ত, অথচ আসলে হয়তো ডেটাই নেই।
      if (report.rows.length === 0) {
        this.logger.warn(
          `${yearMonth} closed, but the summary has no rows — nothing was sent`,
        );
        return { telegram: 'skipped', email: 'skipped' };
      }

      const bytes = await summaryWorkbook(report);
      const filename = monthReportName(yearMonth, 'xlsx');

      const caption = monthCaption({
        orgName: this.orgName,
        yearMonth,
        people: new Set(report.rows.map((r) => r.employeeId)).size,
        totalHours: report.rows.reduce((sum, r) => sum + r.creditedHours, 0),
      });

      const telegram = await this.telegram.sendDocument(
        { bytes, filename, contentType: XLSX_MIME },
        caption,
      );

      const email = await this.emailIt(yearMonth, caption, bytes, filename);

      this.logger.log(
        `${yearMonth} report — telegram: ${telegram}, email: ${email} (${filename}, ${bytes.byteLength} bytes)`,
      );

      return { telegram, email };
    } catch (err) {
      // ⚠️ মাসটা ইতিমধ্যেই বন্ধ — এখানকার ব্যর্থতা সেটাকে ছোঁয় না
      this.logger.error(
        `Could not deliver the ${yearMonth} report: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      return { telegram: 'failed', email: 'failed' };
    }
  }

  /**
   * ⚠️ প্রাপক বাছাই `digestRecipients()` দিয়েই — **ম্যানেজাররা বাদ**।
   * এই ফাইলে প্রতিটা কর্মীর নাম ও ঘণ্টা আছে, আর সেটা owner-only পর্দার
   * সমান জিনিস; ইমেইলে পাঠিয়ে role-এর দেয়ালটা ফাঁকি দেওয়া চলবে না।
   */
  private async emailIt(
    yearMonth: string,
    body: string,
    bytes: Buffer,
    filename: string,
  ): Promise<'sent' | 'not_configured' | 'failed'> {
    if (!this.mailer.configured) return 'not_configured';

    const owners = await this.prisma.user.findMany({
      where: { role: 'owner', isActive: true },
      select: { email: true },
    });

    const to = digestRecipients({
      explicit: this.digestEmailTo,
      owners: owners.map((o) => o.email),
    });
    if (to.length === 0) return 'not_configured';

    return this.mailer.send(
      to,
      `${this.orgName} — ${yearMonth} closed`,
      body,
      [{ filename, content: bytes, contentType: XLSX_MIME }],
    );
  }
}
