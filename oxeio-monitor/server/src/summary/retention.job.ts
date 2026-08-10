import { rmdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { storageRoot } from '../common/storage.config';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_TIMEZONE, RunLock, SCHEDULING_ENABLED } from './scheduling';
import { isInsideRoot, retentionCutoff } from './summary.math';

/** 07 § ১ (locked configuration) — `retention.screenshots_days` */
export const SCREENSHOT_RETENTION_DAYS = 90;

/** এক দফায় কত সারি — বড় করলে একটা ব্যর্থতায় বেশি কাজ হারায় */
const BATCH = 500;

/** অসীম লুপের শেষ প্রতিরোধ (৫ লাখ সারি = কয়েক বছরের ছবি) */
const MAX_BATCHES = 1000;

export interface RetentionResult {
  cutoff: Date | null;
  /** এই দফায় যত সারি "মুছে ফেলার জন্য" মার্ক হলো */
  marked: number;
  filesDeleted: number;
  /** সারি ছিল, ফাইল ছিল না — আগের কোনো অসম্পূর্ণ রানের বাকি কাজ */
  filesMissing: number;
  rowsDeleted: number;
  /** ফাইল মুছতে ব্যর্থ (লক করা?) — সারি রেখে দেওয়া হয়েছে, পরের রানে আবার */
  failed: number;
  /** storage রুটের বাইরের পাথ — মানুষ না দেখলে ঠিক হবে না */
  unsafePaths: number;
  skipped: boolean;
}

/**
 * **K01** — রাত ২টায় ৯০ দিনের পুরোনো স্ক্রিনশট মুছে ফেলা: **DB সারি ও
 * ডিস্কের ফাইল দুটোই**।
 *
 * ⭐ **কোনটা আগে — এই সিদ্ধান্তটাই এই ফাইলের মূল বিষয়।**
 *
 * দুটো সরল পথ, দুটোতেই ক্ষতি:
 *   · DB আগে → ডিস্কে অনাথ ফাইল পড়ে থাকে। কেউ টেরই পায় না, কারণ কোথাও
 *     কোনো সারি নেই যেটা ওই ফাইলের কথা মনে রেখেছে। retention-এর পুরো
 *     উদ্দেশ্যই ছিল ডিস্ক ভরতে না দেওয়া — এই পথে সেটাই ব্যর্থ, আর
 *     ব্যর্থতাটা নীরব।
 *   · ফাইল আগে → সারি থেকে যায়, গ্যালারি ৪০৪ দেখায়। বিরক্তিকর, কিন্তু
 *     দৃশ্যমান এবং সারানো যায়।
 *
 * তৃতীয় পথটাই বেছে নেওয়া হয়েছে, আর schema সেটার জন্য আগেই জায়গা রেখেছে
 * (`screenshots.deleted_at` — "retention job এখানে মার্ক করে, তারপর ফাইল মোছে"):
 *
 *   ১· সারিগুলোতে `deleted_at` বসাও  → ছবি **আগেই** গ্যালারি থেকে উধাও,
 *      কারণ সব পাঠক `deleted_at: null` ফিল্টার করে
 *   ২· ডিস্ক থেকে ফাইল মোছো
 *   ৩· যেগুলোর ফাইল সত্যিই গেছে **শুধু সেগুলোরই** সারি হার্ড-ডিলিট
 *
 * ফলে ভাঙা সারির জানালাটা কখনো দেখাই যায় না, আর অনাথ ফাইলও থাকে না।
 * মাঝপথে প্রসেস মরে গেলে পড়ে থাকে মার্ক-করা সারি (অদৃশ্য, ক্ষতিহীন) —
 * পরের রান ঠিক সেখান থেকেই কাজ শেষ করে। জবটা তাই idempotent।
 */
@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);
  private readonly lock = new RunLock();
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // ⚠️ `screenshot-ingest.service.ts`-এর সাথে হুবহু একই হিসাব। দুই জায়গায়
    //    আলাদা হয়ে গেলে এই জব ভুল ফোল্ডারে খুঁজত — একটাও ফাইল মুছত না,
    //    অথচ সারি ঠিকই মুছে যেত। এখন সংজ্ঞাটা এক জায়গায় —
    //    `src/common/storage.config.ts`।
    this.root = resolve(
      storageRoot(config),
    );
  }

  /** ⚠️ `timeZone` ছাড়া UTC-র রাত ২টা = ঢাকার সকাল ৮টা — অফিস-সময়ে ডিস্ক I/O। */
  @Cron('0 0 2 * * *', {
    name: 'screenshot-retention',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    // ⚠️ দ্বিতীয় তালা। এই জবটাই সবচেয়ে ধ্বংসাত্মক — টেস্ট চলাকালীন একবার
    //    টিক করলে ফিক্সচারের ছবি ও ফাইল দুটোই চলে যেত।
    if (!SCHEDULING_ENABLED) return;
    await this.runOnce();
  }

  async runOnce(now: Date = new Date()): Promise<RetentionResult> {
    const result = await this.lock.run(() => this.purge(now));

    if (result === null) {
      this.logger.warn('আগের retention রান এখনো চলছে — এই দফা বাদ');
      return {
        cutoff: null,
        marked: 0,
        filesDeleted: 0,
        filesMissing: 0,
        rowsDeleted: 0,
        failed: 0,
        unsafePaths: 0,
        skipped: true,
      };
    }

    return result;
  }

  private async purge(now: Date): Promise<RetentionResult> {
    const cutoff = retentionCutoff(now, SCREENSHOT_RETENTION_DAYS);

    // ── ধাপ ১ · মার্ক ────────────────────────────────────────────────────
    const { count: marked } = await this.prisma.screenshot.updateMany({
      where: { workDate: { lt: cutoff }, deletedAt: null },
      data: { deletedAt: now },
    });

    const result: RetentionResult = {
      cutoff,
      marked,
      filesDeleted: 0,
      filesMissing: 0,
      rowsDeleted: 0,
      failed: 0,
      unsafePaths: 0,
      skipped: false,
    };

    const touchedDirs = new Set<string>();

    /**
     * ⚠️ cursor দিয়ে পাতা ওল্টানো হচ্ছে, `take` দিয়ে বারবার প্রথম ব্যাচ
     * টেনে নয়। কারণ ব্যর্থ সারিগুলো (ফাইল লক) মোছা হয় না — তারা তালিকার
     * শুরুতেই থেকে যেত, আর লুপ চিরকাল একই ৫০০টা সারি নিয়ে ঘুরত।
     *
     * ⚠️ শর্তে `workDate < cutoff`-ও আছে, শুধু `deleted_at IS NOT NULL` নয়।
     * ভবিষ্যতে কেউ যদি "এই ছবিটা মুছে দাও" ফিচার বানিয়ে সদ্য তোলা কোনো
     * ছবিতে `deleted_at` বসায়, retention জব সেটাকে হার্ড-ডিলিট করে ফেলত।
     */
    let cursor = 0n;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await this.prisma.screenshot.findMany({
        where: {
          deletedAt: { not: null },
          workDate: { lt: cutoff },
          id: { gt: cursor },
        },
        select: { id: true, filePath: true, thumbPath: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      });

      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;

      const deletable: bigint[] = [];

      for (const row of rows) {
        /**
         * A06 — ⭐ **দুটো ফাইলই**: ফুল ছবি আর থাম্বনেইল।
         *
         * ⚠️ শুধু `file_path` মুছলে ভুলটা এমন যে বছরখানেক কেউ টেরই পেত না:
         *    সারি যেত, ফুল ছবি যেত, কিন্তু `…/emp-003/thumb/` ফোল্ডারের
         *    ছোট ছবিগুলো ডিস্কে **চিরকাল** থেকে যেত — আর DB-তে তখন এমন
         *    কোনো সারিই নেই যে ওদের কথা মনে রেখেছে। retention-এর একমাত্র
         *    উদ্দেশ্যই ডিস্ক ভরতে না দেওয়া; ওই পথে সেটা নীরবে ব্যর্থ হতো।
         *
         * `thumb_path` null হতে পারে (পুরোনো সারি, বা থাম্বনেইল বানানো
         * যায়নি) — তাই ছেঁকে নেওয়া, ধরে নেওয়া নয়।
         */
        const paths = [row.filePath, row.thumbPath].filter(
          (p): p is string => typeof p === 'string' && p.length > 0,
        );

        if (paths.some((p) => !isInsideRoot(this.root, p))) {
          // ⚠️ সারিটাও মোছা হচ্ছে **না** — মুছে দিলে প্রতিবেদনটা হারিয়ে যেত
          //    আর সমস্যাটা চুপচাপ চাপা পড়ত। প্রতি রানে আবার চেঁচাবে।
          result.unsafePaths++;
          this.logger.error(
            `screenshot ${row.id}: file_path storage রুটের বাইরে — ছোঁয়া হয়নি`,
          );
          continue;
        }

        const outcome = await this.removeFiles(paths);
        if (outcome === 'failed') {
          result.failed++;
          continue;
        }

        result.filesDeleted += outcome.deleted;
        result.filesMissing += outcome.missing;
        deletable.push(row.id);
        for (const p of paths) touchedDirs.add(dirname(resolve(this.root, p)));
      }

      // ── ধাপ ৩ · ফাইল সত্যিই গেছে, এবার সারি ───────────────────────────
      if (deletable.length > 0) {
        const { count } = await this.prisma.screenshot.deleteMany({
          where: { id: { in: deletable } },
        });
        result.rowsDeleted += count;
      }

      if (batch === MAX_BATCHES - 1) {
        this.logger.warn(
          `retention ${MAX_BATCHES} ব্যাচেই থামল — বাকিটা পরের রাতে`,
        );
      }
    }

    await this.pruneEmptyDirs(touchedDirs);

    this.logger.log(
      `retention · cutoff ${cutoff.toISOString().slice(0, 10)} · ` +
        `মার্ক ${result.marked} · ফাইল ${result.filesDeleted} ` +
        `(অনুপস্থিত ${result.filesMissing}) · সারি ${result.rowsDeleted}` +
        (result.failed > 0 ? ` · ব্যর্থ ${result.failed}` : '') +
        (result.unsafePaths > 0 ? ` · ⚠️ অনিরাপদ পাথ ${result.unsafePaths}` : ''),
    );

    return result;
  }

  /**
   * ⚠️ ফাইল **নেই** মানে সফল, ব্যর্থ নয় (ENOENT)। আগের কোনো রান ফাইল মুছে
   * সারি মোছার আগেই থেমে গিয়েছিল — এখন সারিটা যেতে দেওয়াই ঠিক। এটাকে
   * ব্যর্থতা ধরলে ওই সারিগুলো চিরকাল আটকে থাকত।
   *
   * ⚠️ অন্য যেকোনো ভুলে (ফাইল লক, পারমিশন) সারিটা **রেখে দেওয়া হয়**।
   * মুছে দিলে ঠিক সেই অনাথ ফাইলটাই তৈরি হতো যেটা এড়াতে এত আয়োজন।
   */
  private async removeFiles(
    paths: readonly string[],
  ): Promise<'failed' | { deleted: number; missing: number }> {
    let deleted = 0;
    let missing = 0;

    for (const rel of paths) {
      try {
        await unlink(resolve(this.root, rel));
        deleted++;
      } catch (error) {
        if (isMissing(error)) {
          missing++;
          continue;
        }
        this.logger.warn(`ফাইল মোছা যায়নি: ${rel} — ${String(error)}`);
        return 'failed';
      }
    }

    return { deleted, missing };
  }

  /**
   * খালি হয়ে যাওয়া তারিখ-ফোল্ডারগুলো সরিয়ে দেয়।
   *
   * পাথ `…/YYYY/MM/DD/emp-003/` — বছরে ~৩৬৫ × কর্মীসংখ্যা ফোল্ডার। ফাইল
   * মুছে ফোল্ডার রেখে দিলে কয়েক বছরে হাজার হাজার খালি ডিরেক্টরি জমত, আর
   * ব্যাকআপের robocopy প্রতি রাতে সেগুলোই হাঁটত।
   *
   * ⭐ A06-এর `…/emp-003/thumb/` এমনিতেই সামলে যায়, আর সেটা কাকতালীয় নয়:
   * উপরে **প্রতিটা** পাথের `dirname` আলাদা করে `touchedDirs`-এ যোগ হয়
   * (ফুল ছবিরটাও, থাম্বনেইলেরটাও), আর নিচে গভীরতম ফোল্ডার আগে ধরা হয় —
   * তাই `thumb/` আগে খালি হয়, তবেই `emp-003` খালি হতে পারে। উল্টো ক্রমে
   * `emp-003` চিরকাল ENOTEMPTY-তে আটকে থাকত, আর গোটা তারিখ-গাছটা রয়ে যেত।
   *
   * ⚠️ `rmdir` (recursive নয়) — ফোল্ডারে কিছু থাকলে নিজেই ব্যর্থ হয়। এখানে
   * `rm -rf` জাতীয় কিছু ব্যবহার করলে একটা পাথের ভুলে গোটা গাছ যেত।
   */
  private async pruneEmptyDirs(dirs: ReadonlySet<string>): Promise<void> {
    // গভীরতম আগে — emp-003 খালি না হলে DD কখনোই খালি হবে না
    const ordered = [...dirs].sort((a, b) => b.length - a.length);

    for (const dir of ordered) {
      let current = dir;

      while (current !== this.root && isInsideRoot(this.root, current)) {
        try {
          await rmdir(current);
        } catch {
          // ENOTEMPTY বা ENOENT — দুটোই স্বাভাবিক, থেমে যাওয়াই যথেষ্ট
          break;
        }
        current = dirname(current);
      }
    }
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
