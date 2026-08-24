import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

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
import { storageRoot } from '../common/storage.config';
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
      storageRoot(config),
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
      throw new BadRequestException('Screenshot id must be a number');
    }

    const result = this.urls.verify(token);
    if (!result.ok) {
      throw new ForbiddenException(
        result.reason === 'expired'
          ? 'This link has expired (5 minutes) — refresh the gallery'
          : 'This link is invalid',
      );
    }

    // ⚠️ টোকেনে লেখা id আর পথের id মিলিয়ে দেখতেই হবে। না মেলালে একটা
    //    বৈধ টোকেন নিয়ে `:id` বদলে দিয়ে **যেকোনো** স্ক্রিনশট টেনে নেওয়া
    //    যেত — সইটা তখনো "বৈধ" বলত, কারণ সই তো টোকেনের, পথের নয়।
    const { screenshotId, variant, viewerUserId } = result.claims;
    if (screenshotId !== BigInt(idParam)) {
      throw new ForbiddenException('This token is not for this screenshot');
    }

    const shot = await this.prisma.screenshot.findFirst({
      where: { id: screenshotId, deletedAt: null },
      select: { id: true, filePath: true, thumbPath: true, employeeId: true },
    });
    if (!shot)
      throw new NotFoundException('Screenshot does not exist or has been deleted');

    /**
     * A06 — ⭐ থাম্বনেইল **সবসময় ঐচ্ছিক**, দুই স্তরেই:
     *
     *   ১· `thumb_path` null — পুরোনো সারি, বা এমন এজেন্ট যে এখনো
     *      থাম্বনেইল পাঠায় না। ফুল ছবিই যাবে, ঠিক আগের মতো।
     *   ২· পথ আছে কিন্তু ডিস্কে ফাইল নেই — ব্যাকআপ রিস্টোর যদি `thumb/`
     *      ফোল্ডার বাদ দিয়ে থাকে (দেখুন thumb.ts — বাদ দেওয়াই ইচ্ছাকৃত),
     *      তখন ঠিক এটাই হবে। এখানে fallback না থাকলে গোটা গ্যালারি
     *      ভাঙা ছবিতে ভরে যেত, অথচ ফুল ছবিগুলো ডিস্কে দিব্যি ছিল।
     *
     * ⚠️ এটা `variant` সই করার নিয়মের ব্যতিক্রম **নয়**। thumb → full-এ
     *    নামা সার্ভারের নিজের সিদ্ধান্ত, আর তা কেবল **নিচের দিকে** —
     *    URL ঘেঁটে কেউ এটা ঘটাতে পারে না, আর ফুলের টোকেন কখনো thumb
     *    হয়ে যায় না। ঝুঁকিটা "সবাই একটু বেশি বাইট নামাল", "কেউ যা
     *    দেখার কথা নয় তা দেখল" নয়।
     */
    const wantsThumb = variant === 'thumb' && shot.thumbPath !== null;
    const relPath = wantsThumb ? shot.thumbPath! : shot.filePath;

    const found = await this.statInsideRoot(shot.id, relPath);

    if (found === null && wantsThumb) {
      this.logger.warn(
        `screenshot ${shot.id.toString()}: no thumbnail (${relPath}) — served the full image`,
      );
      const full = await this.statInsideRoot(shot.id, shot.filePath);
      if (full === null) throw new NotFoundException('Image file not found');

      this.logger.debug(
        `screenshot ${shot.id.toString()} (thumb→full) served, token was created by user ${viewerUserId}`,
      );
      return {
        absPath: full.absPath,
        sizeBytes: full.sizeBytes,
        downloadName: `${shot.id.toString()}_${variant}.webp`,
      };
    }

    if (found === null) {
      throw new NotFoundException('Image file not found');
    }

    const { absPath, sizeBytes } = found;

    this.logger.debug(
      `screenshot ${shot.id.toString()} (${variant}) served, token was created by user ${viewerUserId}`,
    );

    return {
      absPath,
      sizeBytes,
      downloadName: `${shot.id.toString()}_${variant}.webp`,
    };
  }

  // ── ভেতরের সাহায্যকারী ─────────────────────────────────────────────

  /**
   * পথটা storage রুটের ভেতরে কি না দেখে, তারপর ফাইলটা আছে কি না।
   *
   * ⚠️ রুটের বাইরে হলে `null` নয় — সরাসরি 404 ছুঁড়ে দেয়। পার্থক্যটা
   *    জরুরি: "ফাইল নেই" থেকে থাম্বনেইল ফুল ছবিতে **ফেরত যেতে পারে**,
   *    কিন্তু "পথটা সন্দেহজনক" থেকে কোথাও ফেরত যাওয়া চলে না। দুটোকে এক
   *    করে ফেললে একটা বিকৃত `thumb_path` চুপচাপ ফুল ছবি সার্ভ করিয়ে
   *    নিত, আর লগে শুধু একটা নিরীহ warn থাকত।
   *
   * @returns `null` মানে পথ ঠিক আছে, কিন্তু ডিস্কে ফাইলটা নেই
   */
  private async statInsideRoot(
    id: bigint,
    relPath: string,
  ): Promise<{ absPath: string; sizeBytes: number } | null> {
    const absPath = resolve(this.root, relPath);

    // ⚠️ পথটা DB থেকে আসে, তবু বিশ্বাস করা হয় না। কোনোভাবে `..` ঢুকে
    //    গেলে (পুরোনো সারি, ম্যানুয়াল ইনসার্ট) storage-এর বাইরের যেকোনো
    //    ফাইল সার্ভ হয়ে যেত।
    if (absPath !== this.root && !absPath.startsWith(this.root + sep)) {
      this.logger.error(
        `screenshot ${id.toString()}: path is outside storage: ${relPath}`,
      );
      throw new NotFoundException('Screenshot does not exist');
    }

    try {
      const info = await stat(absPath);
      if (!info.isFile()) throw new Error('not a file');
      return { absPath, sizeBytes: info.size };
    } catch {
      // ingest আগে DB-তে লেখে, পরে ডিস্কে — মাঝখানে ক্র্যাশ হলে সারি থাকে,
      // ফাইল থাকে না। ৫০০ নয়, এটা সত্যিই "নেই"।
      this.logger.warn(
        `screenshot ${id.toString()}: row exists in the DB, but no file on disk (${relPath})`,
      );
      return null;
    }
  }

  private resolveDate(iso?: string): Date {
    if (iso === undefined) {
      // ⚠️ ঢাকার "আজ", সার্ভারের UTC "আজ" নয় — রাত ১২টা থেকে ভোর ৬টার
      //    মধ্যে দুটো আলাদা তারিখ হয়।
      return workDateOf(new Date());
    }
    const parsed = parseWorkDate(iso);
    if (!parsed) throw new BadRequestException('That date is not valid');
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
    /**
     * ⚠️⚠️ শর্তটা **"owner বা manager কি না"**, "employee নয় কি না" নয় —
     * আর পার্থক্যটা এক অক্ষরের নয়, নিরাপত্তার।
     *
     * ২৫ আগস্ট `UserRole`-এ `researcher` বসানোর সময় ধরা পড়ল: আগের লেখা
     * `role !== employee` শর্তে নতুন যেকোনো রোল **এই ডালেই পড়ত**, আর
     * `null` মানে *ফিল্টার নেই* — অর্থাৎ গবেষকরা **সবার স্ক্রিনশট, সব
     * দিনের** দেখতে পেতেন। ⭐ কোনো কম্পাইল-এরর হতো না, কোনো টেস্ট লাল
     * হতো না, কেউ কিছু বলত না।
     *
     * ⚠️ এই কন্ট্রোলারে ক্লাস-লেভেল `@Roles` **ইচ্ছাকৃতভাবে নেই** (ওখানকার
     * কমেন্ট দেখুন), তাই এই লাইনটাই একমাত্র পাহারা — উপরে কিছু আটকাত না।
     *
     * ⭐ নিয়ম: অনুমতি **হ্যাঁ-তালিকা** ধরে লিখুন, না-তালিকা ধরে নয়। তাহলে
     * নতুন রোল ডিফল্টে **বাইরে** থাকে, ভেতরে নয়।
     */
    if (actor.role === UserRole.owner || actor.role === UserRole.manager) {
      return requested ?? null;
    }

    if (actor.employeeId === null) {
      // role=employee অথচ কোনো স্টাফের সাথে যুক্ত নয় — অ্যাকাউন্ট তৈরিতে
      // ভুল। খালি লিস্ট দিলে সমস্যাটা চাপা পড়ে যেত।
      throw new ForbiddenException(
        'This account is not linked to any staff member',
      );
    }

    // ⚠️ অন্যের আইডি চাইলে চুপচাপ নিজেরটা ফেরত দেওয়া হয় না — তাহলে
    //    ফ্রন্টএন্ড ভাবত ফিল্টারটা কাজ করেছে, আর স্ক্রিনে অন্য নাম নিয়ে
    //    নিজের ছবি দেখাত।
    if (requested !== undefined && requested !== actor.employeeId) {
      throw new ForbiddenException('You can only view your own screenshots');
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
        /**
         * নিজের ছবি নিজে দেখলে (J05) — E11-এ এগুলো আলাদা করা যায়।
         *
         * ⚠️ আগে লেখা ছিল `role === employee` — রোল ধরে অনুমান। ২৫
         * আগস্ট `researcher` রোল আসার পর সেটা মিথ্যা হয়ে যেত: গবেষকও
         * মাপা হন, নিজের ছবি দেখেন, অথচ audit log-এ সেটা **অন্যের ছবি
         * দেখা** বলে লেখা থাকত। ⭐ এখন প্রশ্নটা সরাসরি — সারিগুলো কি
         * তাঁর নিজেরই? রোল যা-ই হোক, উত্তরটা বদলায় না।
         */
        self: actor.employeeId !== null && employeeId === actor.employeeId,
      },
    });
  }
}
