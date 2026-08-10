import { Secret, TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';

import {
  IDLE_WARN_BEFORE_SEC,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  SESSION_TTL_MIN,
  TOTP_PERIOD,
} from '../src/auth/auth.constants';
import { idleStateAt, shouldPingSession } from '../src/auth/idle-timeout';
import {
  buildOtpauthUri,
  consumeRecoveryCode,
  decodeEnvelope,
  encodeEnvelope,
  formatRecoveryCode,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  normalizeTotpCode,
  RECOVERY_ALPHABET,
  TotpEnvelopeError,
  verifySecondFactor,
  verifyTotpCode,
  type TotpEnvelope,
} from '../src/auth/totp';

/**
 * I06/I09-এর খাঁটি অংশের টেস্ট — ডাটাবেস, Nest, HTTP কিছুই লাগে না।
 * সময় সবসময় হাতে দেওয়া, তাই ফল স্থির।
 *
 * ⚠️ `resetDatabase()` এখানে নেই আর দরকারও নেই — এই ফাইলটা অন্য কোনো
 *    টেস্টের ফিক্সচার ছোঁয় না, তাই সমান্তরালে চললেও নিরাপদ।
 */

/** টেস্টের ভেতরে কোড বানাতে হয় — অ্যাপ যে অ্যালগরিদম ব্যবহার করে, সেটাই */
function codeAt(secret: string, timestamp: number): string {
  return TOTP.generate({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD,
    timestamp,
  });
}

function envelope(over: Partial<TotpEnvelope> = {}): TotpEnvelope {
  return {
    v: 1,
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    enabled: true,
    recoveryHashes: [],
    lastCounter: 0,
    ...over,
  };
}

// ══════════════════ খাম (envelope) ══════════════════

describe('totp খাম — এক কলামে চারটে জিনিস', () => {
  it('encode → decode-এ সব মান অবিকৃত ফেরে', () => {
    const env = envelope({ recoveryHashes: ['aa', 'bb'], lastCounter: 42 });
    expect(decodeEnvelope(encodeEnvelope(env))).toEqual(env);
  });

  it('খালি/null মানে 2FA নেই', () => {
    expect(decodeEnvelope(null)).toBeNull();
    expect(decodeEnvelope(undefined)).toBeNull();
    expect(decodeEnvelope('   ')).toBeNull();
  });

  /**
   * ⚠️ এটাই সবচেয়ে জরুরি টেস্ট: হাতে বসানো পুরোনো সিক্রেটকে "চালু" ধরতে
   *    হবে। "বন্ধ" ধরলে 2FA নীরবে উধাও হয়ে যেত আর কেউ টেরও পেত না।
   */
  it('JSON নয় এমন স্ট্রিং = পুরোনো ফরম্যাটের সিক্রেট, আর সেটা চালু', () => {
    const env = decodeEnvelope('JBSWY3DPEHPK3PXP');
    expect(env?.enabled).toBe(true);
    expect(env?.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(env?.recoveryHashes).toEqual([]);
  });

  /**
   * ⚠️ বিকৃত JSON-এ `null` ফেরালে "2FA নেই" বোঝাত — অর্থাৎ ডেটা নষ্ট হলে
   *    নিরাপত্তাও উধাও। তাই ছোড়া হয়: লগইন ব্যর্থ হবে, ফাঁক তৈরি হবে না।
   */
  it('ভাঙা JSON বা ভুল আকারে ছোড়ে — নীরবে 2FA বন্ধ হয় না', () => {
    expect(() => decodeEnvelope('{oops')).toThrow(TotpEnvelopeError);
    expect(() => decodeEnvelope('{"secret":"AB"}')).toThrow(TotpEnvelopeError);
    expect(() => decodeEnvelope('{"secret":"","enabled":true,"recoveryHashes":[],"lastCounter":0}')).toThrow(
      TotpEnvelopeError,
    );
    expect(() =>
      decodeEnvelope('{"secret":"AB","enabled":"yes","recoveryHashes":[],"lastCounter":0}'),
    ).toThrow(TotpEnvelopeError);
    expect(() =>
      decodeEnvelope('{"secret":"AB","enabled":true,"recoveryHashes":[7],"lastCounter":0}'),
    ).toThrow(TotpEnvelopeError);
  });
});

// ══════════════════ সিক্রেট ও QR লিংক ══════════════════

describe('সিক্রেট ও otpauth লিংক', () => {
  it('সিক্রেট base32, ২০ বাইট = ৩২ অক্ষর', () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateSecret()).not.toBe(s);
  });

  it('otpauth লিংকে issuer ও ইমেইল দুটোই থাকে', () => {
    const uri = buildOtpauthUri(generateSecret(), 'owner@oxeio.local');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=oXeio%20Monitor');
    expect(uri).toContain('owner%40oxeio.local');
    expect(uri).toContain('period=30');
    expect(uri).toContain('digits=6');
  });
});

// ══════════════════ TOTP যাচাই ══════════════════

describe('TOTP যাচাই', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const now = 1_760_000_000_000; // স্থির সময়, তাই ফলও স্থির

  it('এখনকার কোড মেলে আর counter ফেরত দেয়', () => {
    const v = verifyTotpCode(envelope({ secret }), codeAt(secret, now), now);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.counter).toBe(Math.floor(now / 1000 / TOTP_PERIOD));
  });

  it('স্পেস/ড্যাশসহ কপি করা কোডও চলে', () => {
    const code = codeAt(secret, now);
    const messy = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotpCode(envelope({ secret }), messy, now).ok).toBe(true);
    expect(normalizeTotpCode(' 12-34 56 ')).toBe('123456');
  });

  it('৬ অঙ্ক না হলে malformed', () => {
    const v = verifyTotpCode(envelope({ secret }), '1234', now);
    expect(v).toEqual({ ok: false, reason: 'malformed' });
  });

  it('ভাঙা সিক্রেটে malformed — ছোড়ে না', () => {
    const v = verifyTotpCode(envelope({ secret: '!!!!' }), '123456', now);
    expect(v).toEqual({ ok: false, reason: 'malformed' });
  });

  it('ভুল কোডে invalid', () => {
    const wrong = codeAt(secret, now) === '000000' ? '111111' : '000000';
    expect(verifyTotpCode(envelope({ secret }), wrong, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  /**
   * ⚠️ ±১ ধাপ সহনশীলতা — ফোনের ঘড়ি কয়েক সেকেন্ড এদিক-ওদিক থাকা স্বাভাবিক।
   *    ০ রাখলে বহু বৈধ লগইন অকারণে ব্যর্থ হতো।
   */
  it('±১ ধাপ (±৩০ সেকেন্ড) সহ্য করে, ±২ করে না', () => {
    const step = TOTP_PERIOD * 1000;
    expect(verifyTotpCode(envelope({ secret }), codeAt(secret, now - step), now).ok).toBe(true);
    expect(verifyTotpCode(envelope({ secret }), codeAt(secret, now + step), now).ok).toBe(true);
    expect(verifyTotpCode(envelope({ secret }), codeAt(secret, now - 2 * step), now).ok).toBe(false);
    expect(verifyTotpCode(envelope({ secret }), codeAt(secret, now + 2 * step), now).ok).toBe(false);
  });

  /**
   * ⚠️ replay — একই ৬ অঙ্ক ৩০ সেকেন্ড ধরে বৈধ থাকে। counter মনে না রাখলে
   *    কাঁধের উপর দিয়ে দেখে ফেলা কোড দিয়ে দ্বিতীয়বার ঢোকা যেত।
   */
  it('একই কোড দুবার চলে না', () => {
    const env = envelope({ secret });
    const code = codeAt(secret, now);

    const first = verifyTotpCode(env, code, now);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const after = { ...env, lastCounter: first.counter };
    expect(verifyTotpCode(after, code, now)).toEqual({
      ok: false,
      reason: 'replayed',
    });
  });

  /** পিছনের ধাপের কোড (window-এর ভেতরে হলেও) আর চলবে না */
  it('আগের ধাপের কোডও replayed — counter এগিয়ে গেলে পিছনে ফেরা নেই', () => {
    const step = TOTP_PERIOD * 1000;
    const env = envelope({
      secret,
      lastCounter: Math.floor(now / 1000 / TOTP_PERIOD),
    });
    expect(verifyTotpCode(env, codeAt(secret, now - step), now)).toEqual({
      ok: false,
      reason: 'replayed',
    });
  });

  it('পরের ধাপের কোড চলে — ঘড়ি সামান্য এগিয়ে থাকা ইউজার আটকায় না', () => {
    const step = TOTP_PERIOD * 1000;
    const env = envelope({
      secret,
      lastCounter: Math.floor(now / 1000 / TOTP_PERIOD),
    });
    const v = verifyTotpCode(env, codeAt(secret, now + step), now);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.counter).toBe(env.lastCounter + 1);
  });

  it('২FA বন্ধ থাকলেও যাচাই কাজ করে — enable ধাপে ঠিক এটাই দরকার', () => {
    const env = envelope({ secret, enabled: false });
    expect(verifyTotpCode(env, codeAt(secret, now), now).ok).toBe(true);
  });
});

// ══════════════════ রিকভারি কোড ══════════════════

describe('রিকভারি কোড', () => {
  /** ⚠️ ৩২ না হলে `% length` কিছু অক্ষরকে বেশি বার বেছে নিত */
  it('বর্ণমালা ঠিক ৩২ অক্ষর, আর 0/1/I/O নেই', () => {
    expect(RECOVERY_ALPHABET).toHaveLength(32);
    expect(new Set(RECOVERY_ALPHABET).size).toBe(32);
    for (const ch of '01IO') expect(RECOVERY_ALPHABET).not.toContain(ch);
  });

  it('ডিফল্টে ১০টা কোড, প্রতিটা ১০ অক্ষর + মাঝে ড্যাশ', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const c of codes) {
      expect(c).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
      expect(normalizeRecoveryCode(c)).toHaveLength(RECOVERY_CODE_LENGTH);
    }
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it('ড্যাশ শুধু পড়ার সুবিধা — হ্যাশে ঢোকে না', () => {
    expect(formatRecoveryCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
    expect(hashRecoveryCode('ABCDE-FGHJK')).toBe(hashRecoveryCode('abcdefghjk'));
    expect(hashRecoveryCode('a b c d e f g h j k')).toBe(
      hashRecoveryCode('ABCDEFGHJK'),
    );
  });

  it('হ্যাশ ৬৪ অক্ষরের hex — plaintext কোথাও থাকে না', () => {
    const h = hashRecoveryCode('ABCDE-FGHJK');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('ABCDE');
  });

  /**
   * ⚠️ মিলে গেলে তালিকা থেকে বাদ যাওয়া অপরিহার্য — নইলে একই কাগজের
   *    কোড বারবার চলত, অর্থাৎ "একবার-ব্যবহার্য" কথাটাই মিথ্যা হতো।
   */
  it('সঠিক কোড খরচ হয়ে যায়, দ্বিতীয়বার চলে না', () => {
    const codes = generateRecoveryCodes(3);
    const hashes = codes.map(hashRecoveryCode);

    const first = consumeRecoveryCode(hashes, codes[1]);
    expect(first.ok).toBe(true);
    expect(first.remaining).toHaveLength(2);
    expect(first.remaining).not.toContain(hashes[1]);

    expect(consumeRecoveryCode(first.remaining, codes[1]).ok).toBe(false);
  });

  it('ভুল কোডে তালিকা অক্ষত থাকে', () => {
    const codes = generateRecoveryCodes(3);
    const hashes = codes.map(hashRecoveryCode);
    const v = consumeRecoveryCode(hashes, 'ZZZZZ-ZZZZZ');
    expect(v.ok).toBe(false);
    expect(v.remaining).toEqual(hashes);
  });

  it('খালি কোডে কখনো সফল নয় — খালি তালিকার সাথেও নয়', () => {
    expect(consumeRecoveryCode([], '').ok).toBe(false);
    expect(consumeRecoveryCode([hashRecoveryCode('ABCDEFGHJK')], '  -  ').ok).toBe(
      false,
    );
  });

  it('ছোট হাতের অক্ষর আর বাড়তি স্পেসেও মেলে — কাগজ দেখে টাইপ করা কোড', () => {
    const codes = generateRecoveryCodes(2);
    const hashes = codes.map(hashRecoveryCode);
    const sloppy = ` ${codes[0].toLowerCase().replace('-', ' ')} `;
    expect(consumeRecoveryCode(hashes, sloppy).ok).toBe(true);
  });

  /** ভাঙা hex জমা থাকলেও যেন ছুড়ে না দেয় (timingSafeEqual দৈর্ঘ্যে ছোড়ে) */
  it('তালিকায় ভাঙা হ্যাশ থাকলেও ছোড়ে না', () => {
    const code = generateRecoveryCodes(1)[0];
    const hashes = ['zz', '', hashRecoveryCode(code)];
    expect(consumeRecoveryCode(hashes, code).ok).toBe(true);
  });
});

// ══════════════════ দ্বিতীয় ধাপ — দুই পথ একসাথে ══════════════════

describe('verifySecondFactor — লগইনের দ্বিতীয় ধাপ', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const now = 1_760_000_000_000;

  function withCodes(): { env: TotpEnvelope; codes: string[] } {
    const codes = generateRecoveryCodes(3);
    return {
      env: envelope({ secret, recoveryHashes: codes.map(hashRecoveryCode) }),
      codes,
    };
  }

  /**
   * ⚠️ `missing` আলাদা হওয়া অপরিহার্য — এটাকে ব্যর্থতা ধরলে প্রতিটা
   *    স্বাভাবিক লগইনই throttle-এর কাউন্টার বাড়াত, আর পাঁচবার লগইন করলেই
   *    ১৫ মিনিটের তালা পড়ত।
   */
  it('কিছুই না দিলে missing — invalid নয়', () => {
    const { env } = withCodes();
    expect(verifySecondFactor(env, {}, now)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verifySecondFactor(env, { totp: '  ', recoveryCode: '' }, now)).toEqual(
      { ok: false, reason: 'missing' },
    );
  });

  it('সঠিক TOTP-এ counter এগোয়, রিকভারি তালিকা অক্ষত', () => {
    const { env } = withCodes();
    const v = verifySecondFactor(env, { totp: codeAt(secret, now) }, now);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.usedRecoveryCode).toBe(false);
    expect(v.env.lastCounter).toBe(Math.floor(now / 1000 / TOTP_PERIOD));
    expect(v.env.recoveryHashes).toEqual(env.recoveryHashes);
  });

  it('সঠিক রিকভারি কোডে সেটা বাদ যায়, counter অপরিবর্তিত', () => {
    const { env, codes } = withCodes();
    const v = verifySecondFactor(env, { recoveryCode: codes[2] }, now);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.usedRecoveryCode).toBe(true);
    expect(v.env.recoveryHashes).toHaveLength(2);
    expect(v.env.lastCounter).toBe(env.lastCounter);
  });

  /** ⚠️ শুধু TOTP দিলে রিকভারি তালিকা ঘেঁটে দেখা যাবে না — নইলে ৬ অঙ্কের
   *  ভুল কোডও দৈবক্রমে কোনো রিকভারি হ্যাশে মিলে যাওয়ার পথ খুলত */
  it('ভুল TOTP আর কোনো রিকভারি কোড না থাকলে আসল কারণটাই ফেরে', () => {
    const { env } = withCodes();
    expect(verifySecondFactor(env, { totp: '000000' }, now).ok).toBe(false);
    expect(verifySecondFactor(env, { totp: '12' }, now)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('replay-এর কারণটা আলাদা করে ফেরে — ব্যবহারকারীকে বলার মতো বার্তা', () => {
    const { env } = withCodes();
    const used = { ...env, lastCounter: Math.floor(now / 1000 / TOTP_PERIOD) };
    expect(verifySecondFactor(used, { totp: codeAt(secret, now) }, now)).toEqual({
      ok: false,
      reason: 'replayed',
    });
  });

  it('দুটোই ভুল হলে invalid, আর কিছুই খরচ হয় না', () => {
    const { env } = withCodes();
    const v = verifySecondFactor(
      env,
      { totp: '000000', recoveryCode: 'ZZZZZ-ZZZZZ' },
      now,
    );
    expect(v).toEqual({ ok: false, reason: 'invalid' });
  });

  it('অ্যাপের কোড ভুল হলেও রিকভারি কোড থাকলে সেটাই চলবে', () => {
    const { env, codes } = withCodes();
    const v = verifySecondFactor(
      env,
      { totp: '000000', recoveryCode: codes[0] },
      now,
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.usedRecoveryCode).toBe(true);
  });
});

// ══════════════════ I09 — নিষ্ক্রিয়তা ══════════════════

describe('নিষ্ক্রিয়তার হিসাব (I09)', () => {
  const TIMEOUT = SESSION_TTL_MIN * 60 * 1000;
  const WARN = IDLE_WARN_BEFORE_SEC * 1000;
  const t0 = 1_700_000_000_000;

  it('সদ্য সক্রিয় = active, পুরো সময় বাকি', () => {
    expect(idleStateAt(t0, t0, TIMEOUT, WARN)).toEqual({
      phase: 'active',
      msLeft: TIMEOUT,
    });
  });

  it('সতর্কতার জানালার ঠিক আগে এখনো active', () => {
    const s = idleStateAt(t0, t0 + TIMEOUT - WARN - 1, TIMEOUT, WARN);
    expect(s.phase).toBe('active');
  });

  /**
   * ⚠️ ঠিক সীমানায় সতর্কবার্তা না দেখালে ইউজার শেষ মুহূর্তে কোনো
   *    সতর্কতাই পেত না — কাজের মাঝপথে চুপচাপ লগআউট, যা নিষিদ্ধ।
   */
  it('ঠিক ১ মিনিট বাকি থাকতেই warning', () => {
    const s = idleStateAt(t0, t0 + TIMEOUT - WARN, TIMEOUT, WARN);
    expect(s).toEqual({ phase: 'warning', msLeft: WARN });
  });

  it('সময় ফুরালে expired, msLeft ঠিক ০', () => {
    expect(idleStateAt(t0, t0 + TIMEOUT, TIMEOUT, WARN)).toEqual({
      phase: 'expired',
      msLeft: 0,
    });
    expect(idleStateAt(t0, t0 + TIMEOUT + 99_999, TIMEOUT, WARN)).toEqual({
      phase: 'expired',
      msLeft: 0,
    });
  });

  /**
   * ⚠️ ঘড়ি পিছিয়ে গেলে (ঘুম থেকে ওঠা, NTP সিংক) বিয়োগটা ঋণাত্মক হতো আর
   *    `msLeft` টাইমআউটের চেয়েও বড় দেখাত — সতর্কবার্তা কখনো আসত না।
   */
  it('ঘড়ি পিছিয়ে গেলেও msLeft টাইমআউটের বেশি হয় না', () => {
    const s = idleStateAt(t0 + 60_000, t0, TIMEOUT, WARN);
    expect(s).toEqual({ phase: 'active', msLeft: TIMEOUT });
  });

  it('সতর্কতার জানালা টাইমআউটের সমান হলে শুরু থেকেই warning', () => {
    expect(idleStateAt(t0, t0, TIMEOUT, TIMEOUT).phase).toBe('warning');
  });

  it('keep-alive টোকা refresh ব্যবধানের আগে যায় না, পরে যায়', () => {
    const refresh = 5 * 60 * 1000;
    expect(shouldPingSession(t0, t0 + refresh - 1, refresh)).toBe(false);
    expect(shouldPingSession(t0, t0 + refresh, refresh)).toBe(true);
  });
});
