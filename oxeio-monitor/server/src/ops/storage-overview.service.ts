import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { humanBytes } from '../alerts/alerts.rules';
import { storageRoot } from '../common/storage.config';
import { PrismaService } from '../prisma/prisma.service';
import { SCREENSHOT_RETENTION_DAYS } from '../summary/retention.job';

export interface StorageOverview {
  checkedAt: string;
  categories: {
    screenshots: { bytes: number; display: string; files: number };
    backups: { bytes: number; display: string; files: number };
    database: { bytes: number; display: string };
    otherStorage: { bytes: number; display: string; files: number };
    docker: { available: false; reason: string };
  };
  retention: {
    screenshotDays: number;
    activeRows: number;
    awaitingPurge: number;
    eligibleNow: number;
    oldestCapturedAt: string | null;
  };
  growth: { available: false; reason: string };
}

@Injectable()
export class StorageOverviewService {
  private readonly root: string;
  private readonly backups: string;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.root = resolve(storageRoot(config));
    this.backups = resolve(config.get<string>('BACKUP_DIR') || join(this.root, '..', 'backups'));
  }

  async check(now = new Date()): Promise<StorageOverview> {
    const screenshotRoot = join(this.root, 'screenshots');
    const [screenshots, backups, storageTotal, databaseRows, retention] = await Promise.all([
      measureTree(screenshotRoot),
      measureTree(this.backups),
      measureTree(this.root),
      this.prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database())::bigint AS bytes`,
      this.retentionFacts(now),
    ]);
    const database = Number(databaseRows[0]?.bytes ?? 0n);
    const otherBytes = Math.max(0, storageTotal.bytes - screenshots.bytes);
    const otherFiles = Math.max(0, storageTotal.files - screenshots.files);

    return {
      checkedAt: now.toISOString(),
      categories: {
        screenshots: view(screenshots),
        backups: view(backups),
        database: { bytes: database, display: humanBytes(database) },
        otherStorage: { bytes: otherBytes, display: humanBytes(otherBytes), files: otherFiles },
        docker: {
          available: false,
          reason: 'Docker images and build cache are host-only; the API has no Docker socket access.',
        },
      },
      retention,
      growth: {
        available: false,
        reason: 'Growth starts after daily storage snapshots are enabled.',
      },
    };
  }

  private async retentionFacts(now: Date) {
    const cutoff = new Date(now.getTime() - SCREENSHOT_RETENTION_DAYS * 86_400_000);
    const [activeRows, awaitingPurge, eligibleNow, oldest] = await Promise.all([
      this.prisma.screenshot.count({ where: { deletedAt: null } }),
      this.prisma.screenshot.count({ where: { deletedAt: { not: null } } }),
      this.prisma.screenshot.count({ where: { deletedAt: null, capturedAt: { lt: cutoff } } }),
      this.prisma.screenshot.findFirst({ where: { deletedAt: null }, orderBy: { capturedAt: 'asc' }, select: { capturedAt: true } }),
    ]);
    return {
      screenshotDays: SCREENSHOT_RETENTION_DAYS,
      activeRows,
      awaitingPurge,
      eligibleNow,
      oldestCapturedAt: oldest?.capturedAt.toISOString() ?? null,
    };
  }
}

async function measureTree(root: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (!dir) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        try {
          bytes += (await stat(path)).size;
          files += 1;
        } catch { /* file changed during scan */ }
      }
    }
  }
  return { bytes, files };
}

function view(value: { bytes: number; files: number }) {
  return { ...value, display: humanBytes(value.bytes) };
}
