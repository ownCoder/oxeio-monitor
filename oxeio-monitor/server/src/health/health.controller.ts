import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /// Docker healthcheck · Live Board-এর "সার্ভার আছে তো?" · আর বাইরের
  /// uptime নজরদারি (R4) — তিনটেই এখানে। লগইন ছাড়াই পৌঁছাতে হয়, তাই @Public।
  ///
  /// ⚠️⚠️ **ডাটাবেস মরে গেলেও এটা HTTP ২০০ ফেরায়** — কেবল বডিতে
  /// `status: 'degraded'` লেখে। দেখে ভুল মনে হয়, কিন্তু ৫০৩ করা যাবে না:
  /// Docker-এর healthcheck এই একই পথ ধরে, আর ব্যর্থ healthcheck মানে
  /// কনটেইনার রিস্টার্ট। ডাটাবেস ডাউন থাকলে API রিস্টার্ট করে কিছুই
  /// সারে না — শুধু **রিস্টার্ট লুপ** তৈরি হয়, আর তাতে লগও হারায়।
  ///
  /// ⭐ তাই বাইরের নজরদারিকে **স্ট্যাটাস কোড নয়, শব্দ** দেখতে হবে:
  /// UptimeRobot-এ "Keyword" মনিটর, keyword `"db":"up"`
  /// (`deploy/README.md § R4`)। ⚠️ শুধু স্ট্যাটাস কোড দেখলে ডাটাবেস মরে
  /// পড়ে থাকলেও সে চিরকাল "UP" দেখাত — ঠিক যে অন্ধ জায়গাটা R4 ঢাকার কথা।
  @Public()
  @Get()
  async check(): Promise<{
    status: 'ok' | 'degraded';
    db: 'up' | 'down';
    time: string;
    /**
     * ⭐ কোন বিল্ড চলছে — ড্যাশবোর্ডের কোণার ব্যাজ এটা নিয়েই নিজেরটার
     * সাথে মেলায়।
     *
     * ⚠️⚠️ অর্ধেক ডিপ্লয় (নতুন ওয়েব, পুরোনো api) নইলে **সম্পূর্ণ নীরব**
     * থাকত: পাতা নতুন দেখাত, অথচ API পুরোনো উত্তর দিত। "ফিক্সটা তো
     * বসিয়েছি, কাজ করছে না কেন" — এই প্রশ্নের উত্তর খুঁজতে ঘণ্টা যেত।
     */
    build: string;
    commit: string;
  }> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      time: new Date().toISOString(),
      // ⚠️ ডিফল্ট `dev`/`local` — Docker ছাড়া (npm run start:dev) চালালে
      //    চলকগুলো থাকে না, আর তখন মিথ্যে সংখ্যা দেখানোর চেয়ে "dev" ভালো।
      build: process.env.APP_BUILD || 'dev',
      commit: process.env.APP_COMMIT || 'local',
    };
  }
}
