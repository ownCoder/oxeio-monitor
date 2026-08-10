import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  Matches,
  Max,
} from 'class-validator';

import { MAX_RANGE_DAYS, type GroupBy } from './reports.range';

/** json = ড্যাশবোর্ডের জন্য · xlsx = F05 ডাউনলোড · pdf = F06 ছাপার জন্য */
export type ReportFormat = 'json' | 'xlsx' | 'pdf';

const DATE_MESSAGE = 'তারিখ দিতে হবে YYYY-MM-DD ফরম্যাটে';

/**
 * ⚠️ গ্লোবাল ValidationPipe-এ `whitelist + forbidNonWhitelisted` চালু, তাই
 *    DTO-তে নেই এমন query param এলে ৪০০ হয়। ফলে `?form=xlsx` লিখে ফেললে
 *    চুপচাপ JSON পাওয়ার বদলে পরিষ্কার এরর আসে।
 *
 * ⚠️ regex এখানে শুধু আকৃতি দেখে; ৩০ ফেব্রুয়ারি ধরা পড়ে `parseWorkDate()`-এ
 *    (reports.range.ts) — ক্যালেন্ডার যাচাই খাঁটি ফাংশনেই থাকে, দুই জায়গায়
 *    নয়।
 */
export class ReportRangeQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE })
  to!: string;

  @IsOptional()
  @IsIn(['json', 'xlsx', 'pdf'], {
    message: 'format হতে পারে json, xlsx অথবা pdf',
  })
  format?: ReportFormat;

  /** একজন স্টাফের রিপোর্ট চাইলে */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  employeeId?: number;
}

/** F02 — সাপ্তাহিক/মাসিক সারাংশ */
export class SummaryQuery extends ReportRangeQuery {
  @IsOptional()
  @IsIn(['week', 'month'], { message: 'groupBy হতে পারে week অথবা month' })
  groupBy?: GroupBy;
}

/** F04 — অ্যাপ/সাইট ভিত্তিক */
export class ProductivityQuery extends ReportRangeQuery {
  /**
   * ⭐ এখানে `pdf` **নেই** — F06 শুধু অ্যাটেনডেন্স ও সারাংশের জন্য।
   *
   * ⚠️ সীমাটা **DTO-তেই**, কন্ট্রোলারে `if` দিয়ে নয়। কন্ট্রোলারে রাখলে
   * `?format=pdf` চুপচাপ JSON ফেরত দিত (বা একটা খালি ফাইল), আর
   * ব্যবহারকারী ভাবতেন ডাউনলোডটা ব্যর্থ হয়েছে। এখানে রাখায় উত্তরটা
   * একটা পরিষ্কার ৪০০ — কোন ফরম্যাটগুলো চলে সেটাসহ।
   *
   * (class-validator সাবক্লাসের ডেকোরেটরকে একই ধরনের inherited ডেকোরেটরের
   * বদলি হিসেবে নেয়; বদলি হোক বা যোগ, দুই ক্ষেত্রেই `pdf` এখানে আটকায়।)
   */
  @IsOptional()
  @IsIn(['json', 'xlsx'], {
    message:
      'productivity রিপোর্টের PDF নেই — format হতে পারে json অথবা xlsx (ছাপার জন্য attendance বা summary)',
  })
  // ⚠️ `= undefined` মুছবেন না। `useDefineForClassFields` চালু (target
  //    ES2023), তাই ইনিশিয়ালাইজার ছাড়া বেস ক্লাসের ফিল্ড ওভাররাইড করা
  //    TS2612। `declare` দিয়ে সমাধান করা যেত না — declare ফিল্ডে ডেকোরেটর
  //    বসে না, আর ডেকোরেটরটাই তো এখানকার পুরো উদ্দেশ্য।
  override format?: ReportFormat = undefined;

  /**
   * টপ কতটা অ্যাপ/সাইট ফেরত যাবে।
   * ⚠️ সীমা না থাকলে এক বছরের রেঞ্জে হাজারো ডোমেইন একসাথে ফিরত —
   *    রেসপন্স বিশাল হতো, অথচ কেউ ২০০-র নিচের সারি পড়ে না।
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(200)
  limit?: number;
}

/** এরর মেসেজে ব্যবহারের জন্য — DTO আর ডকুমেন্টেশন যেন এক সংখ্যা বলে */
export const MAX_REPORT_DAYS = MAX_RANGE_DAYS;
