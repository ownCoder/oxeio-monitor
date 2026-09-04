import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RolloutStage } from '@prisma/client';

import { isNewer } from '../agent/rollout';
import { AuditService } from '../audit/audit.service';
import { storageRoot } from '../common/storage.config';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from '../auth/types';
import type { PublishVersionDto, SetStageDto } from './dto';

export interface AgentVersionView {
  version: string;
  sha256: string;
  sizeBytes: number | null;
  rolloutStage: RolloutStage;
  isMandatory: boolean;
  releaseNotes: string | null;
  releasedAt: string;
  /** ⚠️ ফাইলটা সত্যিই ডিস্কে আছে তো? না থাকলে অফার করাই বিপজ্জনক */
  fileMissing: boolean;
  /** এই ভার্সনে কতগুলো ডিভাইস ইতিমধ্যে চলছে */
  devicesOn: number;
}

/**
 * **H04 · G59** — এজেন্টের নতুন ভার্সন বিলি করার পথ।
 *
 * ⚠️⚠️ <b>`agent_versions` টেবিলটা এতদিন শুধু পড়া হতো।</b> `update.service.ts`
 * সেখান থেকে সর্বশেষ ভার্সন খোঁজে, ধাপে ধাপে অফার করে, sha256 মিলিয়ে
 * দেয় — গোটা auto-update ব্যবস্থাটা তৈরি। কিন্তু **ওই টেবিলে সারি
 * বসানোর কোনো পথ কোথাও ছিল না**: কোনো endpoint নয়, কোনো UI নয়, seed-এও
 * নয়।
 *
 * ⭐ ফলটা আজ হাতে-কলমে দেখা গেল: MSI ০.২.০ বানানো হলো (H06, A05, H08 আর
 * কনফিগ লুপের ফিক্স নিয়ে), আর সেটা ১৫টা PC-তে পৌঁছানোর **একমাত্র উপায়
 * প্রতিটা মেশিনে হাতে গিয়ে বসানো**। H04-এর ধাপে ধাপে রোলআউট, canary,
 * `halted` দিয়ে থামানো — সবকিছু তৈরি হয়ে অচল পড়ে ছিল।
 *
 * এটাই আজকের চতুর্থ "চুক্তি লেখা আছে, কলার লেখা হয়নি" — A05, কনফিগ
 * ফেচ, adjustments আর সই রেকর্ডের পর।
 */
@Injectable()
export class AgentVersionsService {
  private readonly logger = new Logger(AgentVersionsService.name);
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    // ⚠️ `update.service.ts`-এর সাথে হুবহু একই হিসাব — দুই জায়গায় আলাদা
    //    হলে এখানে বসানো পাথ ওখানে "ফাইল নেই" হয়ে যেত।
    this.root = resolve(storageRoot(config));
  }

  async list(): Promise<AgentVersionView[]> {
    const [rows, byVersion] = await Promise.all([
      this.prisma.agentVersion.findMany({ orderBy: { releasedAt: 'desc' } }),
      this.prisma.device.groupBy({
        by: ['agentVersion'],
        where: { status: 'active' },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map(
      byVersion.map((d) => [d.agentVersion ?? '', d._count._all]),
    );

    return Promise.all(
      rows.map(async (r) => {
        const file = await this.statMsi(r.msiPath);
        return {
          version: r.version,
          sha256: r.sha256,
          sizeBytes: file?.size ?? null,
          rolloutStage: r.rolloutStage,
          isMandatory: r.isMandatory,
          releaseNotes: r.releaseNotes,
          releasedAt: r.releasedAt.toISOString(),
          fileMissing: file === null,
          devicesOn: counts.get(r.version) ?? 0,
        };
      }),
    );
  }

  /**
   * নতুন ভার্সন বিলির জন্য নথিভুক্ত করা।
   *
   * ⭐⭐ <b>sha256 হাতে দিতে হয় না — সার্ভার নিজে ফাইলটা পড়ে হিসাব করে।</b>
   * চাইলে হাতে দেওয়া যায়, তখন **মিলিয়ে দেখা হয়** আর না মিললে ৪০০।
   *
   * ⚠️ কেন এটা এত জরুরি: এজেন্ট নামানোর পর sha256 মিলিয়ে দেখে, আর না
   * মিললে MSI ফেলে দেয়। হাতে বসানো হ্যাশে একটা অক্ষর ভুল হলে ১৫টা PC
   * ফাইলটা নামাত, বাতিল করত, আবার নামাত — চিরকাল। আর লগে কেবল
   * "hash mismatch" লেখা থাকত, ভুলটা যে টাইপোতে সেটা কেউ ধরত না।
   */
  async publish(
    actor: SessionUser,
    dto: PublishVersionDto,
    ip: string,
  ): Promise<AgentVersionView> {
    const existing = await this.prisma.agentVersion.findUnique({
      where: { version: dto.version },
    });
    if (existing) {
      throw new ConflictException(
        `Version ${dto.version} is already published. Publish a new version number instead — agents compare versions, so re-publishing the same number would never reach anyone.`,
      );
    }

    const file = await this.statMsi(dto.msiPath);
    if (file === null) {
      throw new BadRequestException(
        `No MSI at "${dto.msiPath}" (looked under the storage root). Copy the built file there first.`,
      );
    }

    const sha256 = await this.hashFile(file.abs);
    if (dto.sha256 && dto.sha256.toLowerCase() !== sha256) {
      throw new BadRequestException(
        'The sha256 you gave does not match the file on disk. The agent checks this hash after downloading, so a wrong value would make every PC download and reject the file forever.',
      );
    }

    /**
     * ⚠️ নতুন ভার্সনটা পুরোনোর চেয়ে **নতুন হতেই হবে**। না হলে
     * `update.service.ts` সেটাকে কখনো অফার করত না (`isNewer` মিথ্যা),
     * আর owner ভাবতেন বিলি হয়ে গেছে — নীরব ব্যর্থতা।
     */
    const latest = await this.prisma.agentVersion.findFirst({
      orderBy: { releasedAt: 'desc' },
    });
    if (latest && !isNewer(dto.version, latest.version)) {
      throw new BadRequestException(
        `${dto.version} is not newer than the current ${latest.version}, so no agent would ever be offered it.`,
      );
    }

    const row = await this.prisma.agentVersion.create({
      data: {
        version: dto.version,
        msiPath: dto.msiPath,
        sha256,
        releaseNotes: dto.releaseNotes ?? null,
        // ⭐ ডিফল্ট `canary` — schema-র ডিফল্টও তাই। একবারে সবাইকে দেওয়া
        //    সিদ্ধান্তটা আলাদা করে নিতে হয় (`stage` বদলে), আর সেটাই ঠিক:
        //    খারাপ বিল্ড গেলে ফেরার পথ নেই (G69)।
        rolloutStage: dto.rolloutStage ?? RolloutStage.canary,
        isMandatory: dto.isMandatory ?? false,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'publish_agent_version',
      targetType: 'agent_version',
      targetId: row.version,
      ipAddress: ip,
      meta: { sha256, stage: row.rolloutStage, sizeBytes: file.size },
    });

    this.logger.warn(
      `agent ${row.version} published · ${row.rolloutStage} · ${file.size} bytes`,
    );

    return {
      version: row.version,
      sha256: row.sha256,
      sizeBytes: file.size,
      rolloutStage: row.rolloutStage,
      isMandatory: row.isMandatory,
      releaseNotes: row.releaseNotes,
      releasedAt: row.releasedAt.toISOString(),
      fileMissing: false,
      devicesOn: 0,
    };
  }

  /**
   * রোলআউটের ধাপ বদলানো — `canary` → `partial` → `all`, অথবা `halted`।
   *
   * ⭐ **`halted`-ই একমাত্র জরুরি ব্রেক।** খারাপ আপডেট বেরিয়ে গেলে
   * স্বয়ংক্রিয় rollback নেই (G69, ইচ্ছাকৃত) — যারা পেয়ে গেছে তাদের
   * হাতে ঠিক করতে হবে। কিন্তু এখানে থামালে **বাকিরা অন্তত বেঁচে যায়**,
   * আর সেটা সেকেন্ডের কাজ।
   */
  async setStage(
    actor: SessionUser,
    version: string,
    dto: SetStageDto,
    ip: string,
  ): Promise<AgentVersionView> {
    const row = await this.prisma.agentVersion.findUnique({
      where: { version },
    });
    if (!row) throw new NotFoundException('No such version');

    const updated = await this.prisma.agentVersion.update({
      where: { version },
      data: {
        rolloutStage: dto.rolloutStage,
        ...(dto.isMandatory === undefined ? {} : { isMandatory: dto.isMandatory }),
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_agent_rollout',
      targetType: 'agent_version',
      targetId: version,
      ipAddress: ip,
      // ⚠️ আগে ও পরে দুটোই — "কে কখন সবাইকে দিয়ে দিল" প্রশ্নের উত্তর
      //    এই একটা সারিতেই থাকা দরকার
      meta: { from: row.rolloutStage, to: updated.rolloutStage },
    });

    this.logger.warn(
      `agent ${version} rollout ${row.rolloutStage} → ${updated.rolloutStage}`,
    );

    const file = await this.statMsi(updated.msiPath);
    const devicesOn = await this.prisma.device.count({
      where: { status: 'active', agentVersion: version },
    });

    return {
      version: updated.version,
      sha256: updated.sha256,
      sizeBytes: file?.size ?? null,
      rolloutStage: updated.rolloutStage,
      isMandatory: updated.isMandatory,
      releaseNotes: updated.releaseNotes,
      releasedAt: updated.releasedAt.toISOString(),
      fileMissing: file === null,
      devicesOn,
    };
  }

  /**
   * ⚠️ পাথটা storage রুটের **ভেতরে** থাকতেই হবে — `update.service.ts`-এর
   * `openMsi()`-ও ঠিক এই শর্তটাই দেখে। এখানে না দেখলে owner ভুল করে
   * `C:\Windows\...` বসিয়ে দিতে পারতেন, আর সেটা ধরা পড়ত ডাউনলোডের সময়
   * "File path is outside storage" দিয়ে — বিলি করার অনেক পরে।
   */
  private async statMsi(
    msiPath: string,
  ): Promise<{ abs: string; size: number } | null> {
    const abs = isAbsolute(msiPath)
      ? resolve(msiPath)
      : resolve(this.root, msiPath);

    if (!abs.startsWith(this.root)) return null;

    try {
      const info = await stat(abs);
      return info.isFile() ? { abs, size: info.size } : null;
    } catch {
      return null;
    }
  }

  /**
   * ⚠️ পুরো ফাইলটা মেমরিতে পড়া হয় **না** — MSI ৬২ MB, আর
   * `readFile()` দিয়ে করলে প্রতিটা publish-এ ওইটুকু RAM লাগত। স্ট্রিম
   * করে হ্যাশ করলে ধ্রুবক মেমরিতেই হয়।
   */
  private hashFile(abs: string): Promise<string> {
    return new Promise((ok, fail) => {
      const hash = createHash('sha256');
      const stream = createReadStream(abs);
      stream.on('error', fail);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => ok(hash.digest('hex')));
    });
  }
}
