import { Module } from '@nestjs/common';

import { AlertMailer } from '../alerts/alerts.mailer';
import { ReportsModule } from '../reports/reports.module';
import { DigestJob } from './digest.job';
import { DigestService } from './digest.service';

/**
 * **F07** — দৈনিক ডাইজেস্ট ইমেইল।
 *
 * ⚠️ `AlertMailer` এখানে **provider হিসেবে বসানো**, `AlertsModule` import
 * করে নয় — কারণ `AlertsModule` কেবল `AlertsService` export করে, মেইলারটা
 * নয়। SMTP-র কোড নকল করা হয়নি (সেটাই আসল নিয়ম): একই ক্লাস, শুধু আলাদা
 * ইনস্ট্যান্স। মেইলার transport **অলস** ভাবে বানায় আর দিনে একবারই
 * ব্যবহৃত হয়, তাই দ্বিতীয় ইনস্ট্যান্সের দাম কার্যত শূন্য।
 *
 * ⭐ ভালো হতো `AlertsModule`-এ এক লাইনে `exports: [AlertsService, AlertMailer]`
 * লেখা আর এখানে সেটা import করা — তখন SMTP কানেকশনও একটাই থাকত। ওই
 * ফাইলটা অন্য কারো, তাই বদলানো হয়নি; করলে এখানকার `providers` থেকে
 * `AlertMailer` মুছে `imports`-এ `AlertsModule` বসালেই হবে।
 *
 * ⚠️ `ScheduleModule.forRoot()` এখানে **নেই** — `SummaryModule` ওটা global
 * করে রেখেছে। দ্বিতীয় একটা forRoot বসালে দুটো explorer একই `@Cron` দুবার
 * রেজিস্টার করত (bootstrap ভেঙে পড়ত, আর তার আগে ইমেইল দিনে দুবার যেত)।
 */
@Module({
  imports: [ReportsModule],
  providers: [DigestService, DigestJob, AlertMailer],
  // টেস্ট বা ভবিষ্যতের কোনো admin endpoint যেন `runOnce()` ইচ্ছে করে
  // ডাকতে পারে — সন্ধ্যা ৬:৩০ পর্যন্ত অপেক্ষা করে SMTP যাচাই করা যায় না
  exports: [DigestService, DigestJob],
})
export class DigestModule {}
