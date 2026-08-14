import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /// Docker healthcheck ও Live Board-এর "সার্ভার আছে তো?" — দুটোই এখানে।
  /// লগইন ছাড়াই পৌঁছাতে হয়, তাই @Public।
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
