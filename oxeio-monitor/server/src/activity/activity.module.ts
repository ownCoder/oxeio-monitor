import { Module } from '@nestjs/common';

import { AppCategoryService } from './app-category.service';

/**
 * অ্যাপ/সাইটের ক্যাটাগরি (D05–D08)।
 *
 * ⚠️ `AgentModule`-এ না রেখে আলাদা মডিউল, কারণ পরে ড্যাশবোর্ডের রিপোর্টও
 * (D07 স্কোর, D08 টপ ১০) এই নিয়মগুলোই ব্যবহার করবে — আর ওগুলো এজেন্টের
 * সাথে কোনোভাবেই যুক্ত নয়।
 */
@Module({
  providers: [AppCategoryService],
  exports: [AppCategoryService],
})
export class ActivityModule {}
