import { createReadStream } from 'node:fs';

import {
  Controller,
  Get,
  Header,
  Ip,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';

import { CurrentUser, Public } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { GalleryQueryDto, ScreenshotFileQueryDto } from './dto';
import {
  SCREENSHOT_MIME,
  ScreenshotsService,
  type GalleryPage,
} from './screenshots.service';

/**
 * `/api/v1/screenshots` (গ্লোবাল প্রিফিক্স app.setup.ts-এ)।
 *
 * ⚠️ ক্লাস-লেভেলে `@Roles(...)` **নেই**, আর সেটা ইচ্ছাকৃত। owner, manager
 *    আর স্টাফ — তিনজনেই এখানে আসতে পারে (স্পেক § ৪.৩ + J05)। কে কী দেখবে
 *    সেটা role দিয়ে নয়, **স্কোপ** দিয়ে ঠিক হয় (service.resolveEmployeeScope)।
 *    এখানে ভুল করে `@Roles(owner, manager, employee)` লিখলে মনে হতো
 *    সুরক্ষা আছে, অথচ সেটা "সবাই ঢুকতে পারবে" ছাড়া কিছুই বলত না।
 */
@Controller('screenshots')
export class ScreenshotsController {
  constructor(private readonly screenshots: ScreenshotsService) {}

  /** E06 — `GET /api/v1/screenshots?employeeId=&date=&page=` */
  @Get()
  list(
    @CurrentUser() actor: SessionUser,
    @Ip() ip: string,
    @Query() query: GalleryQueryDto,
  ): Promise<GalleryPage> {
    return this.screenshots.gallery(actor, query, ip);
  }

  /**
   * I07 — `GET /api/v1/screenshots/:id/file?token=`
   *
   * ⚠️ `@Public()` — সেশন cookie ছাড়াই খোলে, কারণ ব্রাউজার `<img src>`-এ
   *    কাস্টম হেডার পাঠাতে পারে না। যাচাইটা সম্পূর্ণ টোকেনের উপরে, আর
   *    টোকেন ৫ মিনিটেই মরে যায়।
   *
   * ⚠️ এখানে **audit লেখা হয় না** — লেখা হয়েছে লিঙ্ক বানানোর সময় (I08,
   *    gallery)। এখানে লিখলে ব্রাউজারের ক্যাশ, প্রিফেচ বা রিট্রাই প্রতিটাই
   *    "কেউ দেখল" হিসেবে গোনা হতো, আর এখানে "কে" বলতে টোকেনে লেখা
   *    userId ছাড়া কিছুই নেই — সেটা তো লিঙ্ক বানানোর সময়েই জানা ছিল।
   */
  @Public()
  @Get(':id/file')
  // মেয়াদ যেহেতু ৫ মিনিট, ততক্ষণ ব্রাউজার ক্যাশ করলে ক্ষতি নেই — গ্রিডে
  // স্ক্রল করে ফিরে এলে প্রতিবার নতুন করে ছবি নামবে না। `private` — কোনো
  // শেয়ার্ড প্রক্সি যেন কারো স্ক্রিনশট ধরে না রাখে।
  @Header('Cache-Control', 'private, max-age=300')
  async file(
    @Param('id') id: string,
    @Query() query: ScreenshotFileQueryDto,
  ): Promise<StreamableFile> {
    const found = await this.screenshots.resolveFile(id, query.token);

    // ⚠️ পুরো ফাইল মেমরিতে না তুলে stream — ৬০টা ছবির গ্রিড একসাথে লোড
    //    হলে readFile ব্যবহার করলে সার্ভারের RAM-এ ঢেউ উঠত।
    return new StreamableFile(createReadStream(found.absPath), {
      type: SCREENSHOT_MIME,
      disposition: `inline; filename="${found.downloadName}"`,
      length: found.sizeBytes,
    });
  }
}
