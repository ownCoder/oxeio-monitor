import { statfs } from 'node:fs/promises';
import { parse, resolve } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { diskUsedPct, humanBytes } from '../alerts/alerts.rules';
import { storageRoot } from '../common/storage.config';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from './backup.service';
import { BackupStateStore } from './backup.state';
import { HEALTH_SILENCE_MIN } from './ops.constants';
import {
  backupVerdict,
  healthVerdict,
  type BackupVerdict,
  type HealthStatus,
} from './ops.rules';

export interface OpsHealth {
  status: HealthStatus;
  /** খালি অ্যারে = সব ঠিক */
  problems: string[];
  checkedAt: string;
  uptimeSec: number;

  db: { up: boolean; latencyMs: number | null };

  disk: {
    path: string;
    usedPct: number | null;
    freeBytes: number | null;
    totalBytes: number | null;
    free: string | null;
    total: string | null;
  };

  backup: {
    configured: boolean;
    copyConfigured: boolean;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastOutcome: 'ok' | 'failed' | null;
    lastError: string | null;
    lastFile: string | null;
    lastSizeBytes: number | null;
    lastSize: string | null;
    consecutiveFailures: number;
    hoursSinceSuccess: number | null;
    copyOutcome: 'ok' | 'failed' | null;
    copyError: string | null;
    /** ⭐ G04 যে verdict দেখে অ্যালার্ট করে, হুবহু সেটাই */
    problem: BackupVerdict['problem'] | null;
  };

  devices: {
    active: number;
    /** ⚠️ শুধু গোনা — status খারাপ করে না, কারণ রাতে সবাই চুপ থাকাই স্বাভাবিক */
    silent: number;
    silenceThresholdMin: number;
  };

  queue: {
    /** এখনো কোনো চ্যানেলে যায়নি */
    pendingAlerts: number;
    /** এখনো acknowledge হয়নি */
    openAlerts: number;
    /** retention মার্ক করেছে, ফাইল/সারি এখনো যায়নি */
    screenshotsAwaitingPurge: number;
  };
}

/**
 * **K04** — সার্ভারের বিস্তারিত হেলথ (owner-only)।
 *
 * ⭐ `src/health/` (`GET /api/v1/health`) ছোঁয়া হয়নি — ওটা **liveness**:
 * পাবলিক, ছোট, দ্রুত, আর Docker healthcheck ও Live Board ওটার উপরেই
 * দাঁড়ানো। এখানকার উত্তরে ডিস্কের আকার, ব্যাকআপের ইতিহাস আর কতগুলো
 * ডিভাইস চুপ — সবই এমন তথ্য যা দিয়ে বাইরের কেউ অফিসের ভেতরের ছবি আঁকতে
 * পারে। দুটোকে এক করলে হয় liveness-টা গোপন হয়ে যেত (তখন Docker আর
 * healthcheck করতে পারত না), নয়তো এই তথ্যগুলো পাবলিক হতো।
 */
@Injectable()
export class OpsHealthService {
  private readonly logger = new Logger(OpsHealthService.name);
  private readonly storageRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: BackupStateStore,
    private readonly backup: BackupService,
    config: ConfigService,
  ) {
    this.storageRoot = resolve(storageRoot(config));
  }

  async check(now = new Date()): Promise<OpsHealth> {
    const db = await this.pingDb();

    // ⚠️ DB পড়া না গেলে বাকি কুয়েরিগুলো চালানোর মানে নেই — ওগুলোও একই
    //    ত্রুটিতে ভাঙত, আর তখন হেলথ endpoint নিজেই ৫০০ দিত। ঠিক যে
    //    মুহূর্তে কেউ "সার্ভারের কী হলো" জানতে আসে, তখনই উত্তর না পাওয়া।
    const counts = db.up
      ? await this.counts(now)
      : { active: 0, silent: 0, pendingAlerts: 0, openAlerts: 0, awaitingPurge: 0 };

    const disk = await this.readDisk();
    const snapshot = await this.state.read(this.backup.configured);
    const verdict = backupVerdict(snapshot, now);

    const verdictSummary = healthVerdict({
      dbUp: db.up,
      diskUsedPct: disk.usedPct,
      backup: verdict,
      activeDevices: counts.active,
      silentDevices: counts.silent,
      pendingAlerts: counts.pendingAlerts,
    });

    return {
      status: verdictSummary.status,
      problems: verdictSummary.problems,
      checkedAt: now.toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      db,
      disk: {
        path: this.storageRoot,
        usedPct: disk.usedPct,
        freeBytes: disk.freeBytes,
        totalBytes: disk.totalBytes,
        free: disk.freeBytes === null ? null : humanBytes(disk.freeBytes),
        total: disk.totalBytes === null ? null : humanBytes(disk.totalBytes),
      },
      backup: {
        configured: snapshot.configured,
        copyConfigured: this.backup.copyTarget !== null,
        lastSuccessAt: snapshot.lastSuccessAt?.toISOString() ?? null,
        lastAttemptAt: snapshot.lastAttemptAt?.toISOString() ?? null,
        lastOutcome: snapshot.lastOutcome,
        lastError: snapshot.lastError,
        lastFile: snapshot.lastSuccessFile,
        lastSizeBytes: snapshot.lastSuccessBytes,
        lastSize:
          snapshot.lastSuccessBytes === null
            ? null
            : humanBytes(snapshot.lastSuccessBytes),
        consecutiveFailures: snapshot.consecutiveFailures,
        hoursSinceSuccess: verdict?.hoursSinceSuccess ?? hoursSince(snapshot.lastSuccessAt, now),
        copyOutcome: snapshot.lastCopyOutcome,
        copyError: snapshot.lastCopyError,
        problem: verdict?.problem ?? null,
      },
      devices: {
        active: counts.active,
        silent: counts.silent,
        silenceThresholdMin: HEALTH_SILENCE_MIN,
      },
      queue: {
        pendingAlerts: counts.pendingAlerts,
        openAlerts: counts.openAlerts,
        screenshotsAwaitingPurge: counts.awaitingPurge,
      },
    };
  }

  /** ⚠️ latency-টাও রাখা হয় — DB "উঠে আছে কিন্তু ৮ সেকেন্ড নেয়" অবস্থাটা
   *     `up: true` দিয়ে বোঝানো যায় না, অথচ ওটাই সবচেয়ে সাধারণ ধীরগতি। */
  private async pingDb(): Promise<{ up: boolean; latencyMs: number | null }> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { up: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
      this.logger.error(
        `Health: DB ping failed — ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return { up: false, latencyMs: null };
    }
  }

  private async counts(now: Date): Promise<{
    active: number;
    silent: number;
    pendingAlerts: number;
    openAlerts: number;
    awaitingPurge: number;
  }> {
    const silenceFloor = new Date(now.getTime() - HEALTH_SILENCE_MIN * 60_000);

    const [active, silent, pendingAlerts, openAlerts, awaitingPurge] =
      await Promise.all([
        this.prisma.device.count({ where: { status: 'active' } }),
        this.prisma.device.count({
          where: {
            status: 'active',
            // ⚠️ `lastSeenAt: null` ডিভাইসগুলোও চুপ — এনরোল হয়েও কখনো কিছু
            //    পাঠায়নি। G01 ওদের অ্যালার্ট করে না, কিন্তু হেলথে গোনা দরকার:
            //    "১৫টার মধ্যে ৩টা কোনোদিন কথাই বলেনি" — এটা ইনস্টলেশনের খবর।
            OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: silenceFloor } }],
          },
        }),
        this.prisma.alert.count({ where: { channelsSent: { isEmpty: true } } }),
        this.prisma.alert.count({ where: { acknowledgedAt: null } }),
        this.prisma.screenshot.count({ where: { deletedAt: { not: null } } }),
      ]);

    return { active, silent, pendingAlerts, openAlerts, awaitingPurge };
  }

  /**
   * ⚠️ `disk.check.ts`-এর সাথে একই কৌশল: `STORAGE_ROOT` না থাকলে ড্রাইভের
   *    রুট দেখা হয় (একই ভলিউম, একই সংখ্যা)। দুটোই ব্যর্থ হলে `null` —
   *    হেলথ পাতা তখন "ডিস্কের তথ্য পড়া যায়নি" বলে, ৫০০ দেয় না।
   */
  private async readDisk(): Promise<{
    usedPct: number | null;
    freeBytes: number | null;
    totalBytes: number | null;
  }> {
    for (const path of [this.storageRoot, parse(this.storageRoot).root]) {
      if (!path) continue;
      try {
        const fs = await statfs(path);
        const stats = {
          blocks: Number(fs.blocks),
          bfree: Number(fs.bfree),
          bavail: Number(fs.bavail),
          bsize: Number(fs.bsize),
        };
        return {
          usedPct: Math.round(diskUsedPct(stats) * 10) / 10,
          freeBytes: stats.bavail * stats.bsize,
          totalBytes: stats.blocks * stats.bsize,
        };
      } catch {
        continue;
      }
    }
    return { usedPct: null, freeBytes: null, totalBytes: null };
  }
}

function hoursSince(at: Date | null, now: Date): number | null {
  if (!at) return null;
  return Math.floor((now.getTime() - at.getTime()) / 3_600_000);
}
