import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReadStream } from 'node:fs';

import { storageRoot } from '../common/storage.config';
import { PrismaService } from '../prisma/prisma.service';
import { isNewer, isOfferedTo } from './rollout';

export interface UpdateOffer {
  version: string;
  sha256: string;
  url: string;
  mandatory: boolean;
  releaseNotes: string | null;
}

@Injectable()
export class UpdateService {
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.root = resolve(
      storageRoot(config),
    );
  }

  /**
   * G34 — auto-update ফ্লো ([02-Workflow §8](../../docs/02-Workflow.md)) থাকলেও
   * MSI নামানোর endpoint ছিল না।
   *
   * `rollout_stage = halted` হলে কিছুই দেওয়া হয় না — খারাপ আপডেট গেলে
   * ওখানেই থামিয়ে দেওয়া যায়।
   */
  async offerFor(
    currentVersion: string,
    machineGuid?: string | null,
    /** ⭐ কোন ডিভাইস জিজ্ঞেস করছে — পাইলট মেলানোর জন্য *(১ সেপ্টেম্বর ২০২৬)* */
    deviceId?: number | null,
  ): Promise<UpdateOffer | null> {
    const latest = await this.prisma.agentVersion.findFirst({
      where: { rolloutStage: { not: 'halted' } },
      orderBy: { releasedAt: 'desc' },
    });

    if (!latest || !isNewer(latest.version, currentVersion)) return null;

    // H04 — ⭐ ধাপে ধাপে। machineGuid না জানলে **কিছুই দেওয়া হয় না**:
    //    অজানা ডিভাইসকে আপডেট দেওয়ার চেয়ে না দেওয়া নিরাপদ, কারণ
    //    canary-র পুরো মানেই "গুটিকয়েক মেশিনে আগে"।
    /**
     * ⭐ পাইলট হলে বালতি এড়ানো যায়, কিন্তু `machineGuid` ছাড়া নয় —
     * পরিচয়হীন কোনো কল যেন কখনো অফার না পায়।
     */
    const isPilot =
      latest.pilotDeviceId !== null &&
      deviceId !== null &&
      deviceId !== undefined &&
      latest.pilotDeviceId === deviceId;

    if (!machineGuid) return null;
    if (
      !isOfferedTo(latest.rolloutStage, machineGuid, latest.version, isPilot)
    ) {
      return null;
    }

    return {
      version: latest.version,
      sha256: latest.sha256,
      url: `/api/v1/agent/update/download?version=${encodeURIComponent(latest.version)}`,
      mandatory: latest.isMandatory,
      releaseNotes: latest.releaseNotes,
    };
  }

  async openMsi(version: string): Promise<{ stream: ReadStream; size: number }> {
    const row = await this.prisma.agentVersion.findUnique({
      where: { version },
    });
    if (!row) throw new NotFoundException('No such version');

    // msi_path storage-এর ভেতরেই থাকতে হবে — বাইরের যেকোনো ফাইল
    // নামিয়ে নেওয়ার সুযোগ (path traversal) বন্ধ
    const abs = isAbsolute(row.msiPath)
      ? resolve(row.msiPath)
      : resolve(this.root, row.msiPath);

    if (!abs.startsWith(this.root)) {
      throw new NotFoundException('File path is outside storage');
    }

    try {
      const info = await stat(abs);
      return { stream: createReadStream(abs), size: info.size };
    } catch {
      throw new NotFoundException('MSI file not found on disk');
    }
  }
}
