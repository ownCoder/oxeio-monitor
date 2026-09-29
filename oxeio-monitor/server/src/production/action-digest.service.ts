import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { TelegramChannel } from '../alerts/telegram.channel';
import { PrismaService } from '../prisma/prisma.service';
import { SCHEDULING_ENABLED, JOB_TIMEZONE } from '../summary/scheduling';
import { QUEUES, queueWhere, WAIT_FIELD } from './production.rules';
import { UPLOAD_QUEUE_FROM } from '../targets/targets.rules';

const KEY = 'production.digest.config';
export interface DigestConfig {
  enabled: boolean;
  staleHours: number;
}
@Injectable()
export class ActionDigestService {
  private readonly logger = new Logger(ActionDigestService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
  ) {}
  async config(): Promise<DigestConfig> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const stored = row?.value as Partial<DigestConfig> | undefined;
    return {
      enabled: stored?.enabled === true,
      staleHours: stored?.staleHours ?? 48,
    };
  }
  async save(userId: number, enabled: boolean, staleHours: number) {
    if (enabled) {
      const channel = await this.telegram.resolve();
      if (!channel || !/^[1-9]\d*$/.test(channel.chatId))
        throw new BadRequestException(
          'Configure a private owner Telegram chat in Settings first.',
        );
    }
    return this.prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { enabled, staleHours }, updatedById: userId },
      update: { value: { enabled, staleHours }, updatedById: userId },
    });
  }
  async preview(now = new Date()) {
    const config = await this.config();
    const cutoff = new Date(now.getTime() - config.staleHours * 3600000);
    const queues = await Promise.all(
      QUEUES.map(async (queue) => ({
        queue,
        count: await this.prisma.designTarget.count({
          where: {
            ...queueWhere(queue),
            [WAIT_FIELD[queue]]: {
              lt: cutoff,
              ...(queue === 'to_check' || queue === 'to_upload'
                ? { gte: new Date(`${UPLOAD_QUEUE_FROM}T00:00:00+06:00`) }
                : {}),
            },
          },
        }),
      })),
    );
    const overdue = await this.prisma.designTarget.count({
      where: { status: 'assigned', dueAt: { lt: now } },
    });
    const last = await this.prisma.setting.findUnique({
      where: { key: 'production.digest.last' },
    });
    const backup = await this.prisma.setting.findUnique({
      where: { key: 'ops.backup.state' },
    });
    const backupState = backup?.value as
      { lastOutcome?: string; lastCopyOutcome?: string } | undefined;
    const backupFailed =
      backupState?.lastOutcome === 'failed' ||
      backupState?.lastCopyOutcome === 'failed';
    return {
      config,
      queues,
      overdue,
      backupFailed,
      actionable:
        backupFailed || overdue > 0 || queues.some((q) => q.count > 0),
      last: last?.value ?? null,
    };
  }
  @Cron('0 45 18 * * *', {
    name: 'production-action-digest',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled() {
    if (!SCHEDULING_ENABLED) return;
    try {
      await this.runOnce();
    } catch {
      this.logger.error('Action digest failed; inspect job status.');
    }
  }
  async runOnce(now = new Date()) {
    const preview = await this.preview(now);
    if (!preview.config.enabled) return { outcome: 'disabled' };
    const channel = await this.telegram.resolve();
    if (!channel || !/^[1-9]\d*$/.test(channel.chatId))
      return { outcome: 'not_configured' };
    const day = new Date(now.getTime() + 6 * 3600000)
      .toISOString()
      .slice(0, 10);
    return this.prisma.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(730942) AS locked`;
        if (!lock[0].locked) return { outcome: 'busy' };
        const key = `production.digest.day.${day}`;
        const prior = await tx.setting.findUnique({ where: { key } });
        if (prior) return { outcome: 'already_processed' };
        const message = [
          `Production actions · ${day}`,
          `Overdue assigned work: ${preview.overdue}`,
          `Backup/copy failure: ${preview.backupFailed ? 'needs attention' : 'none recorded'}`,
          `Waiting over ${preview.config.staleHours}h (queues can overlap):`,
          ...preview.queues.map(
            (q) => `${q.queue.replaceAll('_', ' ')}: ${q.count}`,
          ),
          'https://hub.oxeio.com/production/board',
          ...(preview.backupFailed
            ? ['https://hub.oxeio.com/production/monitor']
            : []),
        ].join('\n');
        const outcome = preview.actionable
          ? await this.telegram.send(message)
          : 'quiet';
        const value: Prisma.InputJsonValue = { at: now.toISOString(), outcome };
        await tx.setting.upsert({
          where: { key: 'production.digest.last' },
          create: { key: 'production.digest.last', value },
          update: { value },
        });
        if (outcome === 'sent' || outcome === 'quiet')
          await tx.setting.create({ data: { key, value } });
        return { outcome };
      },
      { timeout: 30000 },
    );
  }
}
