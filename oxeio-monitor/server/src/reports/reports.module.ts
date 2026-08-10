import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * F01 · F02 · F04 · F05 · F08।
 *
 * ⚠️ `PayrollModule` (F03) আলাদা — ওটা owner-only আর `monthly_salary` পড়ে।
 *
 * ⚠️ `ActivityModule` এখানে **import করা হয় না**, অথচ F04 এখন
 *    `activity/activity.math.ts` ব্যবহার করে — দুটোয় কোনো বিরোধ নেই।
 *    `activity.math.ts` খাঁটি ফাংশনের ফাইল, কোনো `@Injectable` নয়; তাই
 *    সেটা import করা মানে একটা **সংজ্ঞা** ভাগ করা, DI গ্রাফ জোড়া লাগানো নয়।
 *    ⭐ এটাই ছিল উদ্দেশ্য: productivity-র হিসাব একটাই জায়গায় থাকবে
 *    (ADR — 09 § ৪), কিন্তু কোয়েরি ও রুট আলাদা থাকবে।
 *
 * ⚠️ ক্যাটাগরির নিয়ম **প্রয়োগ** (ingest) আর নিয়মের **ফল পড়া** (রিপোর্ট)
 *    এখনো দুটো আলাদা কাজ — F04 নিজের `app_categories` কোয়েরি নিজেই করে,
 *    `AppCategoryService`-এর ক্যাশ ছোঁয় না (কারণ সেখানে ভুল regex-ওয়ালা
 *    রুল বাদ পড়ে, অথচ পুরোনো সারিতে ওই id বসানোই আছে)।
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  /**
   * ⭐ F07 (`DigestModule`) এই সার্ভিসটাই ডাকে — নিজে `daily_summary` পড়ে
   * টার্গেট বের করে না। ফলে দৈনিক ইমেইল আর ছাপা রিপোর্ট **কখনো দুই রকম
   * ঘণ্টা বলবে না**; ছুটির ক্যালেন্ডার বা দৈনিক টার্গেটের ভাগ বদলালে
   * দুটোই একসাথে বদলায়।
   *
   * ⚠️ export মানে শুধু সার্ভিস, কন্ট্রোলার নয় — role-এর দেয়াল
   * (`@Roles(owner, manager)`) কন্ট্রোলারেই বসানো, আর সেটা এখানেই থাকে।
   * যে মডিউল সার্ভিসটা ব্যবহার করে তার **নিজের** দায়িত্ব কাকে দেখাবে
   * সেটা ঠিক করা (ডাইজেস্ট তাই ডিফল্টে শুধু owner-দের ইমেইল করে)।
   */
  exports: [ReportsService],
})
export class ReportsModule {}
