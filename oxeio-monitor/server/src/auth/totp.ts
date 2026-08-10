import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Secret, TOTP, URI } from 'otpauth';

import {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  TOTP_DIGITS,
  TOTP_ISSUER,
  TOTP_PERIOD,
  TOTP_WINDOW,
} from './auth.constants';

/**
 * I06 — TOTP 2FA-র **খাঁটি** অংশ। এখানে ডাটাবেস নেই, Nest নেই, `Date.now()`
 * ইনজেক্ট করা যায় — তাই পুরোটা DB ছাড়াই টেস্ট করা যায় (`test/totp.spec.ts`)।
 *
 * ⭐ সবচেয়ে বড় সিদ্ধান্ত: `users.totp_secret` একটাই `String?` কলাম, অথচ
 *    আমাদের চারটে জিনিস রাখতে হয় — সিক্রেট, "চালু কি না", রিকভারি কোডের
 *    হ্যাশ, আর শেষ ব্যবহৃত counter। স্কিমা বদলানো এই ফেজে সম্ভব নয়, তাই
 *    পুরোটা একটা JSON **খাম** হিসেবে ওই কলামেই বসে। লাভ: চারটে মান একই
 *    সারিতে, একই `UPDATE`-এ atomically বদলায় — আলাদা টেবিল হলে "কোড খরচ
 *    হলো কিন্তু counter বসল না" এমন আধাখেঁচড়া অবস্থা সম্ভব হতো।
 *    (ভবিষ্যতে আলাদা কলাম হলে `decodeEnvelope` অপরিবর্তিত রেখে শুধু
 *     পড়ার/লেখার জায়গা বদলালেই চলবে।)
 */
export interface TotpEnvelope {
  v: 1;
  /** base32 — যা authenticator অ্যাপে যায় */
  secret: string;
  /**
   * ⚠️ `secret` থাকা আর 2FA **চালু** থাকা এক নয়। `POST /auth/2fa/setup`
   *    সিক্রেট বসায় কিন্তু `enabled: false` রাখে — একটা কোড দিয়ে প্রমাণ
   *    করার আগে চালু হলে কেউ QR স্ক্যান করতে ভুলে গিয়ে নিজের অ্যাকাউন্ট
   *    থেকে চিরতরে তালাবদ্ধ হয়ে যেত।
   */
  enabled: boolean;
  /** রিকভারি কোডের sha256 — plaintext কোড কোথাও জমা হয় না */
  recoveryHashes: string[];
  /**
   * ⚠️ replay ঠেকানোর একমাত্র উপায়। একই ৬ অঙ্ক ৩০ সেকেন্ড ধরে বৈধ থাকে;
   *    কাঁধের উপর দিয়ে দেখে ফেলা কোড দিয়ে দ্বিতীয়বার ঢোকা যাবে না।
   */
  lastCounter: number;
}

/** নন-JSON, কিন্তু খালিও নয় — হাতে বসানো পুরোনো ফরম্যাটের সিক্রেট */
function legacyEnvelope(secret: string): TotpEnvelope {
  return {
    v: 1,
    secret,
    // ⚠️ fail-closed: কেউ হাতে কলামে সিক্রেট বসালে সেটাকে "চালু" ধরাই
    //    নিরাপদ। উল্টোটা ধরলে 2FA নীরবে বন্ধ হয়ে যেত।
    enabled: true,
    recoveryHashes: [],
    lastCounter: 0,
  };
}

/**
 * ⚠️ JSON হিসেবে পড়া গেল কিন্তু আকার মেলেনি — এখানে `null` ফেরত দিলে
 *    "2FA নেই" বোঝাত, অর্থাৎ বিকৃত ডেটা মানেই নিরাপত্তা উধাও। তাই ছুড়ে
 *    দেওয়া হয়: লগইন ব্যর্থ হবে, কিন্তু ফাঁক তৈরি হবে না।
 */
export class TotpEnvelopeError extends Error {}

export function decodeEnvelope(raw: string | null | undefined): TotpEnvelope | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!trimmed.startsWith('{')) return legacyEnvelope(trimmed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new TotpEnvelopeError('totp_secret-এ ভাঙা JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new TotpEnvelopeError('totp_secret-এ অবজেক্ট নেই');
  }

  const o = parsed as Record<string, unknown>;
  const secret = o.secret;
  const enabled = o.enabled;
  const hashes = o.recoveryHashes;
  const lastCounter = o.lastCounter;

  if (
    typeof secret !== 'string' ||
    secret === '' ||
    typeof enabled !== 'boolean' ||
    !Array.isArray(hashes) ||
    !hashes.every((h): h is string => typeof h === 'string') ||
    typeof lastCounter !== 'number' ||
    !Number.isFinite(lastCounter)
  ) {
    throw new TotpEnvelopeError('totp_secret-এর আকার মেলেনি');
  }

  return { v: 1, secret, enabled, recoveryHashes: hashes, lastCounter };
}

export function encodeEnvelope(env: TotpEnvelope): string {
  return JSON.stringify(env);
}

/** নতুন সিক্রেট — ২০ বাইট, RFC 4226-এর সুপারিশ */
export function generateSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/**
 * authenticator অ্যাপ যে লিংকটা QR থেকে পড়ে।
 * label-এ ইমেইল, issuer-এ প্রতিষ্ঠান — একই ফোনে দুটো অ্যাকাউন্ট থাকলে
 * অ্যাপে সেগুলো আলাদা করে চেনা যায়।
 */
export function buildOtpauthUri(secret: string, email: string): string {
  return URI.stringify(
    new TOTP({
      issuer: TOTP_ISSUER,
      label: email,
      algorithm: 'SHA1',
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      secret: Secret.fromBase32(secret),
    }),
  );
}

export type TotpVerdict =
  | { ok: true; counter: number }
  | { ok: false; reason: 'malformed' | 'invalid' | 'replayed' };

/** স্পেস, ড্যাশ, ইউনিকোড ফাঁকা — অ্যাপ থেকে কপি করলে এসবই সাথে আসে */
export function normalizeTotpCode(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * ⚠️ তিনটে আলাদা "না" — আর তিনটেই আলাদা কারণে গুরুত্বপূর্ণ:
 *    `malformed` (৬ অঙ্ক নয়) · `invalid` (মেলেনি) · `replayed` (আগেই ব্যবহৃত)।
 *    কল করার জায়গা তিনটেকেই ব্যর্থতা ধরবে, কিন্তু লগে/অডিটে আলাদা দেখাবে।
 *
 * ⚠️ window = ±১ ধাপ (±৩০ সেকেন্ড)। ফোনের ঘড়ি কয়েক সেকেন্ড এগিয়ে/পিছিয়ে
 *    থাকা খুবই সাধারণ; ০ রাখলে অর্ধেক লগইন অকারণে ব্যর্থ হতো।
 */
export function verifyTotpCode(
  env: Pick<TotpEnvelope, 'secret' | 'lastCounter'>,
  code: string,
  now: number = Date.now(),
): TotpVerdict {
  const token = normalizeTotpCode(code);
  if (token.length !== TOTP_DIGITS) return { ok: false, reason: 'malformed' };

  let secret: Secret;
  try {
    secret = Secret.fromBase32(env.secret);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const delta = TOTP.validate({
    token,
    secret,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    window: TOTP_WINDOW,
    timestamp: now,
  });
  if (delta === null) return { ok: false, reason: 'invalid' };

  // delta = এখনকার counter থেকে কত ধাপ দূরে কোডটা মিলেছে
  const counter = TOTP.counter({ period: TOTP_PERIOD, timestamp: now }) + delta;

  // ⚠️ `<=` — সমান হলেও না। একই ধাপের কোড দুবার চলবে না।
  if (counter <= env.lastCounter) return { ok: false, reason: 'replayed' };

  return { ok: true, counter };
}

/**
 * ⭐ রিকভারি কোড। ফোন হারানো/রিসেট হওয়া কাল্পনিক ঝুঁকি নয় — এটা ছাড়া
 *    owner নিজের সিস্টেম থেকে বেরিয়ে গেলে ভেতরে ঢোকার আর কোনো পথ থাকত না
 *    (ডাটাবেসে হাত দেওয়া ছাড়া)।
 *
 * ⚠️ বর্ণমালা থেকে `0 1 I O` বাদ — কাগজে লিখে রাখা কোড পড়তে গিয়ে ঠিক
 *    এই চারটেতেই ভুল হয়। বাকি থাকে ৮ অঙ্ক + ২৪ অক্ষর = **ঠিক ৩২**,
 *    আর সেটাই নিচের `% 32`-কে নিরপেক্ষ রাখে (২৫৬ ÷ ৩২ পুরোপুরি ভাগ যায়)।
 *    দৈর্ঘ্য ৩২ না হলে কিছু অক্ষর অন্যদের চেয়ে বেশিবার আসত — টেস্ট
 *    (`test/totp.spec.ts`) এই দৈর্ঘ্যটাই পাহারা দেয়।
 */
export const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** `ABCDE-FGHJK` — মাঝের ড্যাশটা শুধু পড়ার সুবিধার্থে, হ্যাশে যায় না */
export function formatRecoveryCode(raw: string): string {
  const half = Math.ceil(raw.length / 2);
  return `${raw.slice(0, half)}-${raw.slice(half)}`;
}

export function generateRecoveryCodes(
  count: number = RECOVERY_CODE_COUNT,
  length: number = RECOVERY_CODE_LENGTH,
): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(length);
    let raw = '';
    for (const b of bytes) raw += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    codes.push(formatRecoveryCode(raw));
  }
  return codes;
}

/** ড্যাশ/স্পেস/ছোট হাতের অক্ষর — সব মিটিয়ে হ্যাশযোগ্য রূপ */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * ⭐ পাসওয়ার্ডের মতো argon2 নয়, sha256 — ইচ্ছাকৃত। রিকভারি কোড আমরা নিজেরাই
 *    বানাই, ১০ অক্ষর × ৫ বিট = ৫০ বিট এনট্রপি। ব্রুট-ফোর্স করার মতো
 *    "দুর্বল পছন্দ" এখানে সম্ভব নয়, তাই ধীর হ্যাশের দরকার নেই — আর
 *    লগইনের পথে ১০টা argon2 যাচাই মানে কয়েক সেকেন্ড দেরি।
 */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export interface RecoveryVerdict {
  ok: boolean;
  /** কোড খরচ হলে সেটা বাদ দেওয়া নতুন তালিকা */
  remaining: string[];
}

/**
 * ⚠️ কোড **একবারই** চলে — তাই মিলে গেলে তালিকা থেকে বাদ দেওয়া অপরিহার্য।
 *    কল করার জায়গা `remaining` জমা না দিলে একই কাগজের কোড বারবার চলত।
 */
export function consumeRecoveryCode(
  hashes: readonly string[],
  code: string,
): RecoveryVerdict {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length === 0) return { ok: false, remaining: [...hashes] };

  const target = Buffer.from(hashRecoveryCode(normalized), 'hex');
  let matched = -1;

  for (let i = 0; i < hashes.length; i += 1) {
    // ⚠️ ভাঙা hex-এ `Buffer.from` ছোড়ে না, ছোট বাফার দেয় — আর
    //    `timingSafeEqual` দৈর্ঘ্য না মিললে **ছোড়ে**। তাই আগে দৈর্ঘ্য দেখা।
    const stored = Buffer.from(hashes[i], 'hex');
    if (stored.length !== target.length) continue;
    if (timingSafeEqual(stored, target)) {
      matched = i;
      // ⚠️ `break` নয় — তালিকার শুরুর দিকের কোড দ্রুত মেলে, শেষের দিকেরটা
      //    দেরিতে; সেই সময়ের পার্থক্য থেকে "কত নম্বর কোড" ফাঁস হতে পারত।
    }
  }

  if (matched < 0) return { ok: false, remaining: [...hashes] };

  return {
    ok: true,
    remaining: hashes.filter((_, i) => i !== matched),
  };
}

// ══════════════════ দুই পথ একসাথে ══════════════════

export interface SecondFactorAttempt {
  /** authenticator অ্যাপের ৬ অঙ্ক */
  totp?: string;
  /** কাগজে লেখা একবার-ব্যবহার্য কোড */
  recoveryCode?: string;
}

export type SecondFactorVerdict =
  | {
      ok: true;
      /** ⚠️ খরচ হওয়া কোড/counter বসানো **নতুন** খাম — এটাই জমা দিতে হবে */
      env: TotpEnvelope;
      usedRecoveryCode: boolean;
    }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid' | 'replayed' };

/**
 * লগইনের দ্বিতীয় ধাপ — দুটো পথ এক জায়গায়।
 *
 * ⭐ ফেরত দেওয়া `env`-টাই আসল কথা: TOTP-এ `lastCounter` এগোয়, রিকভারিতে
 *    কোডটা তালিকা থেকে বাদ যায়। কল করার জায়গা এটা জমা না দিলে replay
 *    ঠেকানো আর "একবার-ব্যবহার্য" — দুটোই কাগুজে থেকে যেত।
 *
 * ⚠️ `missing` আলাদা করে ফেরত আসে কারণ সেটা **ব্যর্থতা নয়** — কোড না
 *    দেওয়া মানে ব্যবহারকারী সবে প্রথম ধাপ পেরিয়েছে। ব্যর্থতা ধরলে
 *    প্রতিটা স্বাভাবিক লগইনই throttle-এর কাউন্টার বাড়াত।
 */
export function verifySecondFactor(
  env: TotpEnvelope,
  attempt: SecondFactorAttempt,
  now: number = Date.now(),
): SecondFactorVerdict {
  const totp = (attempt.totp ?? '').trim();
  const recovery = (attempt.recoveryCode ?? '').trim();

  if (totp === '' && recovery === '') return { ok: false, reason: 'missing' };

  if (totp !== '') {
    const verdict = verifyTotpCode(env, totp, now);
    if (verdict.ok) {
      return {
        ok: true,
        usedRecoveryCode: false,
        env: { ...env, lastCounter: verdict.counter },
      };
    }
    // ⚠️ রিকভারি কোড না দিলে এখানেই শেষ — আর তখন আসল কারণটাই ফেরত যায়
    //    (`replayed` বার্তাটা ব্যবহারকারীকে "পরের কোডের জন্য অপেক্ষা করুন"
    //     বলতে পারে, যেটা `invalid`-এর চেয়ে অনেক কাজের)।
    if (recovery === '') return { ok: false, reason: verdict.reason };
  }

  const used = consumeRecoveryCode(env.recoveryHashes, recovery);
  if (used.ok) {
    return {
      ok: true,
      usedRecoveryCode: true,
      env: { ...env, recoveryHashes: used.remaining },
    };
  }

  return { ok: false, reason: 'invalid' };
}
