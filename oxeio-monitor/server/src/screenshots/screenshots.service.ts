import { stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from '../auth/types';
import type { GalleryQueryDto } from './dto';
import { formatWorkDate, pageSlice, parseWorkDate } from './gallery.math';
import { SignedUrlService } from './signed-url.service';

export interface GalleryItem {
  /** ⚠️ string, number নয় — `screenshots.id` BigInt, আর BigInt JSON-এ যায় না */
  id: string;
  employeeId: number;
  empCode: string;
  fullName: string;
  capturedAt: string;
  slotStart: string;
  monitorIndex: number;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  activeApp: string | null;
  /** ⚠️ শুধু উইন্ডোর শিরোনাম আর ডোমেইন — ফুল URL কখনো জমা হয় না (§ ৭) */
  activeTitle: string | null;
  /** ৫ মিনিটে expire (I07) */
  thumbUrl: string;
  /** লাইটবক্সে ফুল ছবি — আলাদা টোকেন, আলাদা variant */
  fullUrl: string;
}

export interface GalleryPage {
  date: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: GalleryItem[];
}

export interface ResolvedScreenshotFile {
  absPath: string;
  sizeBytes: number;
  downloadName: string;
}

/** ADR-007 — এজেন্ট শুধু webp পাঠায়, তাই এটাই একমাত্র content-type */
export const SCREENSHOT_MIME = 'image/webp';

@Injectable()
export class ScreenshotsService {
  private readonly logger = new Logger(ScreenshotsService.name);
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly urls: SignedUrlService,
    config: ConfigService,
  ) {
    // ⚠️ ingest-এর (agent/screenshot-ingest.service.ts) সাথে **হুবহু** একই
    //    হিসাব। এখানে ডিফল্টটা আলাদা হলে আপলোড হতো এক ফোল্ডারে আর খোঁজা
    //    হতো আরেক ফোল্ডারে — সব ছবি ৪০৪, অথচ DB-তে সারি আছে।
    this.root = resolve(
      config.get<string>('STORAGE_ROOT') ??
        join(process.cwd(), '..', '.data', 'storage'),
    );
  }

  /**
   * E06 — `GET /api/v1/screenshots?employeeId=&date=&page=`
   *
   * I08-ও এখানেই: গ্রিডটা তৈরি হওয়া মানেই ছবিগুলো দেখানো হয়ে গেছে, তাই
   * অডিট এখানে লেখা হয়, `/file` endpoint-এ নয়।
   */
  async gallery(
    actor: SessionUser,
    query: GalleryQueryDto,
    ip: string,
  ): Promise<GalleryPage> {
    const workDate = this.resolveDate(query.date);
    const employeeId = this.resolveEmployeeScope(actor, query.employeeId);

    const where: Prisma.ScreenshotWhereInput = {
      workDate,
      // ⚠️ retention job আগে `deleted_at` বসায়, ফাইল মোছে পরে (ADR-006)।
      //    এই শর্তটা না দিলে গ্যালারিতে সারি দেখা যেত অথচ ছবি ৪০৪ হতো।
      deletedAt: null,
      ...(employeeId === null ? {} : { employeeId }),
    };

    const total = await this.prisma.screenshot.count({ where });
    const slice = pageSlice(query.page ?? 1, total);

    const rows = await this.prisma.screenshot.findMany({
      where,
      // ⚠️ `capturedAt`-এ টাই হতে পারে (একই স্লটে দুই মনিটর, বা একই
      //    মিলিসেকেন্ড)। সম্পূর্ণ ক্রম না দিলে দুই পাতায় একই ছবি দুবার আসত
      //    আর অন্য একটা ছবি কোনো পাতাতেই থাকত না — নীরবে।
      orderBy: [{ capturedAt: 'asc' }, { monitorIndex: 'asc' }, { id: 'asc' }],
      skip: slice.skip,
      take: slice.take,
      select: {
        id: true,
        employeeId: true,
        capturedAt: true,
        slotStart: true,
        monitorIndex: true,
        width: true,
        height: true,
        sizeBytes: true,
        activeApp: true,
        activeTitle: true,
        // ⚠️ employee থেকে শুধু নাম-কোড। `monthly_salary` এখানে select
        //    করা হয় না — বেতন শুধু payroll endpoint-এ (ADR-023)।
        employee: { select: { empCode: true, fullName: true } },
      },
    });

    const items: GalleryItem[] = rows.map((r) => ({
      id: r.id.toString(),
      employeeId: r.employeeId,
      empCode: r.employee.empCode,
      fullName: r.employee.fullName,
      capturedAt: r.capturedAt.toISOString(),
      slotStart: r.slotStart.toISOString(),
      monitorIndex: r.monitorIndex,
      width: r.width,
      height: r.height,
      sizeBytes: r.sizeBytes,
      activeApp: r.activeApp,
      activeTitle: r.activeTitle,
      thumbUrl: this.urls.urlFor(r.id, 'thumb', actor.userId),
      fullUrl: this.urls.urlFor(r.id, 'full', actor.userId),
    }));

    await this.recordView(actor, ip, workDate, slice.page, employeeId, rows);

    return {
      date: formatWorkDate(workDate),
      page: slice.page,
      pageSize: slice.pageSize,
      total,
      totalPages: slice.totalPages,
      items,
    };
  }

  /**
   * I07 — `GET /api/v1/screenshots/:id/file?token=`
   *
   * ⚠️ এই রুটে কোনো সেশন লাগে না (`@Public()`) — **টোকেনটাই পরিচয়**।
   *    কারণ `<img src="…">` দিয়ে ছবি লোড হয়, আর সেখানে কাস্টম হেডার
   *    বসানো যায় না। অনুমতির যাচাই তাই আগেই হয়ে গেছে: টোকেন বানানোর সময়
   *    (gallery)। স্টাফ শুধু নিজের ছবির টোকেনই পায়, তাই অন্যেরটার লিঙ্ক
   *    সে বানাতেই পারে না (J05)।
   */
  async resolveFile(
    idParam: string,
    token: string,
  ): Promise<ResolvedScreenshotFile> {
    if (!/^\d{1,19}$/.test(idParam)) {
      throw new BadRequestException('স্ক্রিনশট আইডি সংখ্যা হতে হবে');
    }

    const result = this.urls.verify(token);
    if (!result.ok) {
      throw new ForbiddenException(
        result.reason === 'expired'
          ? 'লিঙ্কের মেয়াদ শেষ (৫ মিনিট) — গ্যালারি রিফ্রেশ করুন'
          : 'লিঙ্কটি বৈধ নয়',
      );
    }

    // ⚠️ টোকেনে লেখা id আর পথের id মিলিয়ে দেখতেই হবে। না মেলালে একটা
    //    বৈধ টোকেন নিয়ে `:id` বদলে দিয়ে **যেকোনো** স্ক্রিনশট টেনে নেওয়া
    //    যেত — সইটা তখনো "বৈধ" বলত, কারণ সই তো টোকেনের, পথের নয়।
    const { screenshotId, variant, viewerUserId } = result.claims;
    if (screenshotId !== BigInt(idParam)) {
      throw new ForbiddenException('টোকেনটি এই স্ক্রিনশটের জন্য নয়');
    }

    const shot = await this.prisma.screenshot.findFirst({
      where: { id: screenshotId, deletedAt: null },
      select: { id: true, filePath: true, thumbPath: true, employeeId: true },
    });
    if (!shot)
      throw new NotFoundException('স্ক্রিনশটটি নেই বা মুছে ফেলা হয়েছে');

    /**
     * ⚠️ থাম্বনেইল এখনো তৈরি হয় না — ingest `thumb_path = null` রাখে,
     *    A06-এ sharp দিয়ে backfill হবে। ততক্ষণ গ্রিডে ফুল ছবিই যাচ্ছে।
     *    মানে: থাম্বনেইলের লিঙ্ক পাওয়া কেউ এখন ফুল-রেজ়লিউশনই পাবে।
     *    variant আলাদা রাখা হয়েছে যাতে A06 এলে **শুধু এই লাইনটা** বদলালেই
     *    আলাদা হয়ে যায়, কোনো টোকেন-ফরম্যাট বদলাতে হবে না।
     */
    const relPath =
      variant === 'thumb' ? (shot.thumbPath ?? shot.filePath) : shot.filePath;

    const absPath = resolve(this.root, relPath);

    // ⚠️ পথটা DB থেকে আসে, তবু বিশ্বাস করা হয় না। কোনোভাবে `..` ঢুকে
    //    গেলে (পুরোনো সারি, ম্যানুয়াল ইনসার্ট) storage-এর বাইরের যেকোনো
    //    ফাইল সার্ভ হয়ে যেত।
    if (absPath !== this.root && !absPath.startsWith(this.root + sep)) {
      this.logger.error(
        `স্ক্রিনশট ${shot.id.toString()}-এর পথ storage-এর বাইরে: ${relPath}`,
      );
      throw new NotFoundException('স্ক্রিনশটটি নেই');
    }

    let sizeBytes: number;
    try {
      const info = await stat(absPath);
      if (!info.isFile()) throw new Error('ফাইল নয়');
      sizeBytes = info.size;
    } catch {
      // ingest আগে DB-তে লেখে, পরে ডিস্কে — মাঝখানে ক্র্যাশ হলে সারি থাকে,
      // ফাইল থাকে না। ৫০০ নয়, এটা সত্যিই "নেই"।
      this.logger.warn(
        `স্ক্রিনশট ${shot.id.toString()}: DB-তে সারি আছে, ডিস্কে ফাইল নেই (${relPath})`,
      );
      throw new NotFoundException('ছবির ফাইলটি পাওয়া যায়নি');
    }

    this.logger.debug(
      `স্ক্রিনশট ${shot.id.toString()} (${variant}) সার্ভ হলো, টোকেন বানিয়েছিল user ${viewerUserId}`,
    );

    return {
      absPath,
      sizeBytes,
      downloadName: `${shot.id.toString()}_${variant}.webp`,
    };
  }

  // ── ভেতরের সাহায্যকারী ─────────────────────────────────────────────

  private resolveDate(iso?: string): Date {
    if (iso === undefined) {
      // ⚠️ ঢাকার "আজ", সার্ভারের UTC "আজ" নয় — রাত ১২টা থেকে ভোর ৬টার
      //    মধ্যে দুটো আলাদা তারিখ হয়।
      return workDateOf(new Date());
    }
    const parsed = parseWorkDate(iso);
    if (!parsed) throw new BadRequestException('তারিখটি বৈধ নয়');
    return parsed;
  }

  /**
   * J05 — ⭐ role=employee হলে `employeeId` **সেশন থেকে**, ক্যোয়ারি থেকে নয়।
   *
   * @returns `null` মানে ফিল্টার নেই (owner/manager, ওই দিনের সবার ছবি)
   */
  private resolveEmployeeScope(
    actor: SessionUser,
    requested?: number,
  ): number | null {
    if (actor.role !== UserRole.employee) {
      return requested ?? null;
    }

    if (actor.employeeId === null) {
      // role=employee অথচ কোনো স্টাফের সাথে যুক্ত নয় — অ্যাকাউন্ট তৈরিতে
      // ভুল। খালি লিস্ট দিলে সমস্যাটা চাপা পড়ে যেত।
      throw new ForbiddenException(
        'এই অ্যাকাউন্টটি কোনো স্টাফের সাথে যুক্ত নয়',
      );
    }

    // ⚠️ অন্যের আইডি চাইলে চুপচাপ নিজেরটা ফেরত দেওয়া হয় না — তাহলে
    //    ফ্রন্টএন্ড ভাবত ফিল্টারটা কাজ করেছে, আর স্ক্রিনে অন্য নাম নিয়ে
    //    নিজের ছবি দেখাত।
    if (requested !== undefined && requested !== actor.employeeId) {
      throw new ForbiddenException('শুধু নিজের স্ক্রিনশট দেখা যাবে');
    }

    return actor.employeeId;
  }

  /**
   * I08 — ⭐ "কে আমার স্ক্রিনশট দেখল" প্রশ্নের উত্তর এখানেই তৈরি হয়।
   * স্টাফের কাছে পুরো সিস্টেমটার বিশ্বাসযোগ্যতা এই সারিগুলোর উপরে দাঁড়ানো।
   *
   * ⭐ পাতাপ্রতি **একটি** সারি, ছবিপ্রতি নয়। গ্রিডে ৬০টা ছবি একসাথে খোলে,
   *    তাই ৬০টা আলাদা সারি একই তথ্যই ৬০ বার লিখত — শুধু audit_log ফুলে
   *    যেত আর E11-এর ভিউয়ারে আসল ঘটনাগুলো হারিয়ে যেত। কোন কোন ছবি
   *    দেখানো হলো, সেটা `meta.screenshotIds`-এ পুরোটাই আছে।
   *
   * ⚠️ কিছুই না দেখানো হলে (খালি পাতা) কিছু লেখা হয় না — কেউ কিছু দেখেনি।
   */
  private async recordView(
    actor: SessionUser,
    ip: string,
    workDate: Date,
    page: number,
    employeeId: number | null,
    rows: { id: bigint; employeeId: number }[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const subjects = [...new Set(rows.map((r) => r.employeeId))];

    await this.audit.record({
      userId: actor.userId,
      action: 'view_screenshot',
      // কার ছবি — একজনের ফিল্টার থাকলে তার আইডি, নইলে E11 meta দেখবে
      targetType: 'employee',
      targetId: employeeId ?? undefined,
      ipAddress: ip,
      meta: {
        date: formatWorkDate(workDate),
        page,
        count: rows.length,
        // ⚠️ BigInt সরাসরi JSON-এ দিলে Prisma ছুঁড়ে দেয় — string করতেই হবে
        screenshotIds: rows.map((r) => r.id.toString()),
        employeeIds: subjects,
        /** নিজের ছবি নিজে দেখলে (J05) — E11-এ এগুলো আলাদা করা যায় */
        self: actor.role === UserRole.employee,
      },
    });
  }
}
