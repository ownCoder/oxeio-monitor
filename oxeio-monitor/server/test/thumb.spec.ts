import { describe, expect, it } from 'vitest';

import {
  checkThumb,
  looksLikeWebp,
  MAX_THUMB_BYTES,
  THUMB_DIR,
  thumbPathFor,
} from '../src/screenshots/thumb';

/**
 * A06 — থাম্বনেইলের খাঁটি হিসাব।
 *
 * এখানকার প্রায় প্রতিটা টেস্টই **নীরব ভুলের** পরীক্ষা। থাম্বনেইল ফিচারটার
 * ধরনই এমন: ভুল হলে কোনো এক্সেপশন ওঠে না, কেউ ৫০০ দেখে না। শুধু হয় ডিস্কে
 * ফাইল জমতে থাকে, নয় গ্রিডে ভাঙা ছবি আসে, নয় ৩২০px-এর বদলে ফুল ছবি নামে —
 * তিনটেরই কারণ খুঁজে বের করতে দিন লেগে যায়।
 */

const FULL = 'screenshots/2026/08/10/emp-003/093147_m0.webp';

/** RIFF কন্টেইনারের বৈধ মাথা — agent.e2e.spec.ts-এর ফিক্সচারের মতোই */
function webpBytes(extra = 0): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(extra),
  ]);
}

function candidate(over: Partial<{ mimetype: string; size: number; buffer: Buffer }> = {}) {
  const buffer = over.buffer ?? webpBytes(1000);
  return {
    mimetype: over.mimetype ?? 'image/webp',
    size: over.size ?? buffer.length,
    buffer,
  };
}

describe('থাম্বনেইলের পথ', () => {
  /**
   * ⭐ ingest যেখানে লেখে আর retention যেখানে খোঁজে — একই ফাংশন বলেই
   * দুটো এক। আলাদা হলে সারি মুছত, ছোট ছবিগুলো ডিস্কে থেকে যেত, চিরকাল।
   */
  it('ফুল ছবির পাশে `thumb/` সাবফোল্ডারে, নাম অপরিবর্তিত', () => {
    expect(thumbPathFor(FULL)).toBe(
      'screenshots/2026/08/10/emp-003/thumb/093147_m0.webp',
    );
  });

  /**
   * ⚠️ এটাই সাবফোল্ডার বেছে নেওয়ার মূল কারণ: `…/emp-003/*.webp` গুনলে
   * এখনো ওই দিনের স্ক্রিনশটের সংখ্যাই পাওয়া যায়। `093147_m0-thumb.webp`
   * পাশে রাখলে প্রতিটা গণনা নীরবে দ্বিগুণ দেখাত।
   */
  it('ফাইলের নাম বদলায় না — তাই ফুল ছবির গণনা দ্বিগুণ হয় না', () => {
    const thumb = thumbPathFor(FULL);
    expect(thumb?.endsWith('/093147_m0.webp')).toBe(true);
    expect(thumb).toContain(`/${THUMB_DIR}/`);
  });

  it('Windows-এর ব্যাকস্ল্যাশ পথও সামলায় — পুরোনো সারিতে ওগুলো থাকতে পারে', () => {
    expect(thumbPathFor('screenshots\\2026\\08\\10\\emp-003\\093147_m0.webp')).toBe(
      'screenshots/2026/08/10/emp-003/thumb/093147_m0.webp',
    );
  });

  /**
   * ⭐ সবচেয়ে জরুরি পরীক্ষা। পথটা এজেন্টের পাঠানো নাম থেকে এলে একটা
   * দখল-হওয়া ডিভাইস `../../` দিয়ে storage-এর বাইরে যেকোনো ফাইল লিখে
   * ফেলতে পারত — আর ফাইল লেখাটা ব্যর্থ হতো না, তাই কোনো এররও উঠত না।
   */
  it.each([
    ['ট্রাভার্সাল', 'screenshots/../../etc/passwd.webp'],
    ['লুকোনো ট্রাভার্সাল', 'screenshots/2026/../../../x.webp'],
    ['absolute', '/etc/shadow.webp'],
    ['ড্রাইভ লেটার', 'C:/Windows/System32/x.webp'],
    ['ব্যাকস্ল্যাশে ড্রাইভ', 'C:\\Windows\\x.webp'],
    ['ডাবল স্ল্যাশ', 'screenshots//emp-003/x.webp'],
    ['একক ডট', 'screenshots/./x.webp'],
    ['খালি', ''],
    ['শুধু ফাঁকা', '   '],
  ])('%s পথে থাম্বনেইল বানানো হয় না', (_label, path) => {
    expect(thumbPathFor(path)).toBeNull();
  });

  it('webp ছাড়া অন্য এক্সটেনশন বাদ (ADR-007)', () => {
    expect(thumbPathFor('screenshots/2026/08/10/emp-003/x.png')).toBeNull();
    expect(thumbPathFor('screenshots/2026/08/10/emp-003/x')).toBeNull();
  });

  it('ফোল্ডার ছাড়া নাম বাদ — নইলে থাম্বনেইল storage রুটে গিয়ে পড়ত', () => {
    expect(thumbPathFor('093147_m0.webp')).toBeNull();
  });

  /**
   * ⚠️ ভবিষ্যতে কেউ ভুল করে `thumbPathFor(row.thumbPath)` লিখলে
   * `thumb/thumb/…` তৈরি হতো — আর retention সেটা কখনো খুঁজে পেত না।
   */
  it('থাম্বনেইলের পথকে আবার মোড়ানো যায় না', () => {
    const once = thumbPathFor(FULL);
    expect(once).not.toBeNull();
    expect(thumbPathFor(once!)).toBeNull();
  });
});

describe('থাম্বনেইল গ্রহণযোগ্য কি না', () => {
  it('স্বাভাবিক ৩২০px webp নেওয়া হয়', () => {
    expect(checkThumb(candidate(), 150_000)).toBeNull();
  });

  /**
   * ⭐ A06-এর পুরো উদ্দেশ্যটাই এখানে। থাম্বনেইল ফুল ছবির চেয়ে ছোট না হলে
   * গ্রিড একই বাইট নামাত আর ডিস্কে দ্বিগুণ জায়গা যেত — অর্থাৎ ফিচারটা
   * উল্টো কাজ করত, একদম নীরবে। এজেন্ট ভুল করে একই বাফার দুবার জুড়ে
   * দিলে ঠিক এটাই হয়।
   */
  it('ফুল ছবির সমান বা বড় হলে নেওয়া হয় না', () => {
    const buf = webpBytes(50_000);
    expect(checkThumb(candidate({ buffer: buf }), buf.length)).toBe(
      'not_smaller_than_full',
    );
    expect(checkThumb(candidate({ buffer: buf }), 1000)).toBe(
      'not_smaller_than_full',
    );
  });

  /**
   * ⚠️ Content-Type এজেন্টের নিজের লেখা — অর্থাৎ আক্রমণকারীর নিয়ন্ত্রণে।
   * বাইট না দেখলে `image/webp` লিখে HTML বা EXE storage-এ রাখা যেত, আর
   * পরে সেটাই `image/webp` হেডারে সার্ভ হতো।
   */
  it('হেডার webp বললেও বাইট webp না হলে বাতিল', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(checkThumb(candidate({ buffer: html }), 150_000)).toBe('not_webp');
  });

  it('RIFF আছে কিন্তু WEBP নেই (যেমন WAV) — বাতিল', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(checkThumb(candidate({ buffer: wav }), 150_000)).toBe('not_webp');
  });

  it('ভুল mime বাতিল', () => {
    expect(checkThumb(candidate({ mimetype: 'image/png' }), 150_000)).toBe(
      'bad_mime',
    );
  });

  it('খালি অংশ বাতিল', () => {
    expect(checkThumb(candidate({ buffer: Buffer.alloc(0), size: 0 }), 1000)).toBe(
      'empty',
    );
  });

  it('অস্বাভাবিক বড় হলে বাতিল — ৩২০px ছবি কখনো এত বড় হয় না', () => {
    const big = webpBytes(MAX_THUMB_BYTES + 1);
    expect(checkThumb(candidate({ buffer: big }), 10_000_000)).toBe('too_large');
  });

  /**
   * ⚠️ ক্রমটাও পরীক্ষা করা হচ্ছে: বাইট যাচাই আকারের **আগে**। উল্টো হলে
   * একটা বিশাল অ-webp ফাইল `too_large` হিসেবে লগে যেত, আর "এজেন্ট ভুল
   * ফরম্যাট পাঠাচ্ছে" কথাটা কেউ কোনোদিন জানত না।
   */
  it('বড় এবং অ-webp হলে ফরম্যাটের কারণটাই বলা হয়', () => {
    const big = Buffer.alloc(MAX_THUMB_BYTES + 1, 0x41);
    expect(checkThumb(candidate({ buffer: big }), 10_000_000)).toBe('not_webp');
  });

  it('১২ বাইটের কম কিছুই webp নয়', () => {
    expect(looksLikeWebp(Buffer.from('RIFF'))).toBe(false);
    expect(looksLikeWebp(webpBytes())).toBe(true);
  });
});
