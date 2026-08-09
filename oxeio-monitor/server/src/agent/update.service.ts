import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReadStream } from 'node:fs';

import { PrismaService } from '../prisma/prisma.service';

export interface UpdateOffer {
  version: string;
  sha256: string;
  url: string;
  mandatory: boolean;
  releaseNotes: string | null;
}

/** '1.10.0' > '1.9.0' — স্ট্রিং তুলনায় উল্টো ফল দিত, তাই অংশে অংশে */
function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

@Injectable()
export class UpdateService {
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.root = resolve(
      config.get<string>('STORAGE_ROOT') ??
        join(process.cwd(), '..', '.data', 'storage'),
    );
  }

  /**
   * G34 — auto-update ফ্লো ([02-Workflow §8](../../docs/02-Workflow.md)) থাকলেও
   * MSI নামানোর endpoint ছিল না।
   *
   * `rollout_stage = halted` হলে কিছুই দেওয়া হয় না — খারাপ আপডেট গেলে
   * ওখানেই থামিয়ে দেওয়া যায়।
   */
  async offerFor(currentVersion: string): Promise<UpdateOffer | null> {
    const latest = await this.prisma.agentVersion.findFirst({
      where: { rolloutStage: { not: 'halted' } },
      orderBy: { releasedAt: 'desc' },
    });

    if (!latest || !isNewer(latest.version, currentVersion)) return null;

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
    if (!row) throw new NotFoundException('এই ভার্সন নেই');

    // msi_path storage-এর ভেতরেই থাকতে হবে — বাইরের যেকোনো ফাইল
    // নামিয়ে নেওয়ার সুযোগ (path traversal) বন্ধ
    const abs = isAbsolute(row.msiPath)
      ? resolve(row.msiPath)
      : resolve(this.root, row.msiPath);

    if (!abs.startsWith(this.root)) {
      throw new NotFoundException('ফাইলের পাথ storage-এর বাইরে');
    }

    try {
      const info = await stat(abs);
      return { stream: createReadStream(abs), size: info.size };
    } catch {
      throw new NotFoundException('MSI ফাইলটি ডিস্কে পাওয়া যায়নি');
    }
  }
}
