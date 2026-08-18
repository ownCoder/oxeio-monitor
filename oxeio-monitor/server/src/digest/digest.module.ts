import { Module } from '@nestjs/common';

import { AlertMailer } from '../alerts/alerts.mailer';
import { TelegramChannel } from '../alerts/telegram.channel';
import { TeamsChannel } from '../alerts/teams.channel';
import { ReportsModule } from '../reports/reports.module';
import { DigestJob } from './digest.job';
import { DigestService } from './digest.service';
import { WeeklyDigestJob } from './weekly.job';
import { WeeklyDigestService } from './weekly.service';

/**
 * **F07** — দৈনিক ডাইজেস্ট ইমেইল, **R3** — সাপ্তাহিক সারাংশ টেলিগ্রামে।
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
 *
 * ⚠️ `TelegramChannel`ও একইভাবে provider হিসেবে বসানো (R3-এর জন্য) — ওটা
 * `OpsModule`-এর provider, কিন্তু ওই মডিউল সেটা export করে না, আর
 * `ops.module.ts` এই কাজের আওতার বাইরে। ক্লাসটা নকল করা হয়নি: একই ক্লাস,
 * শুধু আলাদা ইনস্ট্যান্স, আর তার দাম কার্যত শূন্য (দুটো স্ট্রিং + একটা
 * খালি Map)।
 * ⚠️⚠️ এই ইনস্ট্যান্সে শুধু `send()` ডাকা হয়, **`runOnce()` কখনো নয়** —
 * ওটা অ্যালার্টের sweep, আর দ্বিতীয় একটা sweep চললে প্রতিটা অ্যালার্ট
 * টেলিগ্রামে দুবার যেত। ⭐ `OpsModule` একদিন `TelegramChannel` export করলে
 * এখানকার `providers` থেকে সেটা মুছে `imports`-এ `OpsModule` বসালেই হবে —
 * তবে ⚠️ তখন খেয়াল রাখতে হবে বৃত্ত তৈরি না হয়।
 */
@Module({
  // ⚠️ `DashboardModule` এখানে ছিল কেবল ঘণ্টার স্ন্যাপশটের জন্য; সেটা
  //    তুলে দেওয়ায় নির্ভরতাটাও গেল (১৮ আগস্ট)
  imports: [ReportsModule],
  providers: [
    DigestService,
    DigestJob,
    AlertMailer,
    WeeklyDigestService,
    WeeklyDigestJob,
    TelegramChannel,
    /**
     * ⚠️⚠️ **ঘণ্টার স্ন্যাপশট (`SnapshotService`/`SnapshotJob`) তুলে দেওয়া
     * হয়েছে** *(১৮ আগস্ট ২০২৬, মালিকের সিদ্ধান্ত — ADR-029 বাতিল)*।
     *
     * ওটা এসেছিল রিয়েল-টাইম idle অ্যালার্টের **বিকল্প** হিসেবে: দিনে
     * ৬০–১৮০টা বার্তার বদলে ঘণ্টায় একটা। কিন্তু মাঠে দাঁড়াল দিনে ১১টা
     * স্ন্যাপশট + ৩৯টা `agent_down` = ~৫০টা বার্তা, আর তার নিচে চাপা
     * পড়ল সেই জিনিসটাই যেটা মালিক আসলে চেয়েছিলেন — দৈনিক রিপোর্ট।
     * ⭐ মালিকের কথায়: *"ami ei type er alart gula chaina. ami chai
     * deily report type er."*
     *
     * ⚠️ **ফিরিয়ে আনার আগে ভাবুন:** "এখন কে কাজ করছে" প্রশ্নের উত্তর
     * Live Board-এ **সবসময়** আছে; ঠেলে পাঠানোর দরকার ছিল না।
     */
    // ⭐ Teams — টেলিগ্রামের পাশাপাশি, বিকল্প নয়
    TeamsChannel,
  ],
  // টেস্ট বা ভবিষ্যতের কোনো admin endpoint যেন `runOnce()` ইচ্ছে করে
  // ডাকতে পারে — সন্ধ্যা ৬:৩০ (বা শুক্রবার) পর্যন্ত অপেক্ষা করে SMTP বা
  // টেলিগ্রাম যাচাই করা যায় না
  exports: [DigestService, DigestJob, WeeklyDigestService, WeeklyDigestJob],
})
export class DigestModule {}
