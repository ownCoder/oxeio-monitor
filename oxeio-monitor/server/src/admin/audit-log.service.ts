import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { AuditLogQueryDto } from './dto';

const DEFAULT_PAGE_SIZE = 50;

export interface AuditLogRow {
  /**
   * ⚠️⚠️ **স্ট্রিং, সংখ্যা নয়।** `audit_log.id` স্কিমায় `BigInt`, আর
   * `app.setup.ts`-এ BigInt-এর কোনো JSON সিরিয়ালাইজার বসানো **নেই** —
   * যাচাই করে দেখা হয়েছে। কাঁচা BigInt রেসপন্সে পাঠালে
   * `JSON.stringify` রানটাইমে ছুড়ত: "Do not know how to serialize a
   * BigInt", অর্থাৎ পুরো endpoint-টা ৫০০ হয়ে যেত — অথচ টাইপচেক নীরবে
   * পাস করত, কারণ টাইপ-লেভেলে কোনো ভুল নেই।
   *
   * ⚠️ আর `Number(id)` করাও চলত না: ৯ কোয়াড্রিলিয়নের পরে JS-এর সংখ্যা
   * নীরবে ভুল হতে শুরু করে।
   */
  id: string;
  occurredAt: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  meta: Prisma.JsonValue;
  user: {
    id: number;
    email: string;
    fullName: string;
    role: string;
  } | null;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * E11 — audit log ভিউয়ার, **owner-only**।
 *
 * শুধু পড়া। কোনো লেখা, মোছা বা সম্পাদনার পথ নেই — যে লগ বদলানো যায়,
 * সেটা আর প্রমাণ নয়।
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogQueryDto): Promise<AuditLogPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      // ⚠️ উল্টো রেঞ্জে Postgres নীরবে শূন্য সারি ফেরত দিত, আর ব্যবহারকারী
      //    ভাবত ওই সময়ে সত্যিই কিছু ঘটেনি
      throw new BadRequestException('`from` অবশ্যই `to`-র আগে হতে হবে');
    }

    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.targetType === undefined
        ? {}
        : { targetType: query.targetType }),
      ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
      ...(from || to
        ? {
            occurredAt: {
              ...(from ? { gte: from } : {}),
              // ⚠️ `lte` — inclusive। `?to=2026-08-10T23:59:59Z` লিখে কেউ
              //    যেন শেষ সেকেন্ডটা হারিয়ে না ফেলে।
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        // ⭐ `occurredAt` একা যথেষ্ট নয় — একই মিলিসেকেন্ডে দুটো সারি বসতেই
        //    পারে (login + change_setting একসাথে), আর তখন তাদের ক্রম
        //    অনির্ধারিত। পেজ ১ আর পেজ ২ আলাদা query, তাই ক্রম বদলে গেলে
        //    একটা সারি দুবার দেখাত আর আরেকটা কখনোই দেখাত না। `id` যোগ
        //    করায় ক্রমটা সম্পূর্ণ (total order) হয়।
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          occurredAt: true,
          action: true,
          targetType: true,
          targetId: true,
          ipAddress: true,
          meta: true,
          // ⚠️ `include: { user: true }` লিখলে `password_hash`ও রেসপন্সে
          //    চলে যেত। তাই সবসময় স্পষ্ট select।
          user: {
            select: { id: true, email: true, fullName: true, role: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: String(r.id),
        occurredAt: r.occurredAt.toISOString(),
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        ipAddress: r.ipAddress,
        meta: r.meta ?? null,
        user: r.user,
      })),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }
}
