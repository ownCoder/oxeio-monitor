import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';

import {
  SESSION_COOKIE,
  SESSION_REFRESH_AFTER_MIN,
} from '../auth.constants';
import { IS_PUBLIC } from '../decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../token.service';
import type { AuthedRequest } from '../types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.[SESSION_COOKIE];

    if (!token) throw new UnauthorizedException('Please sign in');

    const user = await this.tokens.verify(token);
    // মেয়াদ শেষ হওয়াও এখানেই ধরা পড়ে → ৩০ মিনিট নিষ্ক্রিয়তায় auto logout (I09)
    if (!user) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    req.user = user;

    // sliding window — কাজ করতে থাকলে সেশন চলতে থাকবে, বসে থাকলে ৩০ মিনিটে শেষ
    const ageSec = Math.floor(Date.now() / 1000) - user.issuedAt;
    if (ageSec > SESSION_REFRESH_AFTER_MIN * 60) {
      /**
       * ⚠️⚠️ **নতুন টোকেনের দাবিগুলো ডাটাবেস থেকে পড়া হয়, পুরোনো টোকেন
       * থেকে নকল করা নয় — আর এটাই এখানকার আসল সিদ্ধান্ত।**
       *
       * আগে লেখা ছিল `this.tokens.issue(res, user)`, অর্থাৎ পুরোনো
       * দাবিগুলোই এগিয়ে দেওয়া হতো। ফল ছিল নীরব ও গুরুতর: sliding window
       * প্রতি ৫ মিনিটে টোকেন নতুন করে দেয়, তাই যে ব্যবহারকারী কাজ করতেই
       * থাকেন তাঁর **ভূমিকা কোনোদিন হালনাগাদ হতো না**।
       *
       *   · manager-কে employee করা হলো → তিনি ট্যাব খোলা রেখে কাজ করলে
       *     **চিরকাল** manager-ই থাকতেন
       *   · কর্মীকে নিষ্ক্রিয় করা হলো → তাঁর চলতি সেশন কখনো মরত না
       *   · পাসওয়ার্ড রিসেটের `mustChangePw` চলতি সেশনে খাটত না
       *
       * ⭐ খরচ নগণ্য — এই লুকআপটা কেবল **৫ মিনিটে একবার** হয়, প্রতি
       * রিকোয়েস্টে নয়।
       */
      const fresh = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: {
          email: true,
          role: true,
          employeeId: true,
          mustChangePw: true,
          isActive: true,
        },
      });

      /**
       * ⚠️ মুছে ফেলা বা নিষ্ক্রিয় করা অ্যাকাউন্টের সেশন এখানেই শেষ।
       *    আগে এটা হতো না — ছাঁটাই হওয়া কেউ ট্যাব খোলা রাখলে ড্যাশবোর্ড
       *    তাঁর কাছে খোলাই থেকে যেত।
       */
      if (!fresh || !fresh.isActive) {
        throw new UnauthorizedException('This account is no longer active');
      }

      const updated = { ...user, ...fresh, userId: user.userId };

      // ⚠️ এই রিকোয়েস্টেই নতুন ভূমিকা খাটে — নইলে বদলটা এক রিকোয়েস্ট
      //    দেরিতে কার্যকর হতো, আর ভূমিকা কমানোর ক্ষেত্রে সেটা একটা ফাঁক।
      req.user = updated;

      const res = ctx.switchToHttp().getResponse<Response>();
      await this.tokens.issue(res, updated);
    }

    return true;
  }
}
