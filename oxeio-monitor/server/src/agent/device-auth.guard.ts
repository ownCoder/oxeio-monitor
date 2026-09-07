import { createHash } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Device } from '@prisma/client';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { CLIENT_TIME_HEADER } from './agent.constants';
import { ClockDriftService, type Drift } from './clock-drift.service';

export interface DeviceRequest extends Request {
  device?: Device;
  drift?: Drift;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * এজেন্টের সব endpoint-এর দরজা।
 *
 * টোকেন সার্ভারে **plaintext-এ জমা থাকে না** — শুধু sha256 (I02)।
 * তাই ডাটাবেস ফাঁস হলেও কেউ এজেন্ট সেজে ডেটা পাঠাতে পারবে না।
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockDriftService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<DeviceRequest>();

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Device token required');
    }

    const device = await this.prisma.device.findFirst({
      where: { tokenHash: hashToken(header.slice(7).trim()) },
    });
    if (!device) throw new UnauthorizedException('Device token is invalid');

    // H06 — দূর থেকে revoke করলে এজেন্ট আর কিছু পাঠাতে পারবে না
    if (device.status === 'revoked') {
      throw new ForbiddenException({
        message: 'This device has been revoked',
        command: 'revoke',
      });
    }

    const clientTimeRaw = req.headers[CLIENT_TIME_HEADER];
    const clientTime =
      typeof clientTimeRaw === 'string' ? new Date(clientTimeRaw) : null;

    const drift = this.clock.measure(clientTime);
    req.device = device;
    req.drift = drift;

    /**
     * last_seen_at → "এজেন্ট ১০ মিনিট চুপ" অ্যালার্ট এর উপরেই দাঁড়ানো (G01)
     *
     * ⭐⭐⭐ **`last_drift_sec`-ও এখানেই** *(৭ সেপ্টেম্বর ২০২৬, G170)*।
     *
     * ⚠️⚠️ **যে বাগটা এটা সারায়:** ঘরটা লিখত কেবল `ClockDriftService.record()`,
     * আর সে শুরুতেই `if (drift.level === 'none') return;` বলে ফিরে যায়।
     * ফলে একবার বড় একটা মান বসলে সেটা **আর কোনোদিন মুছত না** — ঘড়ি ঠিক
     * হয়ে যাওয়ার পরেও।
     *
     * ⚠️ মাঠে দেখা (৭ সেপ্টেম্বর): OX-13-এর ঘড়ি সকালে ১৫ ঘণ্টা পিছিয়ে
     * ছিল, Windows কয়েক মিনিটে সেটা মিলিয়ে নেয় — কিন্তু ফ্লিট-তালিকা
     * তারপরও **৫৪,২২৩ সেকেন্ড** দেখাচ্ছিল। পর্দার সংখ্যাটা সত্যি ছিল না,
     * আর কোনো এররও ছিল না।
     *
     * ⭐ **বাড়তি কোনো round-trip নেই** — এই UPDATE-টা এমনিতেই প্রতিটা
     * রিকোয়েস্টে চলে। ⚠️ আর মানটা **বদলালে তবেই** SET-এ ঢোকে, ঠিক
     * `lastState`/`agentVersion`-এর মতোই (G59-এর একই শিক্ষা)।
     */
    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        ...(drift.seconds === device.lastDriftSec
          ? {}
          : { lastDriftSec: drift.seconds }),
      },
    });

    // drift থাকলে ডিভাইসে লিখে রাখা, বেশি হলে অ্যালার্ট (§ ২)
    await this.clock.record(device.id, device.employeeId, drift);

    return true;
  }
}
