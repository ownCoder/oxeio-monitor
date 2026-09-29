import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SCHEDULING_ENABLED } from '../summary/scheduling';

export function heartbeatUrl(value: string | undefined): string | null {
  if (!value) return null;
  // Fixed provider and UUID path; never accept redirects, arbitrary hosts or query credentials.
  if (
    !/^https:\/\/hc-ping\.com\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    return null;
  return value;
}
@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  async status() {
    const rows = await this.prisma.setting.findMany({
      where: {
        key: {
          in: [
            'ops.backup.state',
            'production.digest.last',
            'production.monitor.last',
          ],
        },
      },
    });
    const state = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      uptimeConfigured: !!heartbeatUrl(
        this.config.get<string>('PRODUCTION_UPTIME_PING_URL'),
      ),
      backupConfigured: !!heartbeatUrl(
        this.config.get<string>('PRODUCTION_BACKUP_PING_URL'),
      ),
      digestConfigured: !!heartbeatUrl(
        this.config.get<string>('PRODUCTION_DIGEST_PING_URL'),
      ),
      backup: state['ops.backup.state'] ?? null,
      digest: state['production.digest.last'] ?? null,
      heartbeats: state['production.monitor.last'] ?? null,
      restoreVerification:
        'Run the isolated restore drill and retain its evidence file; a successful backup alone does not verify restoration.',
    };
  }
  @Cron('0 */5 * * * *', {
    name: 'production-heartbeats',
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled() {
    if (!SCHEDULING_ENABLED) return;
    try {
      await this.runOnce();
    } catch {
      this.logger.error(
        'Independent heartbeat failed; check the external monitor.',
      );
    }
  }
  async runOnce(now = new Date()) {
    // Database failure prevents the uptime ping, so a running but broken API is not green.
    const state = await this.status();
    const backup = state.backup as { lastSuccessAt?: string } | null;
    const digest = state.digest as { at?: string; outcome?: string } | null;
    const previous = (state.heartbeats ?? {}) as Record<string, string>;
    const next = { ...previous };
    const observations = {
      uptime: now.toISOString(),
      backup: backup?.lastSuccessAt,
      digest:
        digest?.outcome === 'sent' || digest?.outcome === 'quiet'
          ? digest.at
          : undefined,
    };
    for (const [job, at] of Object.entries(observations)) {
      if (
        !at ||
        at === previous[job] ||
        now.getTime() - new Date(at).getTime() >
          (job === 'uptime' ? 600000 : 26 * 3600000)
      )
        continue;
      const url = heartbeatUrl(
        this.config.get<string>(`PRODUCTION_${job.toUpperCase()}_PING_URL`),
      );
      if (!url) continue;
      try {
        const response = await fetch(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) next[job] = at;
        await response.body?.cancel();
      } catch {
        this.logger.warn(`External ${job} heartbeat could not be delivered.`);
      }
    }
    const value: Record<string, string> = {
      ...next,
      observedAt: now.toISOString(),
    };
    await this.prisma.setting.upsert({
      where: { key: 'production.monitor.last' },
      create: { key: 'production.monitor.last', value },
      update: { value },
    });
    return value;
  }
}
