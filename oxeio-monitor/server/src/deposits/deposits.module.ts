import { Module } from '@nestjs/common';

import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

/**
 * R21 — সিকিউরিটি মানি (জামানত)।
 *
 * ⭐ `DepositsService` **export করা হয়** — দুজন কলার আছে: পে-রোলের শিট
 * (কর্তনের সারি) আর কর্মীর নিজের পাতা (`/me/deposit`)। হিসাবটা নকল করে
 * লিখলে একদিন দুটো পর্দা দুই সংখ্যা দেখাত, আর কোনটা সত্যি তা বলার উপায়
 * থাকত না।
 *
 * ⚠️ `PrismaModule` ও `AuditModule` `@Global`, তাই আলাদা import লাগে না।
 */
@Module({
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
