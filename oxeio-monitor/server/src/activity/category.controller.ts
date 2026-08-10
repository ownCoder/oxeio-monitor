import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import {
  CategoryService,
  type CategoryRuleView,
  type DeleteResult,
} from './category.service';
import { CreateCategoryDto, RecategorizeDto, UpdateCategoryDto } from './dto';

/**
 * D06 — মালিকের ক্যাটাগরি রুল (`/api/v1/categories`, স্পেক § ৪.২)।
 *
 * ⚠️ পুরো কন্ট্রোলারটাই **owner-only** — মেথড-লেভেলে নয়, ক্লাস-লেভেলে।
 * পরে কেউ নতুন endpoint যোগ করলে সেটাও আপনাআপনি owner-only থাকবে।
 * মেথডে বসালে নতুন endpoint নীরবে ম্যানেজারের নাগালে চলে যেত — আর
 * ক্যাটাগরির নিয়ম বদলানো মানে **সবার রিপোর্টের সংখ্যা বদলে দেওয়া**
 * (স্পেক § ৪.৩: সেটিংস শুধু owner-এর)।
 */
@Roles(UserRole.owner)
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  list(): Promise<CategoryRuleView[]> {
    return this.categories.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: SessionUser,
    @Body() dto: CreateCategoryDto,
    @Ip() ip: string,
  ): Promise<CategoryRuleView> {
    return this.categories.create(dto, actor.userId, ip);
  }

  /**
   * ⚠️ এই রুটটা `PATCH /categories/:id`-এর **আগে** ঘোষণা করা হয়নি বলে
   * সমস্যা নেই — পথ দুটো আলাদা HTTP মেথডে। কিন্তু `POST /categories`
   * আর `POST /categories/recategorize`-এর মধ্যে ক্রম গুরুত্বপূর্ণ হতো
   * যদি কখনো `POST /categories/:id` যোগ হয়; তখন এটাকে উপরে তুলতে হবে।
   */
  @Post('recategorize')
  @HttpCode(HttpStatus.OK)
  recategorize(
    @CurrentUser() actor: SessionUser,
    @Body() dto: RecategorizeDto,
    @Ip() ip: string,
  ): Promise<{ scanned: number; changed: number }> {
    return this.categories.recategorize(dto, actor.userId, ip);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @Ip() ip: string,
  ): Promise<CategoryRuleView> {
    return this.categories.update(id, dto, actor.userId, ip);
  }

  /**
   * ⚠️ ২০৪ নয়, ২০০ — রেসপন্সে **কত সারি অচেনা হয়ে গেল** সেটা ফেরত যায়।
   * ২০৪ দিলে মালিক জানতেন না যে একটা রুল মোছার ফলে হাজার সারি D07-এর
   * হিসাবের বাইরে চলে গেল।
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ): Promise<DeleteResult> {
    return this.categories.remove(id, actor.userId, ip);
  }
}
