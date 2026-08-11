import { Controller, Get, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { BackupJob } from './backup.job';
import { OpsHealthService, type OpsHealth } from './ops.health.service';

/** হাতে চালানো ব্যাকআপের উত্তর — ⚠️ কোনো পাথ বা পাসফ্রেজ নয় */
export interface ManualBackupResponse {
  ok: boolean;
  skipped: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  durationMs: number;
  error: string | null;
  copy: { configured: boolean; ok: boolean; error: string | null };
  rotated: number;
}

/**
 * **K04** — `GET /api/v1/ops/health`।
 *
 * ⚠️ পুরো কন্ট্রোলারটাই owner-only, ক্লাস-লেভেলে — পরে কেউ নতুন endpoint
 *    যোগ করলে সেটাও আপনাআপনি owner-only থাকবে।
 *
 * ⭐ ম্যানেজারও এখানে ঢুকতে পারে না। উত্তরে ডিস্কের আকার, ব্যাকআপের
 * ইতিহাস, কতগুলো ডিভাইস চুপ — এগুলো device/audit ঘরানার তথ্য (স্পেক
 * § ৪.৩), আর একসাথে দেখলে এগুলো দিয়ে অফিসের অবকাঠামোর ছবি আঁকা যায়।
 *
 * ⚠️ Docker healthcheck এখানে আসবে **না** — সেটার জন্য `/api/v1/health`
 *    (পাবলিক, `src/health/`)। এই দুটো গুলিয়ে ফেললে হয় কন্টেইনার
 *    চিরকাল unhealthy দেখাত (৪০৩), নয়তো এই তথ্যগুলো পাবলিক হয়ে যেত।
 */
@Roles(UserRole.owner)
@Controller('ops')
export class OpsController {
  private readonly logger = new Logger(OpsController.name);

  constructor(
    private readonly health: OpsHealthService,
    private readonly backup: BackupJob,
  ) {}

  @Get('health')
  check(): Promise<OpsHealth> {
    return this.health.check();
  }

  /**
   * `POST /api/v1/ops/backup/run` — এখনই একটা ব্যাকআপ।
   *
   * ⭐ থাকার কারণ: যে ব্যাকআপ কখনো পরীক্ষা করা হয়নি সেটা ব্যাকআপ নয়,
   * অনুমান। রাত ২:৩০ পর্যন্ত অপেক্ষা না করে ইনস্টলের দিনই যাচাই করা
   * যায় — pg_dump পাওয়া যাচ্ছে কি না, পাসফ্রেজ ঠিক আছে কি না,
   * এক্সটার্নাল ড্রাইভটা লেখা যাচ্ছে কি না।
   *
   * ⚠️ `RunLock` একই সময়ে দুটো ডাম্প ঠেকায় — বারবার চাপলেও।
   */
  @Post('backup/run')
  @HttpCode(HttpStatus.OK)
  async runBackup(
    @CurrentUser() actor: SessionUser,
  ): Promise<ManualBackupResponse> {
    this.logger.warn(`Manual backup triggered — user ${actor.userId}`);
    const result = await this.backup.runOnce();

    return {
      ok: result.ok,
      skipped: result.skipped,
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
      durationMs: result.durationMs,
      error: result.error,
      copy: {
        configured: result.copy.configured,
        ok: result.copy.ok,
        // ⚠️ `target` ইচ্ছাকৃতভাবে বাদ — সার্ভারের ফাইল-পথ ব্রাউজারে
        //    পাঠানোর কোনো দরকার নেই।
        error: result.copy.error,
      },
      rotated: result.rotated,
    };
  }
}
