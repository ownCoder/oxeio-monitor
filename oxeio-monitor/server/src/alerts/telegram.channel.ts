import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import {
  TELEGRAM_BATCH,
  TELEGRAM_CHANNEL_TAG,
  TELEGRAM_FAILED_TAG,
  TELEGRAM_MAX_AGE_HOURS,
  TELEGRAM_MAX_ATTEMPTS,
  TELEGRAM_TIMEOUT_MS,
} from '../ops/ops.constants';
import { telegramMessage, type TelegramAlertFacts } from '../ops/ops.rules';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ⚠️ ইচ্ছাকৃতভাবে **কম** কলাম। `title` বা `detail` এখানে আনাই হয় না —
 *    যা টেনে আনা হয় না, তা ভুল করে পাঠানোও যায় না।
 */
const SWEEP_SELECT = {
  id: true,
  type: true,
  severity: true,
  createdAt: true,
  channelsSent: true,
  device: { select: { hostname: true } },
} satisfies Prisma.AlertSelect;

type SweepAlert = Prisma.AlertGetPayload<{ select: typeof SWEEP_SELECT }>;

export type TelegramOutcome = 'sent' | 'not_configured' | 'failed';

/**
 * **G08** — অ্যালার্টের টেলিগ্রাম চ্যানেল।
 *
 * ⭐ **ইমেইলের প্রতিদ্বন্দ্বী নয়, দ্বিতীয় স্তর।** `AlertDispatcher` আগে
 * নিজের কাজ শেষ করে (`channels_sent` খালি থেকে `email`/`log`/`email_failed`
 * হয়), তারপর এই sweep ওই সারিগুলোর উপর দিয়ে যায় আর `telegram` চিহ্নটা
 * **যোগ** করে।
 *
 * ⚠️ ক্রমটা উল্টো করা যেত না। dispatcher তোলে ঠিক সেই সারিগুলো যেগুলোর
 *    `channels_sent` **খালি**, আর লেখার সময় সে পুরো অ্যারেটা বদলে দেয়
 *    (`channelsSent: [channel]`)। টেলিগ্রাম আগে চিহ্ন বসালে সারিটা আর
 *    খালি থাকত না — অ্যালার্টটা তখন কোনোদিন ইমেইলে যেত না, অথচ
 *    টেলিগ্রামে গেছে বলে সব ঠিক মনে হতো। ইমেইলই মূল চ্যানেল (owner-এর
 *    ইনবক্স, বিস্তারিত সহ); টেলিগ্রাম শুধু "এখনই তাকান" বলার জন্য।
 *
 * ⭐ **বার্তায় কী যায় সেটা `ops.rules.ts` ঠিক করে, এই ফাইল নয়।**
 * টেলিগ্রাম বাইরের সেবা — বার্তা ওদের সার্ভারে জমে, আর গ্রুপে যে-কেউ
 * থাকতে পারে। তাই অ্যালার্টের ফ্রি-টেক্সট কখনোই পাঠানো হয় না, শুধু
 * টাইপের লেবেল + হোস্টনেম + সময় (allowlist, `telegramLine`)।
 *
 * ⚠️ টোকেন বা chat id না থাকলে পুরো জিনিসটা **চুপচাপ বন্ধ** — SMTP-র
 *    মতোই। ক্র্যাশ নয়, প্রতি মিনিটে অভিযোগও নয়।
 */
@Injectable()
export class TelegramChannel {
  private readonly logger = new Logger(TelegramChannel.name);
  private readonly token: string;
  private readonly chatId: string;
  /** ⚠️ ইন-মেমরি, dispatcher-এর মতোই — রিস্টার্ট মানে কনফিগ ঠিক করা হয়েছে */
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
    this.chatId = config.get<string>('TELEGRAM_CHAT_ID')?.trim() ?? '';

    if (!this.configured) {
      this.logger.log(
        'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID নেই — টেলিগ্রাম চ্যানেল বন্ধ (G08)',
      );
    }
  }

  get configured(): boolean {
    return this.token.length > 0 && this.chatId.length > 0;
  }

  /**
   * এক দফা sweep — ফেরত দেয় কতগুলো অ্যালার্টের নিষ্পত্তি হলো।
   * ⚠️ কখনো throw করে না।
   */
  async runOnce(now = new Date()): Promise<number> {
    if (!this.configured) return 0;

    const pending = await this.prisma.alert.findMany({
      where: {
        // ⭐ ইমেইলের পালা শেষ হয়েছে এমন সারিই — বিস্তারিত কারণ ক্লাসের ডকে
        channelsSent: { isEmpty: false },
        NOT: {
          channelsSent: { hasSome: [TELEGRAM_CHANNEL_TAG, TELEGRAM_FAILED_TAG] },
        },
        createdAt: {
          gte: new Date(now.getTime() - TELEGRAM_MAX_AGE_HOURS * 3_600_000),
        },
      },
      select: SWEEP_SELECT,
      orderBy: { createdAt: 'asc' },
      take: TELEGRAM_BATCH,
    });

    if (pending.length === 0) return 0;

    const facts: TelegramAlertFacts[] = pending.map((a) => ({
      type: a.type,
      severity: a.severity,
      hostname: a.device?.hostname ?? null,
      createdAt: a.createdAt,
    }));

    const outcome = await this.send(telegramMessage(facts, now));

    if (outcome === 'sent') {
      await this.tag(pending, TELEGRAM_CHANNEL_TAG);
      for (const a of pending) this.attempts.delete(a.id.toString());
      return pending.length;
    }

    if (outcome === 'not_configured') return 0;

    return this.countFailures(pending);
  }

  /**
   * ⚠️ কখনো throw করে না, আর **কখনো URL লগ করে না** — URL-এর ভেতরেই
   *    bot টোকেন থাকে, আর ওই টোকেন হাতে পেলে যে-কেউ ওই গ্রুপে যা খুশি
   *    পাঠাতে পারে। Telegram-এর ত্রুটি বার্তাও মাঝে মাঝে URL ফিরিয়ে দেয়,
   *    তাই বার্তাটা থেকেও টোকেনটা ছেঁকে ফেলা হয়।
   */
  async send(text: string): Promise<TelegramOutcome> {
    if (!this.configured) return 'not_configured';

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            // ⚠️ কোনো parse_mode নেই — প্লেইন টেক্সট। Markdown দিলে
            //    হোস্টনেমের একটা `_` গোটা বার্তাটা ৪০০ করে দিত।
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(
          `টেলিগ্রাম পাঠানো যায়নি (HTTP ${res.status}): ${this.scrub(body).slice(0, 200)}`,
        );
        return 'failed';
      }

      return 'sent';
    } catch (err) {
      this.logger.error(
        `টেলিগ্রাম পাঠানো যায়নি: ${this.scrub(err instanceof Error ? err.message : 'অজানা ত্রুটি')}`,
      );
      return 'failed';
    }
  }

  /** ⚠️ পুরো অ্যারে বদলানো হয় না — আগেরটার সাথে **যোগ** করা হয় */
  private async tag(pending: SweepAlert[], tag: string): Promise<void> {
    for (const a of pending) {
      try {
        await this.prisma.alert.update({
          where: { id: a.id },
          data: { channelsSent: { set: [...a.channelsSent, tag] } },
        });
      } catch (err) {
        this.logger.warn(
          `channels_sent লেখা যায়নি (alert ${a.id}): ${err instanceof Error ? err.message : 'অজানা ত্রুটি'}`,
        );
      }
    }
  }

  private async countFailures(pending: SweepAlert[]): Promise<number> {
    const exhausted: SweepAlert[] = [];

    for (const a of pending) {
      const key = a.id.toString();
      const count = (this.attempts.get(key) ?? 0) + 1;
      this.attempts.set(key, count);
      if (count >= TELEGRAM_MAX_ATTEMPTS) exhausted.push(a);
    }

    if (exhausted.length === 0) return 0;

    for (const a of exhausted) this.attempts.delete(a.id.toString());
    await this.tag(exhausted, TELEGRAM_FAILED_TAG);
    this.logger.error(
      `${exhausted.length}টি অ্যালার্ট টেলিগ্রামে পাঠানো গেল না — হাল ছাড়া হলো ` +
        '(ইমেইলে যাওয়ার কথা ছিল, সেটা আলাদা)',
    );
    return exhausted.length;
  }

  /** টোকেনটা যেন কোনো লগ লাইনে না থাকে */
  private scrub(text: string): string {
    return this.token ? text.split(this.token).join('***') : text;
  }
}
