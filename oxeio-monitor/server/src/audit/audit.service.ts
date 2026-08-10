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
  | 'time_adjustment_revoke';

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
