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
  | 'change_login_email'
  | 'view_screenshot'
  | 'export_report'
  /** ⭐ বেতন দেখা — সবচেয়ে সংবেদনশীল রিড, তাই আলাদা action ([ADR-023](../../../docs/05-Options-Decisions.md)) */
  | 'payroll_view'
  | 'change_setting'
  | 'create_enrollment_code'
  | 'revoke_device'
  | 'upload_policy_doc'
  /**
   * ⭐ **রোলআউটের একমাত্র শর্ত** — "সই ছাড়া কারো PC-তে এজেন্ট বসবে না"
   * ([01 § রোলআউট](../../../docs/01-Planning.md))। কে কবে কার সই রেকর্ড
   * করল সেটা `change_setting`-এ মিশে গেলে ছ-মাস পরে "ওর সই কি সত্যিই
   * নেওয়া হয়েছিল" প্রশ্নের উত্তর আর খুঁজে পাওয়া যেত না।
   *
   * ⚠️ `upload_policy_doc` আলাদা রাখা হয়েছে — ওটা স্ক্যান করা কপি
   * আপলোডের জন্য, যেটা এখনো তৈরি হয়নি। এটা শুধু **তারিখ** বসানো।
   */
  | 'policy_signed'
  /** সই ভুল করে বসানো হয়েছিল, তুলে নেওয়া হলো — বিরল, তাই আলাদা। */
  | 'policy_signed_cleared'
  | 'time_adjustment'
  | 'time_adjustment_revoke'
  /**
   * ⭐⭐ R1 — মাস বন্ধ/খোলা। **বেতনের ভিত্তি স্থির করার মুহূর্তটাই** এটা,
   * তাই আলাদা action: `change_setting`-এ মিশে গেলে "আগস্টের হিসাব কখন
   * জমাট হয়েছিল, আর কে করেছিল" প্রশ্নের উত্তর ছ-মাস পরে খুঁজে পাওয়া যেত না।
   *
   * ⚠️⚠️ `month_reopened` **আলাদা করে রাখা সবচেয়ে জরুরি** — বেতন দেওয়ার
   * পর কেউ মাস খুলে সংখ্যা বদলালে সেটাই একমাত্র প্রমাণ। খোলার রেকর্ডটা
   * বন্ধ করার রেকর্ডের সাথে এক করে ফেললে ইতিহাসটাই মুছে যেত।
   */
  | 'month_closed'
  | 'month_reopened'
  /**
   * ⭐⭐ **শেষ হওয়া ডিজাইন "শেষ নয়" করে দেওয়া** *(২৫ আগস্ট ২০২৬)*।
   *
   * ⚠️⚠️ **এটাই একমাত্র মুছে-ফেলা কাজ যার নিজের কোনো চিহ্ন থাকে না।**
   * Undo চাপলে `completed_at` · `completed_via` · `completed_by_id`
   * তিনটেই `null` হয়ে যায় — অর্থাৎ কাজটা কখনো শেষ হয়েছিল, সেই
   * প্রমাণটাই সারি থেকে উধাও। ⭐ লগ না থাকলে কেউ রোজ
   * Complete → Undo → Complete করলেও মালিক দেখতেই পেতেন না।
   *
   * ⚠️ মালিকের প্রশ্নেই এটা যোগ হয়েছে: *"ei access ta ki designer
   * der pawa uchit?"* — ⭐ প্রশ্নটার আসল সমস্যা ছিল অধিকার নয়,
   * **যাচাই করার উপায় না থাকা**। লগটা প্রশ্নটাকে "বিশ্বাস করব কি
   * না" থেকে "দরকার হলে দেখে নেব"-তে বদলে দেয়।
   *
   * ⚠️ meta-তে **মুছে ফেলা মানগুলোই** রাখা হয় (কবে শেষ হয়েছিল, কে
   * চেপেছিল) — সারিতে ওগুলো আর নেই, তাই লগই একমাত্র জায়গা।
   */
  | 'design_undone'
  /**
   * ⭐ **মরা ASIN মুছে ফেলা** *(২৯ আগস্ট ২০২৬)* — Amazon-এ পাতাটাই নেই।
   *
   * ⚠️ `change_setting`-এ মেশানো হয়নি: একদিন প্রশ্ন উঠবেই "এতগুলো লিঙ্ক
   *    কে বাদ দিল, আর কবে" — আর তখন সেটিংসের হাজারটা সারির মধ্যে খুঁজতে হতো।
   */
  | 'design_deleted'
  /** ⭐ R2 — ছুটি টার্গেট কমায়, তাই কে লিখল/মুছল তা রেকর্ড থাকা দরকার */
  | 'leave_added'
  | 'leave_removed'
  /** ⭐ বেতন **বদলানো** — দেখার (`payroll_view`) চেয়েও ভারী, কারণ এটা
   *  কারো আয় বদলে দেয়। মান বদলালে meta-তে আগে/পরে দুটোই রাখা হয়। */
  | 'salary_change'
  /**
   * ⭐⭐ **R21 — জামানত (সিকিউরিটি মানি)।** দুটো আলাদা নাম, আর দুটোরই
   * দরকার আছে:
   *
   * · `deposit_policy_update` — অঙ্ক বা নোটিশের নিয়ম বদলানো। এটা
   *   `change_setting`-এ মিশে গেলে "৫০০ কবে থেকে, আর কে বাড়াল" প্রশ্নের
   *   উত্তর ছ-মাস পরে খুঁজে পাওয়া যেত না।
   *
   * · ⚠️⚠️ `deposit_settle` — **কারো জমানো টাকা ফেরত দেওয়া বা বাজেয়াপ্ত
   *   করা।** এটাই এই সিস্টেমের সবচেয়ে ভারী একক সিদ্ধান্ত: একটা ক্লিকে
   *   কয়েক হাজার টাকা কারো হাতছাড়া হয়। meta-তে নিয়ম কী বলেছিল
   *   (`noticeDaysGiven` বনাম `noticeDaysRule`) আর মালিক কী করলেন —
   *   দুটোই রাখা হয়, কারণ ব্যতিক্রম হলে ঠিক ওই জোড়াটাই পরে দেখতে হবে।
   */
  | 'deposit_policy_update'
  | 'deposit_settle'
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
  | 'backup_run'
  /**
   * **H04** — এজেন্টের নতুন ভার্সন বিলির জন্য নথিভুক্ত করা।
   *
   * ⭐ আলাদা action, `change_setting` নয়: এটা ১৫টা PC-তে **কোন
   * সফটওয়্যার চলবে** তার সিদ্ধান্ত। খারাপ বিল্ড বেরোলে "কে কখন এটা
   * ছাড়ল" প্রশ্নটাই প্রথম, আর সেটা থিম বদলানোর সাথে এক ফিল্টারে
   * পড়লে খুঁজে পাওয়া যেত না।
   */
  | 'publish_agent_version'
  /**
   * ⭐ owner MSI নামিয়েছেন — পুরোনো এজেন্টে (০.৪.১-এর আগে) tray-তে
   * "Install update" নেই, তাই ওই PC-গুলোয় হাতে বসাতে হয় (09 § ৩ভ৯)।
   * ⚠️ ইনস্টলার হাতে হাতে ঘোরার আগে "কে কোনটা নামাল" জানা থাকা দরকার।
   */
  | 'agent_version.download'
  /** ⭐ `halted` দিয়ে থামানোও এখানেই — বিলি শুরু করার মতোই ভারী সিদ্ধান্ত */
  | 'change_agent_rollout'
  /**
   * ⭐⭐ **যন্ত্র নিজে ধাপ বাড়িয়েছে** *(৫ সেপ্টেম্বর ২০২৬)* — canary বা
   * partial ধাপে একটা আসল মেশিন ছ-ঘণ্টা টিকে থাকার পর।
   *
   * ⚠️⚠️ **`change_agent_rollout`-এর সাথে মেশানো হয়নি ইচ্ছাকৃতভাবে।** ওটা
   * বলে *"একজন মানুষ সিদ্ধান্ত নিয়েছেন"*, আর এটা বলে *"শর্ত পূরণ হয়েছে"* —
   * দুটো সম্পূর্ণ আলাদা দায়। খারাপ বিল্ড বেরোলে প্রথম প্রশ্নই হবে "এটা কে
   * ছড়াল", আর এক ফিল্টারে থাকলে উত্তরটা পাওয়া যেত না।
   *
   * ⚠️ `userId` এখানে সবসময় `null` — কোনো মানুষ চাপেননি, আর সেটা লুকানোর
   * কিছু নেই।
   */
  | 'agent_version.rollout_auto';

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
        `Could not write audit_log: ${entry.action}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
