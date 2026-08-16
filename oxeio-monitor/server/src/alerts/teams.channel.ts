import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { teamsCard } from './teams.card';

export type TeamsOutcome = 'sent' | 'not_configured' | 'failed';

/**
 * **Microsoft Teams চ্যানেল** — সাপ্তাহিক সারাংশ অফিসের চ্যানেলে।
 *
 * ⭐ গড়নটা <see cref="TelegramChannel"/>-এর হুবহু একই: একটা ঠিকানা, একটা
 * POST, আর কখনো throw না করা। নতুন স্থাপত্য নয়, আরেকটা চ্যানেল।
 *
 * ⚠️⚠️ **কনফিগ না থাকলে চুপচাপ বন্ধ, ক্র্যাশ নয়** — কিন্তু চালুর সময়
 * একবার লগে লেখা হয়। নইলে ছয় মাস পরে কেউ "Teams-এ কিছু আসছে না কেন"
 * খুঁজতে বসত, আর উত্তরটা `.env`-এ লুকিয়ে থাকত।
 */
@Injectable()
export class TeamsChannel {
  private readonly logger = new Logger(TeamsChannel.name);
  private readonly webhook: string;

  /**
   * ⚠️ পাঠানোর জন্য অপেক্ষা কতক্ষণ। সাপ্তাহিক জব রাতে চলে, তাই ধীর হলেও
   * ক্ষতি নেই — কিন্তু **সীমা ছাড়া রাখা যাবে না**, নইলে Teams সাড়া না
   * দিলে জবটা চিরকাল ঝুলে থাকত আর পরের সপ্তাহের জবও চলত না।
   */
  private static readonly TimeoutMs = 15_000;

  constructor(config: ConfigService) {
    this.webhook = config.get<string>('TEAMS_WEBHOOK_URL')?.trim() ?? '';

    if (!this.configured) {
      this.logger.log('No TEAMS_WEBHOOK_URL — Teams channel disabled');
    }
  }

  get configured(): boolean {
    /**
     * ⚠️ শুধু "খালি নয়" নয়, **https-ও** — ভুল করে http বসালে সারাংশটা
     * (কর্মীর নাম ও ঘণ্টা) প্লেইনটেক্সটে যেত। এটা নীরবে হতে দেওয়া যায় না,
     * তাই এখানেই আটকানো।
     */
    return this.webhook.startsWith('https://');
  }

  /**
   * এক দফা পাঠানো। ⚠️ **কখনো throw করে না** — সাপ্তাহিক জবটা এর উপর
   * দাঁড়িয়ে, আর Teams বন্ধ থাকা মানে হিসাব হারানো নয়।
   */
  async send(title: string, text: string): Promise<TeamsOutcome> {
    if (!this.configured) return 'not_configured';

    try {
      const res = await fetch(this.webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(teamsCard(title, text)),
        signal: AbortSignal.timeout(TeamsChannel.TimeoutMs),
      });

      /**
       * ⚠️⚠️ **২০০ মানেই পৌঁছেছে নয়।** Power Automate কার্ডের গড়ন ভুল হলেও
       * ২০০ ফেরত দেয়, আর চ্যানেলে কিছুই দেখা যায় না — নীরব ব্যর্থতা।
       * তাই গড়নটা `teams.card.ts`-এ খাঁটি রেখে **টেস্টে বাঁধা** হয়েছে;
       * এখানে শুধু HTTP স্তরটা দেখা যায়, আর সেটাই সৎভাবে বলা হচ্ছে।
       */
      if (!res.ok) {
        this.logger.warn(`Teams refused the message — HTTP ${res.status}`);
        return 'failed';
      }

      return 'sent';
    } catch (err) {
      // ⚠️ টাইমআউট, DNS, সার্ট — সবই এখানে। বার্তাটা হারায় না, কারণ
      //    কলার ব্যর্থ হলে পুরো লেখাটা লগে রাখে।
      this.logger.warn(
        `Could not reach Teams: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  }
}
