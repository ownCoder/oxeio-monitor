/**
 * A06 — ৩২০px থাম্বনেইল: **পথ ও গ্রহণযোগ্যতার খাঁটি হিসাব**।
 *
 * এখানে কোনো I/O নেই, কোনো Nest নেই — তাই DB ছাড়াই test/thumb.spec.ts-এ
 * পুরোটা পরীক্ষা করা যায়। ingest (লেখে), retention (মোছে) আর গ্যালারি
 * (সার্ভ করে) — তিনজনেই এই একই সংজ্ঞা ব্যবহার করে।
 *
 * ⚠️ `storage.config.ts`-এর শিক্ষাটা এখানেও: পথের হিসাব দুই জায়গায় নকল
 *    হলে ingest এক ফোল্ডারে লিখত আর retention আরেক ফোল্ডারে খুঁজত —
 *    থাম্বনেইল ডিস্কে জমতেই থাকত, চিরকাল, নীরবে।
 */

/**
 * ⭐ থাম্বনেইল যায় **আলাদা `thumb/` সাবফোল্ডারে**, `*-thumb.webp` নামে
 * পাশে নয়। তিনটে কারণ, তিনটেই বাস্তব:
 *
 *   ১· `…/emp-003/*.webp` গুনলে এখনো "ওই দিনে কতগুলো স্ক্রিনশট" পাওয়া
 *      যায়। পাশাপাশি রাখলে প্রতিটা গণনা **দ্বিগুণ** দেখাত — আর ভুলটা
 *      কোনো এরর ছাড়াই, শুধু ভুল সংখ্যা হয়ে।
 *   ২· ব্যাকআপে `/XD thumb` একটা লাইন — নামের প্যাটার্ন বাদ দেওয়ার
 *      চেয়ে ঢের নিরাপদ। থাম্বনেইল হারালে কিছুই যায় না (গ্যালারি ফুল
 *      ছবিতে ফেরত যায়), তাই রাতের robocopy-তে ওগুলো বাদ দেওয়াই ভালো।
 *   ৩· retention-এর `pruneEmptyDirs` এমনিতেই প্রতিটা পাথের `dirname`
 *      ধরে উপরে হাঁটে — সাবফোল্ডার নিজে থেকেই সামলে যায়।
 */
export const THUMB_DIR = 'thumb';

/** স্পেক § A06 — গ্রিডের জন্য ৩২০px চওড়া যথেষ্ট (কার্ড ~২৮০px, retina-তে ২×) */
export const THUMB_WIDTH = 320;

/**
 * ৩২০px WebP বাস্তবে ৮–২৫ KB। ২৫৬ KB সীমাটা তাই উদার — এটা "ঠিক আকার"
 * মাপার জন্য নয়, **ভুল জিনিস** আটকানোর জন্য: এজেন্ট ভুল করে ফুল ছবিটাই
 * দুবার পাঠালে যেন ডিস্কে দ্বিগুণ জায়গা না খায়।
 */
export const MAX_THUMB_BYTES = 256 * 1024;

/** ADR-007 — এজেন্ট শুধু webp পাঠায়, থাম্বনেইলও তা-ই */
export const THUMB_MIME = 'image/webp';

/**
 * ফুল ছবির relative পথ থেকে থাম্বনেইলের relative পথ।
 *
 * `screenshots/2026/08/10/emp-003/093147_m0.webp`
 *   → `screenshots/2026/08/10/emp-003/thumb/093147_m0.webp`
 *
 * ⭐ পথটা **সবসময় সার্ভারে বের করা হয়**, এজেন্টের পাঠানো নাম থেকে নয়।
 *    এজেন্ট শুধু বাইট পাঠায়। নাম দিতে পারলে একটা দখল-হওয়া ডিভাইস
 *    `../../../../` দিয়ে storage-এর বাইরে যেকোনো ফাইল লিখে ফেলতে পারত।
 *
 * @returns `null` মানে পথটা বিশ্বাসযোগ্য নয় — তখন থাম্বনেইলই তৈরি হবে না
 *          (`thumb_path` null থাকবে, গ্যালারি ফুল ছবিতে ফেরত যাবে)।
 */
export function thumbPathFor(fullRelPath: string): string | null {
  // ingest `/` দিয়ে লেখে, কিন্তু পুরোনো সারিতে Windows-এর `\` থাকতে পারে
  const rel = fullRelPath.replace(/\\/g, '/').trim();
  if (rel.length === 0) return null;

  // ⚠️ absolute পথ ও ড্রাইভ-লেটার দুটোই বাদ — `resolve(root, '/etc/x')`
  //    রুটটাকে সম্পূর্ণ উপেক্ষা করে, আর সেটা নীরবে।
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return null;

  const parts = rel.split('/');
  // খালি অংশ (`a//b`), `.` বা `..` — কোনোটাই বৈধ storage পথে থাকে না
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;

  // অন্তত একটা ফোল্ডার থাকতেই হবে — নইলে থাম্বনেইল storage রুটে গিয়ে পড়ত
  if (parts.length < 2) return null;

  const name = parts[parts.length - 1];
  if (!name.toLowerCase().endsWith('.webp')) return null;

  // ⚠️ ইতিমধ্যেই থাম্বনেইলের পথ — আবার মোড়ালে `thumb/thumb/…` হতো।
  //    ভবিষ্যতে কেউ ভুল করে `thumbPathFor(row.thumbPath)` লিখলে এখানে থামবে।
  if (parts[parts.length - 2] === THUMB_DIR) return null;

  parts.splice(parts.length - 1, 0, THUMB_DIR);
  return parts.join('/');
}

/** থাম্বনেইলটা কেন নেওয়া গেল না — লগে এই শব্দটাই যায় */
export type ThumbRejection =
  | 'empty'
  | 'bad_mime'
  | 'not_webp'
  | 'too_large'
  | 'not_smaller_than_full';

export interface ThumbCandidate {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * এজেন্টের পাঠানো থাম্বনেইলটা রাখার মতো কি না।
 *
 * ⚠️ এখানে "না" বলা মানে **আপলোড ব্যর্থ নয়** — ছবিটা মূল্যবান, থাম্বনেইলটা
 *    সুবিধা মাত্র (ingest দেখুন)। তাই এই ফাংশন কখনো ছুঁড়ে দেয় না, শুধু
 *    কারণটা ফেরত দেয়।
 *
 * @returns `null` মানে ঠিক আছে
 */
export function checkThumb(
  thumb: ThumbCandidate,
  fullSizeBytes: number,
): ThumbRejection | null {
  if (thumb.size <= 0 || thumb.buffer.length === 0) return 'empty';
  if (thumb.mimetype !== THUMB_MIME) return 'bad_mime';

  // ⚠️ Content-Type এজেন্টের নিজের লেখা — অর্থাৎ আক্রমণকারীর নিয়ন্ত্রণে।
  //    আসল বাইট না দেখলে `image/webp` লিখে যেকোনো কিছু (HTML, EXE)
  //    storage-এ রাখা যেত, আর সেটা পরে `image/webp` হেডারে সার্ভ হতো।
  if (!looksLikeWebp(thumb.buffer)) return 'not_webp';

  if (thumb.size > MAX_THUMB_BYTES) return 'too_large';

  /**
   * ⭐ থাম্বনেইল ফুল ছবির চেয়ে ছোট না হলে **পুরো ফিচারটাই উল্টো কাজ করে**:
   * গ্রিড একই বাইট নামাত, আর ডিস্কে দ্বিগুণ জায়গা যেত। এজেন্ট ভুল করে
   * একই বাফার দুবার জুড়ে দিলে ঠিক এটাই হতো — আর কোথাও কোনো এরর উঠত না।
   */
  if (fullSizeBytes > 0 && thumb.size >= fullSizeBytes) {
    return 'not_smaller_than_full';
  }

  return null;
}

/**
 * RIFF কন্টেইনারের মাথা: `R I F F <4 বাইট আকার> W E B P`।
 * পুরো ছবি ডিকোড করা হয় না — সে ক্ষমতা Node-এ নেই, আর দরকারও নেই।
 * এটুকুই "ভুল ফরম্যাট" ধরার জন্য যথেষ্ট।
 */
export function looksLikeWebp(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}
