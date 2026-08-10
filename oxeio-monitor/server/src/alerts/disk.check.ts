import { statfs } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DISK_CRITICAL_PCT, DISK_WARN_PCT } from './alerts.constants';
import { diskUsedPct, diskVerdict, humanBytes } from './alerts.rules';
import { AlertsService } from './alerts.service';

/**
 * G03 — সার্ভারের নিজের ডিস্ক ৮০% / ৯৫% ভরে গেলে সতর্কতা।
 *
 * ⭐ যে ড্রাইভে স্ক্রিনশট জমে সেটাই দেখা হয় (`STORAGE_ROOT`), সিস্টেম ড্রাইভ নয়।
 * দিনে ১৫ জনের ছবি জমে ওই ড্রাইভটাই ভরে, আর ভরে গেলে যা হয় সেটা নিছক
 * "ছবি জমছে না" নয় — এজেন্টের আপলোড ব্যর্থ হয়, ইনজেস্ট আটকায়, ঘণ্টার
 * হিসাব ফাঁকা যায়। তাই এটাকে সাধারণ housekeeping অ্যালার্ট ভাবা ভুল।
 */
@Injectable()
export class DiskCheck {
  private readonly logger = new Logger(DiskCheck.name);
  private readonly storageRoot: string;
  /** ⚠️ পথ না পাওয়ার অভিযোগ একবারই লগে যাবে, প্রতি ১৫ মিনিটে নয় */
  private warnedUnreadable = false;

  constructor(
    private readonly alerts: AlertsService,
    config: ConfigService,
  ) {
    this.storageRoot = resolve(
      config.get<string>('STORAGE_ROOT') ??
        join(process.cwd(), '..', '.data', 'storage'),
    );
  }

  async runOnce(now = new Date()): Promise<number> {
    const stats = await this.readStats();
    if (!stats) return 0;

    const usedPct = diskUsedPct(stats);
    const verdict = diskVerdict(usedPct);
    if (!verdict) return 0;

    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const rounded = Math.round(usedPct * 10) / 10;

    return this.alerts.raiseMany(
      [
        {
          type: verdict.type,
          severity: verdict.severity,
          // ⚠️ ডিস্ক কোনো ডিভাইস বা কর্মীর ব্যাপার নয় — দুটোই null, ফলে
          //    throttle-এর key-তে শুধু type-টাই থাকে (সার্ভারপ্রতি একটাই)।
          deviceId: null,
          employeeId: null,
          title:
            verdict.severity === 'critical'
              ? `ডিস্ক প্রায় ভরে গেছে — ${rounded}%`
              : `ডিস্ক ${rounded}% ভরেছে`,
          detail:
            `${this.storageRoot} ড্রাইভে ${humanBytes(freeBytes)} খালি আছে ` +
            `(মোট ${humanBytes(totalBytes)})। ` +
            (verdict.severity === 'critical'
              ? `${DISK_CRITICAL_PCT}% পেরিয়েছে — জায়গা শেষ হলে স্ক্রিনশট আপলোড ও ইনজেস্ট দুটোই আটকে যাবে। এখনই পুরোনো ব্যাকআপ সরান।`
              : `${DISK_WARN_PCT}% পেরিয়েছে — retention জব ঠিকমতো চলছে কি না দেখুন।`),
          meta: {
            path: this.storageRoot,
            usedPct: rounded,
            freeBytes,
            totalBytes,
          },
        },
      ],
      now,
    );
  }

  /**
   * ⚠️ `STORAGE_ROOT` এখনো তৈরি না হলে `statfs` ছুড়ে দেয়। সেক্ষেত্রে ড্রাইভের
   *    রুট দেখা হয় — সংখ্যাটা একই ভলিউমের, আর অ্যালার্টটাই আসল উদ্দেশ্য।
   *    দুটোই ব্যর্থ হলে **চুপচাপ থেমে যায়**: ডিস্ক পড়তে না পারা কোনো
   *    অ্যালার্টযোগ্য ঘটনা নয়, আর এখান থেকে exception ছুড়লে টাইমার মরে
   *    গিয়ে বাকি চেকগুলোও বন্ধ হয়ে যেত।
   */
  private async readStats(): Promise<{
    blocks: number;
    bfree: number;
    bavail: number;
    bsize: number;
  } | null> {
    for (const path of [this.storageRoot, parse(this.storageRoot).root]) {
      if (!path) continue;
      try {
        const fs = await statfs(path);
        return {
          blocks: Number(fs.blocks),
          bfree: Number(fs.bfree),
          bavail: Number(fs.bavail),
          bsize: Number(fs.bsize),
        };
      } catch {
        continue;
      }
    }

    if (!this.warnedUnreadable) {
      this.warnedUnreadable = true;
      this.logger.warn(
        `ডিস্কের তথ্য পড়া যায়নি (${this.storageRoot}) — G03 চেক চলছে না`,
      );
    }
    return null;
  }
}
