import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DayCloseJob } from './day-close.job';
import { RetentionJob } from './retention.job';
import { SCHEDULING_ENABLED } from './scheduling';
import { SummaryRefreshJob } from './summary-refresh.job';
import { SummaryService } from './summary.service';

/**
 * K06 · K05 · K01 — সারাংশ ও রক্ষণাবেক্ষণের শিডিউলড জব।
 *
 * ⭐ `ScheduleModule.forRoot()` **এখানেই**, `app.module.ts`-এ নয়। দুটো কারণ:
 *
 * ১· টেস্টে (`NODE_ENV === 'test'`) ইমপোর্টটাই বাদ পড়ে, ফলে explorer-ই
 *    জন্মায় না — কোনো `@Cron` কোথাও রেজিস্টার হয় না। এটাই সবচেয়ে শক্ত
 *    তালা, কারণ এখানে "জব আছে কিন্তু বন্ধ" নয়, জব বলে কিছুই নেই।
 *
 * ২· `app.module.ts` ছোঁয়ার দরকার পড়ে না — শুধু `SummaryModule` যোগ করলেই হয়।
 *
 * ⚠️ K02 (pg_dump) বা K04 (health) বানানোর সময় কেউ যেন আবার
 * `ScheduleModule.forRoot()` **অন্য কোথাও যোগ না করে** — দুবার forRoot হলে
 * দুটো explorer একই জব দুবার রেজিস্টার করার চেষ্টা করে। আমার প্রতিটা
 * `@Cron`-এ `name` দেওয়া আছে বলে সেটা bootstrap-এই জোরে ভেঙে পড়বে
 * ("cron job … already exists") — নীরবে দিনে দুবার চলার চেয়ে সেটা ঢের ভালো।
 * নতুন জব এই মডিউলেই যোগ করো, অথবা `ScheduleModule` আলাদা একটা
 * শেয়ার্ড মডিউলে সরাও।
 */
@Module({
  imports: SCHEDULING_ENABLED ? [ScheduleModule.forRoot()] : [],
  providers: [SummaryService, SummaryRefreshJob, DayCloseJob, RetentionJob],
  // এক্সপোর্ট করা আছে যাতে টেস্ট বা ভবিষ্যতের admin endpoint
  // `runOnce()` ইচ্ছে করে ডাকতে পারে
  exports: [SummaryService, SummaryRefreshJob, DayCloseJob, RetentionJob],
})
export class SummaryModule {}
