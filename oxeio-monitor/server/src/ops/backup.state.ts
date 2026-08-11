import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { BackupState } from './ops.rules';

/**
 * ⚠️ `settings` টেবিলের এই একটামাত্র সারিতেই ব্যাকআপের পুরো ইতিহাস।
 *    schema বদলানোর অনুমতি নেই, আর দরকারও নেই — প্রশ্নটা ছোট
 *    ("শেষ কবে সফল হয়েছিল?"), তাই একটা key/value সারিই যথেষ্ট।
 */
export const BACKUP_STATE_KEY = 'ops.backup.state';

/** ডিস্কে (JSON-এ) যেভাবে থাকে — সব সময় ISO স্ট্রিং */
interface StoredBackupState {
  lastAttemptAt?: string | null;
  lastOutcome?: 'ok' | 'failed' | null;
  lastError?: string | null;
  lastSuccessAt?: string | null;
  lastSuccessFile?: string | null;
  lastSuccessBytes?: number | null;
  consecutiveFailures?: number;
  lastCopyOutcome?: 'ok' | 'failed' | null;
  lastCopyError?: string | null;
  lastCopyAt?: string | null;
  observedSince?: string | null;
}

/** হেলথ পাতা যা যা দেখায় — verdict-এর বাইরের কাঁচা তথ্য */
export interface BackupSnapshot extends BackupState {
  lastError: string | null;
  lastSuccessFile: string | null;
  lastSuccessBytes: number | null;
  lastCopyError: string | null;
  lastCopyAt: Date | null;
}

/**
 * ব্যাকআপের অবস্থা লেখা ও পড়া — ⭐ **একটাই** সত্যের উৎস।
 *
 * K02 (জব), K04 (হেলথ) আর G04 (অ্যালার্ট) — তিন জায়গাতেই "শেষ ব্যাকআপ কেমন
 * গেল" জানতে হয়। প্রত্যেকে নিজের মতো করে ব্যাকআপ ফোল্ডার ঘেঁটে হিসাব করলে
 * তিনটে উত্তর তিন রকম হতো, আর সবচেয়ে খারাপ দৃশ্যটা হলো: হেলথ পাতা সবুজ,
 * অথচ অ্যালার্ট বলছে ব্যাকআপ নেই। তখন কোনটাকে বিশ্বাস করা হবে সেটাই আর
 * ঠিক করা যেত না, আর মানুষ সাধারণত সবুজটাকেই বিশ্বাস করে।
 */
@Injectable()
export class BackupStateStore {
  private readonly logger = new Logger(BackupStateStore.name);

  /**
   * ⚠️ প্রসেস কখন উঠেছে — `observedSince`-এর শেষ ভরসা। এটা ছাড়া সদ্য
   *    ইনস্টল করা সার্ভার প্রথম মিনিটেই "একটাও ব্যাকআপ হয়নি" বলে চেঁচাত।
   */
  private readonly bootedAt = new Date();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ⚠️ কখনো throw করে না। এই ফাংশনটা হেলথ endpoint আর অ্যালার্ট চেক দুটোতেই
   *    ডাকা হয় — settings টেবিল পড়তে না পারলে "ব্যাকআপের খবর নেই" বলাই যথেষ্ট,
   *    পুরো হেলথ পাতা ৫০০ হয়ে যাওয়ার কোনো মানে নেই।
   */
  async read(configured: boolean): Promise<BackupSnapshot> {
    const stored = await this.load();

    return {
      configured,
      lastAttemptAt: toDate(stored.lastAttemptAt),
      lastOutcome: stored.lastOutcome ?? null,
      lastError: stored.lastError ?? null,
      lastSuccessAt: toDate(stored.lastSuccessAt),
      lastSuccessFile: stored.lastSuccessFile ?? null,
      lastSuccessBytes: stored.lastSuccessBytes ?? null,
      consecutiveFailures: stored.consecutiveFailures ?? 0,
      lastCopyOutcome: stored.lastCopyOutcome ?? null,
      lastCopyError: stored.lastCopyError ?? null,
      lastCopyAt: toDate(stored.lastCopyAt),
      observedSince: toDate(stored.observedSince) ?? this.bootedAt,
    };
  }

  /**
   * এক দফার ফল লিখে রাখা।
   *
   * ⭐ `consecutiveFailures` এখানেই গোনা হয় — সফল হলে ০, ব্যর্থ হলে +১।
   * G04-এর severity বাড়া-কমা পুরোটাই এই একটা সংখ্যার উপর, তাই গোনাটা
   * এক জায়গায় রাখা হয়েছে; দুই জায়গায় বাড়ালে টানা দুই রাতের ব্যর্থতা
   * চার গোনা হতো এবং প্রথম রাতেই critical বেজে যেত।
   */
  async record(outcome: {
    at: Date;
    ok: boolean;
    error?: string | null;
    fileName?: string | null;
    sizeBytes?: number | null;
    copy?: { ok: boolean; error?: string | null } | null;
  }): Promise<void> {
    const prev = await this.load();

    const next: StoredBackupState = {
      ...prev,
      lastAttemptAt: outcome.at.toISOString(),
      lastOutcome: outcome.ok ? 'ok' : 'failed',
      // ⚠️ বার্তাটা ছেঁটে রাখা হয় — pg_dump-এর stderr কয়েক হাজার লাইন হতে
      //    পারে, আর পুরোটা settings-এ জমলে প্রতিটা হেলথ কল ওটা টেনে আনত।
      lastError: outcome.ok ? null : (outcome.error ?? 'unknown error').slice(0, 500),
      consecutiveFailures: outcome.ok ? 0 : (prev.consecutiveFailures ?? 0) + 1,
      observedSince: prev.observedSince ?? this.bootedAt.toISOString(),
    };

    if (outcome.ok) {
      next.lastSuccessAt = outcome.at.toISOString();
      next.lastSuccessFile = outcome.fileName ?? null;
      next.lastSuccessBytes = outcome.sizeBytes ?? null;
    }

    if (outcome.copy) {
      next.lastCopyOutcome = outcome.copy.ok ? 'ok' : 'failed';
      next.lastCopyError = outcome.copy.ok
        ? null
        : (outcome.copy.error ?? 'unknown error').slice(0, 500);
      next.lastCopyAt = outcome.at.toISOString();
    }

    await this.save(next);
  }

  /** কনফিগ নেই বলে জবটা চালানোই হয়নি — সেটাও একটা রেকর্ডযোগ্য ঘটনা */
  async markObserved(): Promise<void> {
    const prev = await this.load();
    if (prev.observedSince) return;
    await this.save({ ...prev, observedSince: this.bootedAt.toISOString() });
  }

  private async load(): Promise<StoredBackupState> {
    try {
      const row = await this.prisma.setting.findUnique({
        where: { key: BACKUP_STATE_KEY },
        select: { value: true },
      });
      if (!row || typeof row.value !== 'object' || row.value === null) {
        return {};
      }
      return row.value as StoredBackupState;
    } catch (err) {
      this.logger.error(
        `Could not read backup state: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return {};
    }
  }

  private async save(state: StoredBackupState): Promise<void> {
    const value = state as unknown as Prisma.InputJsonValue;
    try {
      await this.prisma.setting.upsert({
        where: { key: BACKUP_STATE_KEY },
        create: { key: BACKUP_STATE_KEY, value },
        update: { value },
      });
    } catch (err) {
      // ⚠️ লেখা না গেলেও ব্যাকআপটা তো হয়েই গেছে — এখান থেকে throw করলে
      //    সফল একটা ব্যাকআপ "ব্যর্থ" হিসেবে লগে উঠত।
      this.logger.error(
        `Could not write backup state: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
