import { randomBytes } from 'node:crypto';

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';

import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MIN,
} from './auth.constants';
import type { SessionUser } from './types';

interface Claims {
  email: string;
  role: string;
  employeeId: number | null;
  mustChangePw: boolean;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private key!: Uint8Array;
  private secure = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      // fail fast — দুর্বল সিক্রেট নিয়ে সার্ভার ওঠার চেয়ে না ওঠাই ভালো
      throw new Error(
        'JWT_SECRET সেট করা নেই বা ৩২ অক্ষরের কম। .env দেখুন।',
      );
    }
    this.key = new TextEncoder().encode(secret);
    this.secure = this.config.get<string>('NODE_ENV') === 'production';
  }

  async sign(user: Omit<SessionUser, 'issuedAt'>): Promise<string> {
    const claims: Claims = {
      email: user.email,
      role: user.role,
      employeeId: user.employeeId,
      mustChangePw: user.mustChangePw,
    };

    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user.userId))
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_MIN}m`)
      .sign(this.key);
  }

  async verify(token: string): Promise<SessionUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
      });

      const userId = Number(payload.sub);
      if (!Number.isInteger(userId)) return null;

      return {
        userId,
        email: String(payload.email),
        role: payload.role as SessionUser['role'],
        employeeId:
          payload.employeeId === null ? null : Number(payload.employeeId),
        mustChangePw: payload.mustChangePw === true,
        issuedAt: Number(payload.iat ?? 0),
      };
    } catch {
      // মেয়াদ শেষ, স্বাক্ষর ভুল, বা বিকৃত টোকেন — সবই "লগইন নেই"
      return null;
    }
  }

  /** সেশন cookie + CSRF cookie একসাথে বসায় */
  async issue(
    res: Response,
    user: Omit<SessionUser, 'issuedAt'>,
  ): Promise<void> {
    const token = await this.sign(user);
    const maxAge = SESSION_TTL_MIN * 60 * 1000;

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.secure,
      path: '/',
      maxAge,
    });

    res.cookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
      httpOnly: false, // ফ্রন্টএন্ডকে পড়তে হয় — এটাই double-submit-এর কৌশল
      sameSite: 'strict',
      secure: this.secure,
      path: '/',
      maxAge,
    });
  }

  clear(res: Response): void {
    const opts = {
      sameSite: 'strict' as const,
      secure: this.secure,
      path: '/',
    };
    res.clearCookie(SESSION_COOKIE, { ...opts, httpOnly: true });
    res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
  }
}
