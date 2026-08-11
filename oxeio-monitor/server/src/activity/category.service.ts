import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MatchType, Productivity } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { patternProblem } from './activity.math';
import { AppCategoryService } from './app-category.service';
import type {
  CreateCategoryDto,
  RecategorizeDto,
  UpdateCategoryDto,
} from './dto';

export interface CategoryRuleView {
  id: number;
  matchType: MatchType;
  pattern: string;
  displayName: string;
  category: Productivity;
  /** ছোট সংখ্যা আগে জেতে */
  priority: number;
}

export interface DeleteResult {
  deleted: CategoryRuleView;
  /**
   * ⚠️ যত সারির ক্যাটাগরি এই মোছার ফলে `null` হয়ে গেল।
   *
   * FK-টা `ON DELETE SET NULL`, তাই ডাটাবেস নিজেই সারিগুলো "অচেনা" করে দেয়।
   * সংখ্যাটা ফেরত না দিলে মালিক জানতেন না যে একটা রুল মুছে তিনি হাজার
   * সারিকে D07-এর হিসাবের বাইরে ফেলে দিয়েছেন।
   */
  orphanedRows: number;
  hint: string;
}

const SELECT = {
  id: true,
  matchType: true,
  pattern: true,
  displayName: true,
  category: true,
  priority: true,
} as const;

/**
 * D06 — মালিকের ক্যাটাগরি রুল।
 *
 * ⭐ **প্রতিটা mutation-এর পর `AppCategoryService.invalidate()` ডাকতেই হবে।**
 * নিয়মগুলো ৫ মিনিটের TTL-এ ক্যাশ করা থাকে; না ফেললে —
 *
 * ১· নতুন বা বদলানো রুল পাঁচ মিনিট পর্যন্ত কিছুই করত না। মালিক দেখতেন
 *    রুলটা তালিকায় আছে অথচ ingest পুরোনো সিদ্ধান্তই বসাচ্ছে।
 * ২· **মুছে ফেলা রুলের id ক্যাশে বসে থাকত**, আর ingest সেই id দিয়ে insert
 *    করতে গিয়ে foreign key ভেঙে ৫০০ দিত — টানা পাঁচ মিনিট
 *    ([09 § ৩অ.১১](../../../../docs/09-Build-Log.md))।
 *
 * ⚠️ একাধিক API ইনস্ট্যান্স চললে `invalidate()` শুধু **নিজের** প্রসেসের
 * ক্যাশ ফেলে; বাকিদের জন্য TTL-ই ভরসা। v1-এ একটাই কন্টেইনার (§ ৬.১),
 * তাই এটা এখন সমস্যা নয় — কিন্তু স্কেল করলে হবে।
 */
@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: AppCategoryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * ম্যাচারের ক্রমেই তালিকা — যাতে মালিক ঠিক সেই ক্রমে দেখেন যে ক্রমে
   * নিয়মগুলো আসলে জেতে ([category-matcher.ts](./category-matcher.ts)-এর
   * `compile()`)। বর্ণক্রমে সাজালে "আমার নতুন রুলটা কেন জিতছে না" প্রশ্নের
   * উত্তর তালিকা দেখে বোঝা যেত না।
   */
  async list(): Promise<CategoryRuleView[]> {
    return this.prisma.appCategory.findMany({
      select: SELECT,
      orderBy: [{ priority: 'asc' }, { pattern: 'asc' }, { id: 'asc' }],
    });
  }

  async create(
    dto: CreateCategoryDto,
    actorUserId: number,
    ip: string,
  ): Promise<CategoryRuleView> {
    this.assertPattern(dto.matchType, dto.pattern);

    const pattern = dto.pattern.trim();
    await this.assertNotDuplicate(dto.matchType, pattern, null);

    const rule = await this.prisma.appCategory.create({
      data: {
        matchType: dto.matchType,
        pattern,
        displayName: dto.displayName.trim(),
        category: dto.category,
        priority: dto.priority ?? 100,
      },
      select: SELECT,
    });

    // ⭐ DB লেখার সাথে সাথেই — audit-এর আগে। audit ব্যর্থ হলেও (ওটা নিজে
    //    গিলে ফেলে) ক্যাশ যেন কোনোভাবেই বাসি না থেকে যায়।
    this.categories.invalidate();

    await this.audit.record({
      userId: actorUserId,
      action: 'change_setting',
      targetType: 'app_category',
      targetId: rule.id,
      ipAddress: ip,
      meta: { op: 'create', ...ruleMeta(rule) },
    });

    return rule;
  }

  async update(
    id: number,
    dto: UpdateCategoryDto,
    actorUserId: number,
    ip: string,
  ): Promise<CategoryRuleView> {
    const before = await this.prisma.appCategory.findUnique({
      where: { id },
      select: SELECT,
    });
    if (!before) throw new NotFoundException(`No rule with id ${id}`);

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields were given to change');
    }

    // ⚠️ `matchType` বদলালে প্যাটার্ন আগের মতোই থাকতে পারে, কিন্তু নিয়ম
    //    বদলে যায় — তাই যাচাই সবসময় **শেষ অবস্থার** উপর, শুধু যা এল তার উপর নয়।
    const matchType = dto.matchType ?? before.matchType;
    const pattern = (dto.pattern ?? before.pattern).trim();
    this.assertPattern(matchType, pattern);
    await this.assertNotDuplicate(matchType, pattern, id);

    const rule = await this.prisma.appCategory.update({
      where: { id },
      data: {
        matchType,
        pattern,
        displayName: dto.displayName?.trim() ?? before.displayName,
        category: dto.category ?? before.category,
        priority: dto.priority ?? before.priority,
      },
      select: SELECT,
    });

    this.categories.invalidate();

    await this.audit.record({
      userId: actorUserId,
      action: 'change_setting',
      targetType: 'app_category',
      targetId: id,
      ipAddress: ip,
      // ⭐ আগে-পরে দুটোই — নইলে অডিট থেকে শুধু জানা যেত "কেউ কিছু বদলেছিল"
      meta: { op: 'update', before: ruleMeta(before), after: ruleMeta(rule) },
    });

    return rule;
  }

  async remove(
    id: number,
    actorUserId: number,
    ip: string,
  ): Promise<DeleteResult> {
    const rule = await this.prisma.appCategory.findUnique({
      where: { id },
      select: SELECT,
    });
    if (!rule) throw new NotFoundException(`No rule with id ${id}`);

    // ⚠️ মোছার **আগে** গোনা — পরে গুনলে সব সারিতে ইতিমধ্যেই null বসে গেছে
    const orphanedRows = await this.prisma.appUsage.count({
      where: { categoryId: id },
    });

    await this.prisma.appCategory.delete({ where: { id } });
    this.categories.invalidate();

    await this.audit.record({
      userId: actorUserId,
      action: 'change_setting',
      targetType: 'app_category',
      targetId: id,
      ipAddress: ip,
      meta: { op: 'delete', ...ruleMeta(rule), orphanedRows },
    });

    if (orphanedRows > 0) {
      this.logger.warn(
        `Deleting rule ${id} (${rule.pattern}) left ${orphanedRows} rows uncategorized — a recategorize run is needed`,
      );
    }

    return {
      deleted: rule,
      orphanedRows,
      hint:
        orphanedRows === 0
          ? 'No existing rows were using this rule'
          : `${orphanedRows} rows now have a null category — run POST /api/v1/categories/recategorize to see whether any other rule matches them`,
    };
  }

  /**
   * পুরোনো সারিতে নতুন নিয়ম বসানো।
   *
   * ⚠️ **ক্যাটাগরি বসে ingest-এ, পড়ার সময় নয়** — তাই নিয়ম বদলালে পুরোনো
   * সারিতে পুরোনো সিদ্ধান্তই বসে থাকে। সেটা না সরালে D07-এর স্কোর
   * সপ্তাহের পর সপ্তাহ পুরোনো নিয়ম অনুযায়ী চলত, অথচ তালিকায় নতুন
   * নিয়মটাই দেখা যেত।
   *
   * ⚠️ কাজটা **সিনক্রোনাস** — এক মাসে লাখখানেক সারিতে কয়েক সেকেন্ড লাগতে
   * পারে। owner-only আর বিরল কাজ বলে ব্যাকগ্রাউন্ড queue বসানো হয়নি;
   * বসালে "কখন শেষ হলো" জানানোর একটা গোটা ব্যবস্থা লাগত।
   */
  async recategorize(
    dto: RecategorizeDto,
    actorUserId: number,
    ip: string,
  ): Promise<{ scanned: number; changed: number }> {
    // ⭐ আগে ক্যাশ ফেলা — নইলে পুরোনো নিয়ম দিয়েই "নতুন করে" বসানো হতো,
    //    আর ফলাফলটা দেখতে সফল লাগত
    this.categories.invalidate();

    const result = await this.categories.recategorize({
      onlyUnmatched: dto.onlyUnmatched,
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'change_setting',
      targetType: 'app_category',
      targetId: 'recategorize',
      ipAddress: ip,
      meta: { op: 'recategorize', onlyUnmatched: dto.onlyUnmatched ?? false, ...result },
    });

    return result;
  }

  /**
   * ⭐ লেখার সময়ই প্যাটার্ন যাচাই — কারণ `compile()` ভুল প্যাটার্ন **নীরবে
   * বাদ** দেয়। যাচাই না করলে রুলটা তালিকায় থাকত অথচ কোনোদিন কিছু করত না।
   */
  private assertPattern(matchType: MatchType, pattern: string): void {
    const problem = patternProblem(matchType, pattern);
    if (problem !== null) throw new BadRequestException(problem);
  }

  /**
   * ⚠️ একই (matchType, pattern) দু-বার থাকলে দ্বিতীয়টা কোনোদিন জিতত না
   * (ম্যাচার শুধু **প্রথম মিল** নেয়)। মালিক তখন দ্বিতীয়টার ক্যাটাগরি বদলে
   * বদলে দেখতেন কিছুই হচ্ছে না। ডাটাবেসে unique constraint নেই, তাই
   * এখানেই ঠেকানো হয়।
   */
  private async assertNotDuplicate(
    matchType: MatchType,
    pattern: string,
    exceptId: number | null,
  ): Promise<void> {
    const clash = await this.prisma.appCategory.findFirst({
      where: {
        matchType,
        pattern,
        ...(exceptId === null ? {} : { id: { not: exceptId } }),
      },
      select: { id: true },
    });

    if (clash) {
      throw new BadRequestException(
        `A rule of this kind for "${pattern}" already exists (id ${clash.id}) — edit that one instead`,
      );
    }
  }
}

/** অডিটে যা লেখা থাকে — পুরো সারি নয়, যেটুকু দেখে পরে বোঝা যাবে। */
function ruleMeta(rule: CategoryRuleView): Record<string, string | number> {
  return {
    matchType: rule.matchType,
    pattern: rule.pattern,
    displayName: rule.displayName,
    category: rule.category,
    priority: rule.priority,
  };
}
