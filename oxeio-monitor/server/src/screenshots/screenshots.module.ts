import { Module } from '@nestjs/common';

import { ScreenshotsController } from './screenshots.controller';
import { ScreenshotsService } from './screenshots.service';
import { SignedUrlService } from './signed-url.service';

/**
 * E06 · I07 · I08 · J05 — স্ক্রিনশট গ্যালারি ও signed URL।
 *
 * PrismaModule আর AuditModule দুটোই `@Global`, ConfigModule-ও
 * `isGlobal: true` — তাই এখানে আলাদা করে `imports` লাগে না।
 *
 * `SignedUrlService` এক্সপোর্ট করা হয়েছে, কারণ Live Board (E03) কার্ডে
 * সর্বশেষ থাম্বনেইল দেখাতে গিয়ে একই সই লাগবে — সেখানে যেন কেউ নতুন করে
 * নিজের মতো টোকেন-ফরম্যাট না বানায়।
 */
@Module({
  controllers: [ScreenshotsController],
  providers: [ScreenshotsService, SignedUrlService],
  exports: [SignedUrlService],
})
export class ScreenshotsModule {}
