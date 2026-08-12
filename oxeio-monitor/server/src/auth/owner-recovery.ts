import { randomBytes } from 'node:crypto';

import { hash } from '@node-rs/argon2';
import { UserRole, type PrismaClient } from '@prisma/client';

import { ARGON2_OPTIONS } from './password.service';

/**
 * ⭐⭐ **owner-lockout — ফেরার পথের সিদ্ধান্তগুলো।**
 *
 * CLI-টা (`src/scripts/recover-owner.ts`) শুধু argv পড়ে আর পর্দায় লেখে;
 * **কী ঘটবে** তার পুরোটা এখানে। আলাদা করার কারণ একটাই: এই কোডটুকু
 * ভুল হলে হয় কেউ ঢুকতেই পারবে না, নয় ভুল লোক ঢুকে যাবে — আর সেটা
 * `process.argv`-র সাথে জড়ানো থাকলে একটাও টেস্ট লেখা যেত না।
 */

export interface OwnerRow {
  id: number;
  email: string;
  fullName: string;
  isActive: boolean;
  hasTwoFactor: boolean;
  lastLoginAt: Date | null;
}

export type RecoverResult =
  | { ok: true; kind: 'reset' | 'created'; email: string; password: string; clearedTwoFactor: boolean }
  /** কেন করা গেল না — CLI এটাই ছাপে, আর exit code-ও এখান থেকেই আসে */
  | { ok: false; reason: 'no-owner-no-email' | 'not-found' | 'ambiguous'; detail: string };

/**
 * ⚠️ ২০ অক্ষর — `PasswordService.generateTempPassword()`-এর ১৪-র চেয়ে লম্বা,
 * ইচ্ছাকৃতভাবে। ওটা owner-এর হাতে দেওয়া অস্থায়ী পাসওয়ার্ড, আর এটা
 * **শেষ ভরসা**; তৈরি হওয়ার পর কিছুক্ষণ টার্মিনালের পর্দায় থেকে যেতে পারে।
 */
export function newRecoveryPassword(): string {
  return randomBytes(18).toString('base64url').slice(0, 20);
}

export async function listOwners(prisma: PrismaClient): Promise<OwnerRow[]> {
  const rows = await prisma.user.findMany({
    where: { role: UserRole.owner },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      totpSecret: true,
      lastLoginAt: true,
    },
    orderBy: { id: 'asc' },
  });

  // ⚠️ `totpSecret` বাইরে যায় না, শুধু "আছে কি নেই" — গোপন জিনিসটা
  //    কোনো তালিকায় বা লগে ওঠার কারণ নেই।
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.fullName,
    isActive: r.isActive,
    hasTwoFactor: r.totpSecret !== null,
    lastLoginAt: r.lastLoginAt,
  }));
}

export async function recoverOwner(
  prisma: PrismaClient,
  options: { email?: string; fullName?: string } = {},
): Promise<RecoverResult> {
  const owners = await listOwners(prisma);
  const email = options.email?.trim();

  /**
   * ⭐ owner **নেই** — এটাও বাস্তব অবস্থা: কেউ ভুল করে একমাত্র অ্যাকাউন্টটা
   * নিষ্ক্রিয় করে দিলে (বা মুছে ফেললে), অথবা ডাটাবেস ফেরানোর পর। তখন নতুন
   * একটা বানিয়ে দেওয়াই একমাত্র পথ।
   */
  if (owners.length === 0) {
    if (!email) {
      return {
        ok: false,
        reason: 'no-owner-no-email',
        detail: 'কোনো owner অ্যাকাউন্ট নেই — নতুন একটা বানাতে ইমেইল দিতে হবে।',
      };
    }

    const password = newRecoveryPassword();
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash: await hash(password, ARGON2_OPTIONS),
        fullName: options.fullName ?? 'oXeio Owner',
        role: UserRole.owner,
        mustChangePw: true,
      },
      select: { id: true, email: true },
    });

    await audit(prisma, created.id, 'created', { email: created.email });

    return {
      ok: true,
      kind: 'created',
      email: created.email,
      password,
      clearedTwoFactor: false,
    };
  }

  /**
   * ⚠️ একাধিক owner থাকলে নিজে থেকে বেছে নেওয়া হয় **না**। "প্রথমটা নিয়ে
   * নাও" লিখলে ভুল অ্যাকাউন্টের পাসওয়ার্ড বদলে যেত — অর্থাৎ যিনি
   * ঠিকঠাক ঢুকছিলেন তিনিও আটকে যেতেন, আর আসল সমস্যাটা থেকেই যেত।
   */
  const target = email
    ? owners.find((o) => o.email.toLowerCase() === email.toLowerCase())
    : owners.length === 1
      ? owners[0]
      : undefined;

  if (!target) {
    return email
      ? {
          ok: false,
          reason: 'not-found',
          detail: `\`${email}\` নামে কোনো owner নেই।`,
        }
      : {
          ok: false,
          reason: 'ambiguous',
          detail: `${owners.length}টি owner আছে — কোনটা, সেটা ইমেইল দিয়ে বলতে হবে।`,
        };
  }

  const password = newRecoveryPassword();

  await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hash(password, ARGON2_OPTIONS),
      // প্রথম লগইনেই বদলাতে হবে — এই পাসওয়ার্ডটা পর্দায় দেখা গেছে
      mustChangePw: true,
      pwChangedAt: new Date(),
      // ⚠️ নিষ্ক্রিয় থাকলে ফিরিয়ে আনা হয় — নইলে পাসওয়ার্ড ঠিক করেও লগইন
      //    আটকে থাকত, আর কারণটা বোঝা যেত না।
      isActive: true,
      /**
       * ⭐ 2FA-ও সরানো হয়, আর এটাই lockout-এর **দ্বিতীয় অর্ধেক**। ফোন
       * হারানো বা authenticator অ্যাপ মুছে যাওয়া পাসওয়ার্ড ভোলার চেয়ে কম
       * সাধারণ নয়; শুধু পাসওয়ার্ড রিসেট করলে ওই অবস্থায় কিছুই বদলাত না —
       * লগইনের পরের ধাপেই আবার আটকে যেত।
       */
      totpSecret: null,
    },
  });

  await audit(prisma, target.id, 'reset', {
    email: target.email,
    clearedTwoFactor: target.hasTwoFactor,
  });

  return {
    ok: true,
    kind: 'reset',
    email: target.email,
    password,
    clearedTwoFactor: target.hasTwoFactor,
  };
}

/**
 * ⚠️ `userId` = **যাকে** রিসেট করা হলো, কারণ **কে** চালাল সেটা জানার কোনো
 * উপায় নেই (শেলে কোনো সেশন নেই, কোনো IP নেই)। `meta.via = 'cli'` দেখেই
 * বোঝা যাবে এটা ওয়েব থেকে হয়নি — আর তদন্তে ঠিক ওটাই আসল তথ্য।
 *
 * ⚠️ অডিট লেখা এখানে **try/catch-এ মোড়া নয়**, `AuditService.record()`-এর
 * মতো। ওখানে গিলে ফেলা ঠিক আছে (স্ক্রিনশট দেখার লগ হারানোর চেয়ে পাতা
 * খোলা জরুরি), কিন্তু এখানে উল্টো: চিহ্ন না রেখে owner-এর পাসওয়ার্ড
 * বদলে ফেলার চেয়ে কাজটা ব্যর্থ হওয়াই ভালো।
 */
async function audit(
  prisma: PrismaClient,
  userId: number,
  kind: 'reset' | 'created',
  meta: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'reset_password',
      targetType: 'user',
      targetId: String(userId),
      meta: { ...meta, via: 'cli', kind },
    },
  });
}
