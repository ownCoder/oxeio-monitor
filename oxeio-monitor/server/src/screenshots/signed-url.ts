import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * I07 — স্ক্রিনশটের signed URL (স্পেক § ৪.২, § ৭)।
 *
 * ⭐ টোকেন **ডাটাবেসে জমে না**। সই-ই একমাত্র প্রমাণ, তাই যাচাই করতে কোনো
 * I/O লাগে না — গ্যালারির ৬০টা ছবি লোড হওয়ার সময় ৬০টা DB লুকআপও হয় না।
 * এর দাম: টোকেন **বাতিল করা যায় না**। সেই কারণেই মেয়াদ মাত্র ৫ মিনিট —
 * revoke করতে না পারার ঝুঁকিটা সময় দিয়ে ছোট করা হয়েছে।
 *
 * ⚠️ signed URL মানে **লিঙ্কটাই চাবি** — যে-কেউ লিঙ্কটা পেলে (হোয়াটসঅ্যাপে
 *    পাঠানো, স্ক্রিন শেয়ার, ব্রাউজার হিস্টরি) ছবিটা দেখতে পাবে। তাই
 *    "কে দেখল" লেখা হয় **লিঙ্ক বানানোর সময়**, ছবি টানার সময় নয়
 *    (দেখুন screenshots.service.ts — I08)।
 *
 * এই ফাইলে কোনো I/O নেই — পুরোটাই খাঁটি ফাংশন, তাই DB ছাড়াই
 * test/signed-url.spec.ts-এ মেয়াদ/বিকৃতি/ভুল-সিক্রেট সব পরীক্ষা করা যায়।
 */

/** স্পেক § ৪.২ — "signed URL, ৫ মিনিটে expire" */
export const SIGNED_URL_TTL_SEC = 5 * 60;

/**
 * টোকেনের প্রথম অংশ। ভবিষ্যতে পে-লোডের গড়ন বদলালে সংস্করণ বাড়বে, আর
 * পুরোনো গড়নের টোকেন তখন `malformed` হয়ে ঝরে যাবে।
 *
 * ⚠️ সংস্করণটা সইয়ের ভেতরেও আছে — নইলে কেউ শুধু উপসর্গ বদলে দিয়ে
 *    নতুন সংস্করণের পার্সারকে পুরোনো পে-লোড গেলাতে পারত।
 */
export const TOKEN_VERSION = 'v1';

/**
 * ⭐ কোন রূপটা দেখা যাবে সেটাও সইয়ের ভেতরে।
 *
 * ⚠️ variant যদি ক্যোয়ারি প্যারামিটার হতো (`?token=…&variant=full`), তাহলে
 *    থাম্বনেইলের লিঙ্ক পাওয়া যে-কেউ শুধু একটা শব্দ বদলে ফুল-রেজ়লিউশন ছবি
 *    নামিয়ে নিতে পারত। গ্রিডে থাম্বনেইল দেখানো আর ফুল ছবি খোলা — দুটো
 *    আলাদা অনুমতি, তাই দুটো আলাদা টোকেন।
 */
export type ScreenshotVariant = 'thumb' | 'full';

/** টোকেন ছোট রাখতে এক অক্ষর — লিঙ্কটা `<img src>`-এ বসে, লম্বা হলে লাভ নেই */
const VARIANT_CODE: Record<ScreenshotVariant, string> = {
  thumb: 't',
  full: 'f',
};
const CODE_TO_VARIANT: Record<string, ScreenshotVariant | undefined> = {
  t: 'thumb',
  f: 'full',
};

/**
 * ⚠️ কাঁচা `JWT_SECRET` সরাসরি ব্যবহার করা হয় না — আলাদা label দিয়ে
 *    একটা নিজস্ব চাবি বের করা হয় (domain separation)। ফলে স্ক্রিনশটের
 *    টোকেন আর সেশন JWT কখনো একে অন্যের জায়গায় খাটবে না, এমনকি ভবিষ্যতে
 *    কেউ ভুল করে একই অ্যালগরিদম বেছে নিলেও।
 */
const KEY_LABEL = 'oxeio:screenshot-signed-url:v1';

export interface SignedClaims {
  screenshotId: bigint;
  variant: ScreenshotVariant;
  /** কে লিঙ্কটা চেয়েছিল — audit-এর সাথে মিলিয়ে দেখার জন্য টোকেনেই থাকে */
  viewerUserId: number;
  /** epoch সেকেন্ড */
  expiresAtSec: number;
}

export type VerifyFailure =
  /** গড়নই ভুল — অংশের সংখ্যা, সংস্করণ, বা সংখ্যা পার্স হয়নি */
  | 'malformed'
  /** সই মেলেনি — বদলে দেওয়া টোকেন, বা অন্য সিক্রেটে বানানো */
  | 'bad_signature'
  | 'expired';

export type VerifyResult =
  | { ok: true; claims: SignedClaims }
  | { ok: false; reason: VerifyFailure };

/**
 * সিক্রেট থেকে এই মডিউলের নিজস্ব HMAC চাবি।
 * সার্ভার চালুর সময় একবারই ডাকা হয় (signed-url.service.ts)।
 */
export function deriveSigningKey(rawSecret: string): Buffer {
  return createHmac('sha256', rawSecret).update(KEY_LABEL).digest();
}

export interface SignInput {
  screenshotId: bigint;
  variant: ScreenshotVariant;
  viewerUserId: number;
}

/**
 * `v1.f.42.1786500000.7.<sig>` — সইটা প্রথম পাঁচটা অংশের উপরেই।
 *
 * ⚠️ মেয়াদ (`exp`) সইয়ের **ভেতরে**। বাইরে রাখলে যে-কেউ সংখ্যাটা বাড়িয়ে
 *    দিয়ে লিঙ্কটাকে চিরস্থায়ী করে ফেলতে পারত, আর সই তবু মিলে যেত।
 */
export function signScreenshotToken(
  input: SignInput,
  key: Buffer,
  nowMs: number = Date.now(),
  ttlSec: number = SIGNED_URL_TTL_SEC,
): string {
  const expiresAtSec = Math.floor(nowMs / 1000) + ttlSec;

  const body = [
    TOKEN_VERSION,
    VARIANT_CODE[input.variant],
    input.screenshotId.toString(),
    String(expiresAtSec),
    String(input.viewerUserId),
  ].join('.');

  return `${body}.${hmac(body, key)}`;
}

/**
 * ⭐ যাচাইয়ের ক্রম: **গড়ন → সই → অর্থ → মেয়াদ**।
 *
 * ⚠️ সই মেলার আগে টোকেনের কোনো মান বিশ্বাস করা হয় না। উল্টো ক্রমে লিখলে
 *    (আগে মেয়াদ দেখে, পরে সই) কোড ভুল করত না ঠিকই, কিন্তু অভ্যাসটা
 *    বিপজ্জনক — পরে কেউ "শুধু id-টা তো পড়ছি" বলে একটা অযাচাইকৃত মান
 *    ব্যবহার করে ফেলত।
 */
export function verifyScreenshotToken(
  token: string,
  key: Buffer,
  nowMs: number = Date.now(),
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 6) return { ok: false, reason: 'malformed' };

  const [version, variantCode, idPart, expPart, viewerPart, signature] = parts;
  if (version !== TOKEN_VERSION) return { ok: false, reason: 'malformed' };

  const body = parts.slice(0, 5).join('.');
  if (!safeEqual(signature, hmac(body, key))) {
    return { ok: false, reason: 'bad_signature' };
  }

  // এখান থেকে মানগুলো আমাদেরই লেখা — তবু অন্ধভাবে নয়, কারণ ভবিষ্যতে
  // সংস্করণ বদলালে পুরোনো সই-করা টোকেনও এখানে এসে পড়তে পারে।
  const variant = CODE_TO_VARIANT[variantCode];
  if (!variant) return { ok: false, reason: 'malformed' };

  if (!/^\d{1,19}$/.test(idPart)) return { ok: false, reason: 'malformed' };
  if (!/^\d{1,12}$/.test(expPart)) return { ok: false, reason: 'malformed' };
  if (!/^\d{1,12}$/.test(viewerPart)) return { ok: false, reason: 'malformed' };

  const expiresAtSec = Number(expPart);

  // ⚠️ ঠিক মেয়াদের মুহূর্তটাও "শেষ" ধরা হয় (`<=`)। এক সেকেন্ড এদিক-ওদিক
  //    কিছুই বদলায় না, কিন্তু সীমানার আচরণ অনিশ্চিত থাকলে টেস্ট লিখতে গিয়ে
  //    বোঝা যায় না কোনটা সঠিক।
  if (expiresAtSec * 1000 <= nowMs) return { ok: false, reason: 'expired' };

  return {
    ok: true,
    claims: {
      screenshotId: BigInt(idPart),
      variant,
      viewerUserId: Number(viewerPart),
      expiresAtSec,
    },
  };
}

function hmac(body: string, key: Buffer): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

/**
 * ⚠️ `a === b` দিয়ে সই মেলালে তুলনার সময় থেকেই কত অক্ষর মিলেছে তা
 *    অনুমান করা যায় (timing attack)। `timingSafeEqual` দৈর্ঘ্য আলাদা হলে
 *    ছুঁড়ে দেয়, তাই দৈর্ঘ্যটা আগে নিজে মিলিয়ে নিতে হয়।
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
