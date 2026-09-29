import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/prisma/prisma.service';
import { MonitorService } from '../src/production/monitor.service';
const url = 'https://hc-ping.com/12345678-1234-1234-1234-123456789abc';
const now = new Date('2026-09-27T00:00:00Z');
afterEach(() => vi.unstubAllGlobals());
describe('independent job heartbeats', () => {
  function setup(backup: string, previous = {}, outcome = 'quiet') {
    const prisma = {
      setting: {
        findMany: vi.fn().mockResolvedValue([
          { key: 'ops.backup.state', value: { lastSuccessAt: backup } },
          {
            key: 'production.digest.last',
            value: { at: '2026-09-26T23:00:00Z', outcome },
          },
          { key: 'production.monitor.last', value: previous },
        ]),
        upsert: vi.fn(),
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, body: { cancel: vi.fn() } });
    vi.stubGlobal('fetch', fetch);
    const service = new MonitorService(
      prisma as unknown as PrismaService,
      new ConfigService({
        PRODUCTION_UPTIME_PING_URL: url,
        PRODUCTION_BACKUP_PING_URL: url,
        PRODUCTION_DIGEST_PING_URL: url,
      }),
    );
    return { service, prisma, fetch };
  }
  it('pings each new success once and never refreshes stale backup success', async () => {
    const { service, fetch } = setup('2026-09-20T00:00:00Z', {
      digest: '2026-09-26T23:00:00Z',
    });
    const result = await service.runOnce(now);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.uptime).toBe(now.toISOString());
    expect(result.backup).toBeUndefined();
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
  });
  it('does not record failed delivery or unsuccessful digest as healthy', async () => {
    const { service, fetch } = setup('2026-09-26T22:00:00Z', {}, 'failed');
    fetch.mockRejectedValue(new Error('network unavailable'));
    const result = await service.runOnce(now);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.uptime).toBeUndefined();
    expect(result.backup).toBeUndefined();
    expect(result.digest).toBeUndefined();
  });
  it('does not ping a healthy process when the database is unavailable', async () => {
    const { service, prisma, fetch } = setup('2026-09-26T22:00:00Z');
    prisma.setting.findMany.mockRejectedValue(new Error('database down'));
    await expect(service.runOnce(now)).rejects.toThrow('database down');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('only reports configuration flags, never secret ping URLs', async () => {
    const { service } = setup('2026-09-26T22:00:00Z');
    const status = await service.status();
    expect(status.uptimeConfigured).toBe(true);
    expect(JSON.stringify(status)).not.toContain(url);
  });
});
