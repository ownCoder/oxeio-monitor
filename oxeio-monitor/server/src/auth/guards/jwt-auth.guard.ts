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
import { TokenService } from '../token.service';
import type { AuthedRequest } from '../types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
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
      const res = ctx.switchToHttp().getResponse<Response>();
      await this.tokens.issue(res, user);
    }

    return true;
  }
}
