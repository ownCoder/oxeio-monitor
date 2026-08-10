import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * `audit_log`-এ যেসব action বসে (স্পেক § ২ দেখুন)।
 * স্ক্রিনশট দেখা, রিপোর্ট এক্সপোর্ট ইত্যাদি পরের মডিউলে যোগ হবে।
 */
export type AuditAction =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'change_password'
  | 'reset_password'
  | 'create_portal_account'
  | 'view_screenshot'
  | 'export_report'
  /** ⭐ বেতন দেখা — সবচেয়ে সংবেদনশীল রিড, তাই আলাদা action ([ADR-023](../../../docs/05-Options-Decisions.md)) */
  | 'payroll_view'
  | 'change_setting'
  | 'create_enrollment_code'
  | 'revoke_device'
  | 'upload_policy_doc'
  | 'time_adjustment'
  | 'time_adjustment_revoke'
  /** ⭐ বেতন **বদলানো** — দেখার (`payroll_view`) চেয়েও ভারী, কারণ এটা
   *  কারো আয় বদলে দেয়। মান বদলালে meta-তে আগে/পরে দুটোই রাখা হয়। */
  | 'salary_change'
  | 'employee_create'
  | 'employee_update'
  | 'employee_deactivate'
  | 'employee_reactivate'
  | 'device_restore'
  | 'alert_acknowledge'
  /** D06 — মালিকের ক্যাটাগরি রুল বদলানো। `change_setting` দিয়ে লিখলে
   *  কে কবে কোন সাইটকে "unproductive" বানাল সেটা ফিল্টার করা যেত না। */
  | 'change_category_rule'
  | 'recategorize'
  /**
   * **I06 — 2FA।** আটটা আলাদা নাম, একটা `change_setting` নয়: "কে কবে নিজের
   * 2FA বন্ধ করল" আর "কে কবে থিম বদলাল" এক ফিল্টারে পড়লে প্রথমটা কোনোদিন
   * খুঁজে পাওয়া যেত না — অথচ অ্যাকাউন্ট দখলের তদন্তে ঠিক ওটাই প্রথম প্রশ্ন।
   */
  | '2fa_setup'
  | '2fa_enable'
  | '2fa_enable_failed'
  | '2fa_disable'
  | '2fa_disable_failed'
  | '2fa_recovery_regenerate'
  /** ⭐ রিকভারি কোড দিয়ে ঢোকা — বিরল আর সংবেদনশীল, তাই আলাদা action */
  | '2fa_recovery_used'
  | '2fa_failed'
  /** K02 — `POST /ops/backup/run`, হাতে চালানো ব্যাকআপ (রাতের cron অডিট করে না) */
  | 'backup_run';

export interface AuditEntry {
  userId?: number | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string | number;
  ipAddress?: string | null;
  meta?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * অডিট লেখা ব্যর্থ হলেও মূল কাজ আটকাবে না — কিন্তু চুপ করেও থাকবে না।
   * (কে কার স্ক্রিনশট দেখল সেটা হারানোর চেয়ে লগে চিৎকার করা ভালো।)
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId:
            entry.targetId === undefined ? null : String(entry.targetId),
          ipAddress: entry.ipAddress ?? null,
          meta: entry.meta,
        },
      });
    } catch (err) {
      this.logger.error(
        `audit_log লেখা যায়নি: ${entry.action}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
