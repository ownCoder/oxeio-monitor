import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CSRF_COOKIE, CSRF_HEADER } from '../auth.constants';
import { IS_PUBLIC } from '../decorators';
import type { AuthedRequest } from '../types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF (ADR-016)।
 *
 * টোকেন cookie-তে আছে (httpOnly নয়) — ফ্রন্টএন্ড সেটা পড়ে `X-CSRF-Token`
 * হেডারে পাঠায়। ভিন্ন origin থেকে আসা রিকোয়েস্ট cookie পাঠাতে পারলেও
 * **পড়তে** পারে না, তাই হেডারটা মেলাতে পারে না।
 *
 * SameSite=Strict-ও আছে; এটা দ্বিতীয় স্তর।
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();

    if (SAFE_METHODS.has(req.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    // login-এর সময় এখনো cookie-ই নেই — তাই public রুটে CSRF চেক অর্থহীন
    if (isPublic) return true;

    const cookies = req.cookies as Record<string, string> | undefined;
    const fromCookie = cookies?.[CSRF_COOKIE];
    const fromHeader = req.headers[CSRF_HEADER];

    if (
      !fromCookie ||
      typeof fromHeader !== 'string' ||
      fromHeader !== fromCookie
    ) {
      throw new ForbiddenException(
        'CSRF token mismatch — send the cookie value in the X-CSRF-Token header',
      );
    }

    return true;
  }
}
