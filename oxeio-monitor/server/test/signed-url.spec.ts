import { describe, expect, it } from 'vitest';

import {
  deriveSigningKey,
  signScreenshotToken,
  SIGNED_URL_TTL_SEC,
  verifyScreenshotToken,
} from '../src/screenshots/signed-url';

/**
 * I07 — signed URL।
 *
 * এখানে যা পরীক্ষা হয় তার প্রায় সবটাই **নীরব ভুলের** পরীক্ষা: মেয়াদ না
 * দেখলে, বা সইয়ের বাইরে কোনো ফিল্ড রাখলে কোথাও কোনো এরর ওঠে না — শুধু
 * একটা লিঙ্ক চিরকাল খোলা থেকে যায়, বা এক কর্মীর লিঙ্ক দিয়ে আরেকজনের
 * স্ক্রিনশট বেরিয়ে আসে।
 */

const SECRET = 'test-only-secret-at-least-32-characters-long';
const KEY = deriveSigningKey(SECRET);

/** ২০২৬-০৮-১০ ১২:০০:০০ UTC — স্থির সময়, নইলে টেস্ট ঘড়ির উপর নির্ভর করত */
const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

function make(
  over: Partial<{
    screenshotId: bigint;
    variant: 'thumb' | 'full';
    viewerUserId: number;
  }> = {},
  nowMs = NOW,
): string {
  return signScreenshotToken(
    {
      screenshotId: over.screenshotId ?? 42n,
      variant: over.variant ?? 'full',
      viewerUserId: over.viewerUserId ?? 7,
    },
    KEY,
    nowMs,
  );
}

describe('signed URL — সই করা ও যাচাই', () => {
  it('নিজের বানানো টোকেন নিজেই মেনে নেয়, আর দাবিগুলো অবিকৃত ফেরত আসে', () => {
    const token = make({ screenshotId: 9007199254740993n, viewerUserId: 3 });
    const result = verifyScreenshotToken(token, KEY, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // ⚠️ আইডিটা ইচ্ছে করেই Number.MAX_SAFE_INTEGER-এর চেয়ে বড়। কোথাও
    //    Number() হয়ে গেলে এখানেই ধরা পড়বে — নইলে বছর দুয়েক পরে,
    //    যখন screenshots.id বড় হবে, ভুল ছবি সার্ভ হতো।
    expect(result.claims.screenshotId).toBe(9007199254740993n);
    expect(result.claims.viewerUserId).toBe(3);
    expect(result.claims.variant).toBe('full');
  });

  it('কে চেয়েছিল সেটা টোকেনেই থাকে — audit-এর সাথে মেলানোর জন্য', () => {
    const token = make({ viewerUserId: 11 });
    const result = verifyScreenshotToken(token, KEY, NOW);

    expect(result.ok && result.claims.viewerUserId).toBe(11);
  });
});

/**
 * A06 — ৩২০px থাম্বনেইল আসার পর `variant` আর নিছক একটা লেবেল নয়: এখন
 * সত্যিই **দুটো আলাদা ফাইল** আছে, একটা ~১৫ KB আর একটা ~১৫০ KB। তাই
 * এখান থেকে variant-এর ভুল মানে হয় দশগুণ বেশি বাইট, নয় অননুমোদিত
 * ফুল-রেজ়লিউশন ছবি।
 */
describe('signed URL — variant (A06)', () => {
  it('thumb-এর টোকেন thumb হয়েই ফেরত আসে', () => {
    const result = verifyScreenshotToken(make({ variant: 'thumb' }), KEY, NOW);
    expect(result.ok && result.claims.variant).toBe('thumb');
  });

  /**
   * ⭐ একই ছবি, একই দর্শক, একই মুহূর্ত — তবু দুটো টোকেন **আলাদা**।
   * এক হয়ে গেলে বুঝতে হবে variant সইয়ের বাইরে চলে গেছে, আর তখন
   * গ্যালারির thumbUrl দিয়েই ফুল ছবি নামানো যেত।
   */
  it('একই ছবির thumb ও full টোকেন কখনো এক নয়', () => {
    const thumb = make({ variant: 'thumb' });
    const full = make({ variant: 'full' });

    expect(thumb).not.toBe(full);

    const t = thumb.split('.');
    const f = full.split('.');

    // আইডি, মেয়াদ, দর্শক — তিনটেই হুবহু এক
    expect(t.slice(2, 5)).toEqual(f.slice(2, 5));
    // পার্থক্য শুধু variant আর সই — অর্থাৎ সই variant-টাকে ঢেকে রেখেছে
    expect(t[1]).not.toBe(f[1]);
    expect(t[5]).not.toBe(f[5]);
  });

  /**
   * ⭐ সবচেয়ে সরল আক্রমণ: গ্যালারি প্রতিটা ছবির জন্য **দুটোই** লিঙ্ক
   * পাঠায় (thumbUrl, fullUrl)। কেউ যদি ফুলের সইটা কেটে thumb-এর শরীরে
   * বসায় — বা উল্টোটা — দুটোই ভাঙা চাই। সই পুরো শরীরের উপরে বলেই ভাঙে।
   */
  it('এক variant-এর সই অন্য variant-এর শরীরে বসে না', () => {
    const thumb = make({ variant: 'thumb' }).split('.');
    const full = make({ variant: 'full' }).split('.');

    const stolen = [...thumb.slice(0, 5), full[5]].join('.');
    expect(verifyScreenshotToken(stolen, KEY, NOW).ok).toBe(false);

    const reverse = [...full.slice(0, 5), thumb[5]].join('.');
    expect(verifyScreenshotToken(reverse, KEY, NOW).ok).toBe(false);
  });

  /**
   * ⚠️ variant **টোকেনের ভেতরে**, `?variant=thumb` নামের আলাদা ক্যোয়ারি
   * প্যারামিটারে নয়। প্যারামিটার হলে সইটা তাকে ছুঁতে পারত না, আর এক
   * শব্দ বদলেই thumb → full হয়ে যেত। এই টেস্টটা সেই নকশাটাকেই আটকে
   * রাখে: টোকেনের দ্বিতীয় অংশটাই একমাত্র জায়গা যেখানে variant থাকে।
   */
  it('variant টোকেনের নির্দিষ্ট অংশেই থাকে — বাইরে নয়', () => {
    expect(make({ variant: 'thumb' }).split('.')[1]).toBe('t');
    expect(make({ variant: 'full' }).split('.')[1]).toBe('f');
  });

  it('অজানা variant কোড কখনো পাশ করে না', () => {
    for (const code of ['x', 'T', 'F', 'thumb', '']) {
      const parts = make({ variant: 'full' }).split('.');
      parts[1] = code;
      expect(verifyScreenshotToken(parts.join('.'), KEY, NOW).ok).toBe(false);
    }
  });
});

describe('signed URL — মেয়াদ', () => {
  it('৫ মিনিটের এক সেকেন্ড আগেও চলে', () => {
    const token = make();
    const result = verifyScreenshotToken(
      token,
      KEY,
      NOW + (SIGNED_URL_TTL_SEC - 1) * 1000,
    );
    expect(result.ok).toBe(true);
  });

  /**
   * ⭐ এই টেস্টটাই I07-এর মূল কথা। মেয়াদ না দেখলে কোনো এরর হতো না —
   * লিঙ্কটা শুধু চিরকাল কাজ করত, আর কেউ কোনোদিন টের পেত না।
   */
  it('ঠিক ৫ মিনিটের মাথায় মেয়াদ শেষ ধরা হয়', () => {
    const token = make();
    const result = verifyScreenshotToken(
      token,
      KEY,
      NOW + SIGNED_URL_TTL_SEC * 1000,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('expired');
  });

  it('৬ মিনিট পরে তো নয়ই', () => {
    const token = make();
    const result = verifyScreenshotToken(token, KEY, NOW + 6 * 60 * 1000);
    expect(!result.ok && result.reason).toBe('expired');
  });

  /**
   * ⚠️ মেয়াদ সইয়ের **ভেতরে** আছে কি না — সেটার আসল পরীক্ষা এটাই।
   * বাইরে থাকলে exp বদলে দিলে সই তবু মিলত, আর লিঙ্কটা অমর হয়ে যেত।
   */
  it('মেয়াদ বাড়িয়ে দিলে সই আর মেলে না', () => {
    const parts = make().split('.');
    parts[3] = String(Number(parts[3]) + 86_400); // এক দিন বাড়ানো

    const result = verifyScreenshotToken(parts.join('.'), KEY, NOW);
    expect(!result.ok && result.reason).toBe('bad_signature');
  });
});

describe('signed URL — বদলে দেওয়া টোকেন', () => {
  /**
   * ⭐ সবচেয়ে ভয়ের আক্রমণ: নিজের ছবির একটা বৈধ লিঙ্ক নিয়ে শুধু আইডিটা
   * বদলে দেওয়া। সই আইডিটাকেও ঢেকে রাখে বলেই এটা ব্যর্থ হয়।
   */
  it('স্ক্রিনশট আইডি বদলালে ধরা পড়ে', () => {
    const parts = make({ screenshotId: 42n }).split('.');
    parts[2] = '43';

    const result = verifyScreenshotToken(parts.join('.'), KEY, NOW);
    expect(!result.ok && result.reason).toBe('bad_signature');
  });

  /**
   * ⭐ থাম্বনেইলের লিঙ্ক দিয়ে ফুল ছবি টানা যায় কি না।
   * variant সইয়ের ভেতরে না থাকলে এক অক্ষর বদলেই হয়ে যেত।
   */
  it('thumb → full বদলে দিলে ধরা পড়ে', () => {
    const parts = make({ variant: 'thumb' }).split('.');
    expect(parts[1]).toBe('t');
    parts[1] = 'f';

    const result = verifyScreenshotToken(parts.join('.'), KEY, NOW);
    expect(!result.ok && result.reason).toBe('bad_signature');
  });

  it('অন্য কারো নামে লিঙ্ক বানানো যায় না', () => {
    const parts = make({ viewerUserId: 7 }).split('.');
    parts[4] = '1'; // owner সেজে

    const result = verifyScreenshotToken(parts.join('.'), KEY, NOW);
    expect(!result.ok && result.reason).toBe('bad_signature');
  });

  it('সইয়ের এক অক্ষর বদলালেই বাতিল', () => {
    const parts = make().split('.');
    const sig = parts[5];
    parts[5] = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);

    const result = verifyScreenshotToken(parts.join('.'), KEY, NOW);
    expect(!result.ok && result.reason).toBe('bad_signature');
  });
});

describe('signed URL — ভুল সিক্রেট', () => {
  it('অন্য সিক্রেটে বানানো টোকেন মানা হয় না', () => {
    const otherKey = deriveSigningKey(
      'another-secret-that-is-also-at-least-32-chars',
    );
    const token = signScreenshotToken(
      { screenshotId: 42n, variant: 'full', viewerUserId: 7 },
      otherKey,
      NOW,
    );

    const result = verifyScreenshotToken(token, KEY, NOW);
    expect(!result.ok && result.reason).toBe('bad_signature');
  });

  /**
   * ⭐ domain separation। কাঁচা সিক্রেট একই হলেও চাবি আলাদা হওয়ার কথা —
   * নইলে ভবিষ্যতে অন্য কোনো মডিউল একই সিক্রেটে HMAC করলে তার টোকেন
   * এখানেও খেটে যেত।
   */
  it('একই কাঁচা সিক্রেট থেকে বের করা চাবি কাঁচা সিক্রেটের সমান নয়', () => {
    const derived = deriveSigningKey(SECRET);
    expect(derived.equals(Buffer.from(SECRET, 'utf8'))).toBe(false);
    // একই ইনপুটে একই চাবি — নইলে সার্ভার রিস্টার্টে সব লিঙ্ক ভাঙত
    expect(derived.equals(deriveSigningKey(SECRET))).toBe(true);
  });
});

describe('signed URL — গড়নই ভুল', () => {
  it.each([
    ['খালি', ''],
    ['অংশ কম', 'v1.f.42.999'],
    ['অংশ বেশি', `${make()}.extra`],
    ['ডট নেই', 'garbage'],
    ['অজানা সংস্করণ', make().replace(/^v1\./, 'v2.')],
    ['অজানা variant', make().replace(/^v1\.f\./, 'v1.x.')],
  ])('%s → malformed', (_label, token) => {
    const result = verifyScreenshotToken(token, KEY, NOW);
    expect(result.ok).toBe(false);
  });

  /**
   * ⚠️ অজানা variant-এর ক্ষেত্রে সই আগেই ভাঙে (`bad_signature`), কারণ
   * variant-ও সইয়ের ভেতরে। কোনটাই ফাঁক নয় — দুটোই "না"।
   */
  it('মেয়াদোত্তীর্ণ আর বিকৃত — দুটোতেই ok=false', () => {
    expect(verifyScreenshotToken('v1.f.1.1.1.abc', KEY, NOW).ok).toBe(false);
  });
});
