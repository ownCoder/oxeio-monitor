import { Module } from '@nestjs/common';

import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { AppCategoryService } from './app-category.service';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';

/**
 * অ্যাপ/সাইটের ক্যাটাগরি ও রিপোর্ট (D05–D09)।
 *
 * ⚠️ `AgentModule`-এ না রেখে আলাদা মডিউল, কারণ ড্যাশবোর্ডের রিপোর্টও
 * (D07 স্কোর, D08 টপ ১০, D09 টিম) এই নিয়মগুলোই ব্যবহার করে — আর ওগুলো
 * এজেন্টের সাথে কোনোভাবেই যুক্ত নয়।
 *
 * `PrismaModule` ও `AuditModule` দুটোই `@Global`, তাই আলাদা করে
 * `imports` করতে হয় না।
 *
 * ⚠️ `AppCategoryService` **এখানেই** থাকে আর এখান থেকেই export হয়।
 * `AgentModule` এই মডিউলটাই import করে, তাই ingest আর D06 একই ইনস্ট্যান্স
 * পায় — নইলে `invalidate()` নিজের কপির ক্যাশ ফেলত আর ingest-এর কপি
 * পাঁচ মিনিট পুরোনো নিয়মেই চলত ([09 § ৩অ.১১](../../../../docs/09-Build-Log.md))।
 */
@Module({
  controllers: [CategoryController, ActivityController],
  providers: [AppCategoryService, CategoryService, ActivityService],
  exports: [AppCategoryService],
})
export class ActivityModule {}
