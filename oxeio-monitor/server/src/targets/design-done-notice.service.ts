import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TelegramChannel } from '../alerts/telegram.channel';
import { PrismaService } from '../prisma/prisma.service';
import {
  DESIGN_DONE_TELEGRAM_ENV,
  DESIGN_DONE_TELEGRAM_SETTING_KEY,
  designDoneEnvRecognized,
  designDoneMessage,
  designDoneTelegramEnabled,
  designUndoneMessage,
  noticeForLatest,
  type DesignNoticeFacts,
} from './design-done-notice.rules';

/**
 * ডিজাইন শেষ হলে মালিকের সেই টেলিগ্রাম চ্যাটে একটা বার্তা — যেখানে
 * "oXeio Monitoring" অ্যালার্ট যায়। নতুন বট বা নতুন চ্যাট নয়।
 *
 * ⚠️ সেভের উত্তরের অপেক্ষায় থাকে না। টেলিগ্রাম বন্ধ, 429, বা এই
 * কোডের নিজের ত্রুটি — কোনোটাতেই Done সেভ ব্যর্থ হয় না।
 */
@Injectable()
export class DesignDoneNoticeService {
  private readonly logger = new Logger(DesignDoneNoticeService.name);
  /** এই প্রসেসে যে ইভেন্টের জন্য বার্তা হয়ে গেছে — রিট্রাই দ্বিতীয়বার পাঠায় না */
  private readonly sent = new Set<number>();
  private loggedSkip = false;
  private loggedEnv = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly telegram: TelegramChannel,
  ) {}

  /**
   * ট্রানজ্যাকশন কমিটের **পরে** ডাকতে হয়, যাতে ইতিহাসের সারি দেখা যায়।
   * কলার `await` করে না।
   */
  afterCommit(targetId: number): void {
    void this.notify(targetId);
  }

  async notify(targetId: number): Promise<void> {
    try {
      await this.deliver(targetId);
    } catch (err) {
      this.logger.error(
        `Design Telegram notice failed for target ${targetId}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  private async deliver(targetId: number): Promise<void> {
    if (!(await this.enabled())) return;

    const events = await this.prisma.designTargetEvent.findMany({
      where: { targetId },
      orderBy: { id: 'asc' },
      select: { id: true, action: true, recordedAt: true },
    });
    const latest = events[events.length - 1];
    const decision = noticeForLatest(events.map((event) => event.action));
    if (!latest || decision === 'none') return;
    if (this.sent.has(latest.id)) return;
    // ⚠️ পরের await-এর আগেই দাবি — দুটো সমান্তরাল কল একই ইভেন্ট দুবার পাঠাত
    this.sent.add(latest.id);

    const row = await this.prisma.designTarget.findUnique({
      where: { id: targetId },
      select: {
        asin: true,
        jobNumber: true,
        startedAt: true,
        completedAt: true,
        assignedTo: { select: { fullName: true } },
        completedBy: { select: { fullName: true } },
      },
    });
    if (!row) {
      this.logger.warn(
        `Design ${targetId} disappeared before the Telegram notice could be sent`,
      );
      return;
    }

    const facts: DesignNoticeFacts = {
      designerName: row.assignedTo?.fullName ?? '',
      markedByName: row.completedBy?.fullName ?? null,
      asin: row.asin,
      jobNumber: row.jobNumber,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      at: latest.recordedAt,
    };
    const text =
      decision === 'done'
        ? designDoneMessage(facts)
        : designUndoneMessage(facts);
    const outcome = await this.telegram.sendRespectingRetryAfter(text);
    if (outcome === 'sent') {
      this.logger.log(`Design ${decision} notice sent for target ${targetId}`);
      return;
    }
    if (outcome === 'not_configured') {
      if (!this.loggedSkip) {
        this.loggedSkip = true;
        this.logger.warn(
          'Design done notices are on, but Telegram has no bot token or chat id — nothing will be sent',
        );
      }
      return;
    }
    this.logger.error(
      `Design ${decision} notice for target ${targetId} was not delivered (${outcome})`,
    );
  }

  private async enabled(): Promise<boolean> {
    const envValue = this.config.get<string>(DESIGN_DONE_TELEGRAM_ENV);
    if (!this.loggedEnv && !designDoneEnvRecognized(envValue)) {
      this.loggedEnv = true;
      this.logger.warn(
        `${DESIGN_DONE_TELEGRAM_ENV} is not a recognized on/off value — leaving design done notices on`,
      );
    }

    try {
      const row = await this.prisma.setting.findUnique({
        where: { key: DESIGN_DONE_TELEGRAM_SETTING_KEY },
      });
      return designDoneTelegramEnabled(envValue, row?.value);
    } catch (err) {
      this.logger.warn(
        `Could not read ${DESIGN_DONE_TELEGRAM_SETTING_KEY}, using the env flag: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      return designDoneTelegramEnabled(envValue, null);
    }
  }
}
