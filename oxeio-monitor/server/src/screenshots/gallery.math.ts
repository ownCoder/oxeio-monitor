/**
 * E06 — গ্যালারির খাঁটি হিসাব: তারিখ পার্স করা আর পেজিনেশন।
 *
 * আলাদা ফাইলে, কারণ দুটোই এমন জায়গা যেখানে ভুল হলে কোনো এরর ওঠে না —
 * শুধু ভুল দিনের বা ভুল ঘরের ছবি দেখা যায়। DB ছাড়াই টেস্ট করা যায়।
 */

/**
 * এক পাতায় কতগুলো ছবি। ৫ মিনিট স্লট × ২টা মনিটর ধরলে একজনের পুরো
 * কর্মদিবস মোটামুটি দুই পাতায় আসে — গ্রিডে স্ক্রল করে দেখার মতো।
 */
export const GALLERY_PAGE_SIZE = 60;

/**
 * `YYYY-MM-DD` → ওই তারিখের **UTC-midnight**, কারণ `screenshots.work_date`
 * কলামটা `@db.Date` আর Prisma সেখানে ঠিক এটাই চায় (দেখুন
 * agent/util/dhaka-time.ts → workDateOf)।
 *
 * ⚠️ শুধু regex দিয়ে যাচাই করলে `2026-02-30` পাশ করে যেত, আর `Date.UTC`
 *    সেটাকে নীরবে ২ মার্চ বানিয়ে দিত — ব্যবহারকারী ফেব্রুয়ারির ছবি চেয়ে
 *    মার্চের ছবি পেত, কোনো এরর ছাড়াই। তাই ফেরত আসা তারিখটা আবার মিলিয়ে
 *    দেখা হয়।
 *
 * @returns অবৈধ হলে `null` (কলার সেটাকে ৪০০ বানায়)
 */
export function parseWorkDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

/** UTC-midnight তারিখ → `YYYY-MM-DD` (রেসপন্সে ফেরত পাঠানোর জন্য) */
export function formatWorkDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface PageSlice {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  totalPages: number;
}

/**
 * পাতার নম্বর → `skip`/`take`।
 *
 * ⚠️ পাতা **১ থেকে** গোনা হয় (URL-এ `page=0` কেউ লেখে না), কিন্তু `skip`
 *    ০ থেকে — এই এক ঘরের পার্থক্যেই প্রথম পাতার ছবিগুলো হারিয়ে যেতে পারত।
 *
 * ⚠️ ছবি না থাকলেও `totalPages` কমপক্ষে ১, নইলে ফ্রন্টএন্ডে "পাতা ১ / ০"
 *    দেখাত।
 */
export function pageSlice(
  page: number,
  total: number,
  pageSize: number = GALLERY_PAGE_SIZE,
): PageSlice {
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    page: safePage,
    pageSize,
    skip: (safePage - 1) * pageSize,
    take: pageSize,
    totalPages,
  };
}
