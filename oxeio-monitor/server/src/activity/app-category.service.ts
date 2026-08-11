import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  compile,
  matchCategory,
  type CompiledRule,
  type UsageFacts,
} from './category-matcher';

/** recategorize()-এর পাতায় যতটুকু লাগে। */
interface UsageRow {
  id: bigint;
  processName: string;
  domain: string | null;
  windowTitle: string | null;
  categoryId: number | null;
}

/**
 * ক্যাটাগরির নিয়মগুলো ধরে রাখা ও প্রয়োগ করা (D05)।
 *
 * নিয়ম বদলায় খুব কম — মালিক মাঝেমধ্যে একটা ডোমেইন যোগ করেন (D06)।
 * কিন্তু ingest-এ প্রতিটা সারির জন্য সেগুলো লাগে, আর ব্যস্ত সময়ে
 * ১৫টা PC থেকে প্রতি ৫ মিনিটে ব্যাচ আসে। তাই ক্যাশ।
 */
@Injectable()
export class AppCategoryService {
  private readonly logger = new Logger(AppCategoryService.name);

  /**
   * ক্যাশের আয়ু। D06 এলে <see cref="invalidate"/> সাথে সাথেই ডাকা হবে;
   * ততক্ষণ এই TTL-টাই নিশ্চিত করে যে seed বদলালে সার্ভার রিস্টার্ট ছাড়াও
   * পাঁচ মিনিটের মধ্যে নতুন নিয়ম কাজে লাগে।
   */
  private static readonly TtlMs = 5 * 60_000;

  private cache: { rules: CompiledRule[]; at: number } | null = null;

  /**
   * ⚠️ একসাথে কয়েকটা ব্যাচ এলে প্রত্যেকে আলাদা করে DB-তে যেত। একটাই
   *    in-flight প্রতিশ্রুতি সবাই ভাগ করে নেয়।
   */
  private loading: Promise<CompiledRule[]> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** নিয়ম বদলালে (D06) ডাকতে হবে — পরের কলেই নতুন করে পড়া হবে। */
  invalidate(): void {
    this.cache = null;
  }

  async rules(now = Date.now()): Promise<CompiledRule[]> {
    if (this.cache && now - this.cache.at < AppCategoryService.TtlMs) {
      return this.cache.rules;
    }

    this.loading ??= this.load(now).finally(() => {
      this.loading = null;
    });

    return this.loading;
  }

  private async load(now: number): Promise<CompiledRule[]> {
    const raw = await this.prisma.appCategory.findMany({
      select: {
        id: true,
        matchType: true,
        pattern: true,
        displayName: true,
        category: true,
        priority: true,
      },
    });

    const rules = compile(raw);

    if (rules.length < raw.length) {
      // compile() শুধু ভুল বা খালি প্যাটার্ন ফেলে দেয় — নীরবে নয়
      this.logger.warn(
        `${raw.length - rules.length} category rules were skipped (invalid regex or empty pattern)`,
      );
    }

    this.cache = { rules, at: now };
    return rules;
  }

  /**
   * একটা সারি কোন ক্যাটাগরিতে পড়ে — মিল না পেলে <c>null</c>।
   *
   * ⚠️ অচেনা অ্যাপ জোর করে "neutral" বানানো হয় না। null আর neutral এক নয়:
   * null মানে "আমরা জানি না", neutral মানে "জানি, এবং এটা নিরপেক্ষ"।
   * দুটো মিলিয়ে ফেললে D07-এর স্কোরে অচেনা অ্যাপগুলো নিঃশব্দে ভালো দিকে
   * গোনা হতো, আর কোন অ্যাপগুলো এখনো নিয়মের বাইরে সেটাও জানা যেত না।
   */
  async categoryIdFor(facts: UsageFacts): Promise<number | null> {
    const rules = await this.rules();
    return matchCategory(rules, facts)?.id ?? null;
  }

  /**
   * পুরোনো সারিগুলো আবার ক্যাটাগরি করা।
   *
   * দরকার হয় দুই সময়ে: নিয়ম বদলালে (D06 — পুরোনো সারিতে পুরোনো
   * সিদ্ধান্ত বসে আছে), আর যেসব সারি নিয়ম আসার আগেই জমেছিল।
   *
   * ⚠️ পাতায় পাতায় করা হয় — এক মাসে ১৫টা PC থেকে লাখখানেক সারি জমে,
   * সবগুলো একসাথে মেমোরিতে তোলা যাবে না।
   */
  async recategorize(
    options: { onlyUnmatched?: boolean; pageSize?: number } = {},
  ): Promise<{ scanned: number; changed: number }> {
    const rules = await this.rules();
    const pageSize = options.pageSize ?? 2_000;

    let cursor: bigint | null = null;
    let scanned = 0;
    let changed = 0;

    for (;;) {
      // ⚠️ টাইপটা হাতে লেখা: `cursor` আসে `page`-এর ভেতর থেকে, আর `page`-এর
      //    টাইপ আসে `cursor`-নির্ভর where থেকে — TypeScript বৃত্তটা ভাঙতে পারে না।
      const page: UsageRow[] = await this.prisma.appUsage.findMany({
        where: {
          ...(options.onlyUnmatched === true ? { categoryId: null } : {}),
          ...(cursor === null ? {} : { id: { gt: cursor } }),
        },
        select: {
          id: true,
          processName: true,
          domain: true,
          windowTitle: true,
          categoryId: true,
        },
        orderBy: { id: 'asc' },
        take: pageSize,
      });

      if (page.length === 0) break;

      scanned += page.length;
      cursor = page[page.length - 1].id;

      // ⚠️ প্রতি সারিতে একটা UPDATE নয় — একই ক্যাটাগরিতে যাওয়া সব সারি
      //    একসাথে। নইলে ২০০০ সারির পাতায় ২০০০টা রাউন্ড-ট্রিপ হতো।
      const byCategory = new Map<number | null, bigint[]>();

      for (const row of page) {
        const next = matchCategory(rules, row)?.id ?? null;
        if (next === row.categoryId) continue;

        const bucket = byCategory.get(next);
        if (bucket) bucket.push(row.id);
        else byCategory.set(next, [row.id]);
      }

      for (const [categoryId, ids] of byCategory) {
        await this.prisma.appUsage.updateMany({
          where: { id: { in: ids } },
          data: { categoryId },
        });
        changed += ids.length;
      }

      if (page.length < pageSize) break;
    }

    this.logger.log(`Recategorised: ${scanned} scanned, ${changed} changed`);
    return { scanned, changed };
  }
}
