import {
  getLatestShotPerEmployee,
  type GalleryItem,
} from '../../api/screenshots';

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
  /**
   * কতজনের ছবি পাওয়া গেল *(৬ সেপ্টেম্বর ২০২৬-এ মানে বদলেছে)*।
   *
   * ⚠️ আগে এটা ছিল **দিনের মোট ছবি**, কারণ সংখ্যাটা আসত গ্যালারির
   *    `total` থেকে। এখন প্রশ্নটাই আলাদা — সার্ভার কর্মীপ্রতি একটাই সারি
   *    দেয় — তাই এটা এখন *কতজনের ছবি আছে*। ⭐ পর্দায় ব্যবহার হয় কেবল
   *    `byEmployee.size > 0` অর্থে, তাই কোথাও ভুল সংখ্যা দেখায় না।
   */
  total: number;
  /** employeeId → তার সবচেয়ে নতুন ছবি। না থাকলে কী নেই। */
  byEmployee: Map<number, GalleryItem>;
}

/** কিছু আনা হয়নি — role=employee হলে কল না করেই এটা ফেরত যায় */
export const NO_SHOTS: LatestShots = { date: '', total: 0, byEmployee: new Map() };

/**
 * ⭐ ঢাকার আজকের দিনের সর্বশেষ ছবিগুলো — কর্মীপ্রতি একটি।
 *
 * ⚠️ `date` ইচ্ছাকৃতভাবে পাঠানো হয় না: সার্ভার নিজেই ঢাকার কর্মদিবস ধরে
 *    (`workDateOf`)। ব্রাউজার থেকে তারিখ পাঠালে মধ্যরাতের পর দুই পাশে দুই
 *    দিন ধরা পড়ত, আর কার্ডে গতকালের ছবি আটকে থাকত।
 */
export async function getLatestShots(signal?: AbortSignal): Promise<LatestShots> {
  const res = await getLatestShotPerEmployee(signal);

  const byEmployee = new Map<number, GalleryItem>();
  for (const item of res.items) byEmployee.set(item.employeeId, item);

  return { date: res.date, total: byEmployee.size, byEmployee };
}
