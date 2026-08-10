import { getGallery, type GalleryItem, type GalleryPage } from '../../api/screenshots';

/**
 * E03 — লাইভ বোর্ডের প্রতিটি কার্ডে **সর্বশেষ** স্ক্রিনশট বসানোর জন্য
 * গ্যালারি থেকে কর্মীপ্রতি একটি করে সবচেয়ে নতুন ছবি বের করা।
 *
 * ⭐⚠️ "প্রতিটা কার্ডের জন্য `?employeeId=` দিয়ে একটা করে কল" — এই সোজা
 *    পথটাই এখানে সবচেয়ে বড় ফাঁদ, দুটো কারণে:
 *
 *    ১· `GET /screenshots` প্রতিটি কলে **একটি audit সারি লেখে** (I08 —
 *       "কে আমার স্ক্রিনশট দেখল")। ১৫ জনের বোর্ড মানে প্রতি রিফ্রেশে ১৫টা
 *       সারি। স্টাফের কাছে পুরো সিস্টেমটার বিশ্বাসযোগ্যতা ওই সারিগুলোর
 *       উপরে দাঁড়ানো — সেগুলো আবর্জনায় ভরে গেলে E11-এর ভিউয়ারে আসল
 *       ঘটনাগুলো আর খুঁজেই পাওয়া যেত না।
 *    ২· ছবি জমা হয় **৫ মিনিট পরপর**। ৩০ সেকেন্ডে ডাকলে ৯ বারের মধ্যে
 *       ৮ বারই হুবহু একই ছবি ফেরত আসত।
 *
 *    তাই: **ফিল্টার ছাড়া একটাই কল** সবার জন্য, আর সেটা বোর্ডের চেয়ে
 *    অনেক ধীরে (LiveBoardPage-এর `SHOT_REFRESH_MS`)।
 */

export interface LatestShots {
  /** কোন কর্মদিবসের ছবি — সার্ভার ঢাকার আজকের দিন নিজেই ঠিক করে */
  date: string;
  /** ওই দিনে মোট কতগুলো ছবি জমেছে */
  total: number;
  /** employeeId → তার সবচেয়ে নতুন ছবি। না থাকলে কী নেই। */
  byEmployee: Map<number, GalleryItem>;
}

/** কিছু আনা হয়নি — role=employee হলে কল না করেই এটা ফেরত যায় */
export const NO_SHOTS: LatestShots = { date: '', total: 0, byEmployee: new Map() };

/**
 * ⭐ শেষ পাতাটা কোথায় জানতে হলে আগে `totalPages` জানা দরকার — কিন্তু সেটা
 *    জানতে গিয়ে যেন কারো নামে মিথ্যা অডিট সারি না লেখা হয়।
 *
 *    তাই ইচ্ছে করে **ডেটার বাইরের** একটা পাতা চাওয়া হয়: সারি ফেরত আসে না,
 *    আর সার্ভার খালি পাতায় **audit লেখে না** (`recordView`-এর প্রথম লাইন)।
 *    রেসপন্সে `total` ও `totalPages` তবু পুরোপুরি ঠিক থাকে।
 *
 *    সরাসরি ১ নম্বর পাতা চেয়েও `totalPages` পাওয়া যেত, কিন্তু তাতে দিনের
 *    **সবচেয়ে পুরোনো** ৬০টা ছবি "দেখা হয়েছে" বলে অডিটে উঠত — অথচ ওগুলো
 *    পর্দায় কখনো আসতই না। কোনো সারি না থাকার চেয়ে মিথ্যা সারি খারাপ।
 *
 * ২০০ পাতা = ১২,০০০ ছবি। ১৫ জন × ২ মনিটর × ৫ মিনিটের ২৮৮টা স্লট = দিনে
 * বড়জোর ~৮,৬০০ — অর্থাৎ এটা সবসময়ই ডেটার বাইরে।
 *
 * ⚠️ DTO-তে সীমা ১০,০০০ (`@Max`), কিন্তু সেই সীমা ছোঁয়ার দরকার নেই: বড়
 *    OFFSET ঠেকাতেই সীমাটা বসানো হয়েছে, আর আমাদের দরকার শুধু "ডেটার
 *    বাইরে" — যত ছোট, তত ভালো।
 */
const PROBE_PAGE = 200;

/** ⚠️ `GalleryQueryDto`-র `@Max(10_000)` — এর বেশি চাইলে সোজা ৪০০ */
const MAX_PAGE = 10_000;

/**
 * শেষ পাতায় এর চেয়ে কম ছবি থাকলে আগের পাতাটাও আনা হয়।
 *
 * ⚠️ পাতা ৬০টা করে, আর ক্রম **ascending** — তাই সবচেয়ে নতুন ছবিগুলো শেষ
 *    পাতায়। কিন্তু মোট ৬১টা ছবি হলে শেষ পাতায় মাত্র ১টা থাকে, আর তখন
 *    ১৫ জনের মধ্যে ১ জনের কার্ডেই ছবি দেখা যেত। সীমানা পেরোনোর ঠিক পরের
 *    কয়েক মিনিট বোর্ডটা ভাঙা দেখাত, অথচ কিছুই ভাঙেনি।
 */
const THIN_PAGE = 30;

/**
 * ⭐ ঢাকার আজকের দিনের সর্বশেষ ছবিগুলো — কর্মীপ্রতি একটি।
 *
 * ⚠️ `date` ইচ্ছাকৃতভাবে পাঠানো হয় না: সার্ভার নিজেই ঢাকার কর্মদিবস ধরে
 *    (`workDateOf`)। ব্রাউজার থেকে তারিখ পাঠালে মধ্যরাতের পর দুই পাশে দুই
 *    দিন ধরা পড়ত, আর কার্ডে গতকালের ছবি আটকে থাকত।
 */
export async function getLatestShots(signal?: AbortSignal): Promise<LatestShots> {
  const probe = await getGallery({ page: PROBE_PAGE }, signal);

  if (probe.total === 0) {
    return { date: probe.date, total: 0, byEmployee: new Map() };
  }

  // ⚠️ `Math.min` শুধু রক্ষাকবচ: totalPages ১০,০০০ ছাড়ালে (এক দিনে ৬ লাখ
  //    ছবি — বাস্তবে অসম্ভব) সীমার বাইরের পাতা চাইলে ৪০০ আসত।
  const lastPage = Math.min(probe.totalPages, MAX_PAGE);
  const onLastPage = probe.total - (lastPage - 1) * probe.pageSize;

  const wanted =
    lastPage > 1 && onLastPage < THIN_PAGE ? [lastPage - 1, lastPage] : [lastPage];

  const pages = await Promise.all(
    wanted.map((page) => getGallery({ page }, signal)),
  );

  return {
    date: probe.date,
    total: probe.total,
    byEmployee: newestPerEmployee(pages),
  };
}

/**
 * ⚠️ তুলনাটা স্ট্রিং হিসেবেই করা হয়। `capturedAt` সার্ভারে
 *    `toISOString()` দিয়ে বানানো — সবসময় একই দৈর্ঘ্য, সবসময় `Z`-এ শেষ।
 *    এমন স্ট্রিংয়ে বর্ণানুক্রম আর কালক্রম এক। `new Date()` বানালে
 *    কর্মীপ্রতি একাধিক অবজেক্ট তৈরি হতো, কোনো লাভ ছাড়াই।
 */
function newestPerEmployee(pages: GalleryPage[]): Map<number, GalleryItem> {
  const latest = new Map<number, GalleryItem>();

  for (const page of pages) {
    for (const item of page.items) {
      const known = latest.get(item.employeeId);
      if (!known || item.capturedAt > known.capturedAt) {
        latest.set(item.employeeId, item);
      }
    }
  }

  return latest;
}
