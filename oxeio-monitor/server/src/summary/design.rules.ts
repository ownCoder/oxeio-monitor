/**
 * **দৈনিক ডিজাইনের হিসাব** *(২১ আগস্ট ২০২৬)* — খাঁটি নিয়ম, কোনো I/O নেই।
 *
 * ⚠️⚠️ **কেন এটা আদৌ সম্ভব হলো।** oXeio সময় মাপে, উৎপাদন নয় — তাই মালিকের
 * প্রশ্ন *"২৫টা ডিজাইনের টার্গেট কীভাবে ট্র্যাক করব?"*-র উত্তর হওয়ার কথা
 * ছিল "নতুন কিছু বানাতে হবে"। কিন্তু মাঠের ডেটা দেখে বেরোল উত্তরটা
 * **ইতিমধ্যেই জমা হচ্ছে**: এজেন্ট জানালার শিরোনাম রাখে, আর ডিজাইনারদের
 * ফাইলের নাম শুরু হয় কাজের নম্বর দিয়ে —
 *
 * ```
 * 37933-Woodcock Bird Vintage Illustration T-Shirt.ai @ 54 % (RGB/Preview)
 * ```
 *
 * ⭐ অর্থাৎ নতুন এজেন্ট নয়, স্টাফের বাড়তি কোনো কাজ নয়, কোনো বোতাম নয় —
 * শুধু যা আছে তা পড়া।
 *
 * ⚠️⚠️ **মালিকের শর্ত (২১ আগস্ট):** শিরোনাম পড়া যাবে, কিন্তু **কেবল
 * ডিজাইন-অ্যাপের**, আর **কেবল সামনের নম্বরটা** — ডিজাইনের নাম কোথাও জমা
 * হবে না, পর্দায়ও যাবে না। এই ফাইলের কোনো ফাংশন নাম ফেরত দেয় না, আর
 * সেটা দুর্ঘটনা নয়।
 */

/**
 * ⭐ কেবল এই অ্যাপগুলোর শিরোনাম দেখা হয়।
 *
 * ⚠️⚠️ শ্বেততালিকা, কালোতালিকা নয় — নতুন কোনো অ্যাপ এলে সে **নিজে থেকে
 * পড়ার আওতায় আসবে না**। উল্টো করলে একদিন কারো ব্রাউজার বা চ্যাটের
 * শিরোনাম চুপচাপ এই হিসাবে ঢুকে পড়ত, আর সেটা ঠিক সেই কনটেন্ট-পড়া যা
 * README-তে "কখনোই নয়" বলা।
 */
export const DESIGN_APPS = ['illustrator.exe', 'photoshop.exe'] as const;

/**
 * ⚠️ ৩–৬ অঙ্ক। ⭐ **দুইয়ের কম নয়** ইচ্ছাকৃতভাবে: মাঠে `4 [Converted].eps`
 * ধাঁচের ফাইল আছে, আর ওগুলো কাজের নম্বর নয়। ⚠️ ছয়ের বেশিও নয় — লম্বা
 * সংখ্যা সাধারণত তারিখ বা স্টক-আইডি (`..._202608201646_upscayl_4x`)।
 */
const DESIGN_ID = /^(\d{3,6})/;

/**
 * শিরোনাম থেকে ডিজাইনের নম্বর — না পেলে `null`।
 *
 * ⚠️ `Untitled-1*`, `Template.ai`, স্টক ফাইল আর `.psd` স্তর-ফাইলগুলো
 * এমনিতেই বাদ পড়ে, কারণ ওরা অঙ্ক দিয়ে শুরু হয় না। ⭐ মাঠে মেপে দেখা
 * গেছে ডিজাইন-অ্যাপের সময়ের **~৪৭%** নম্বরওয়ালা ফাইলে, বাকিটা
 * প্রস্তুতির কাজ (আপস্কেল, স্টক, টেমপ্লেট) — অর্থাৎ নম্বরওয়ালা ফাইলই
 * চূড়ান্ত ডিজাইন।
 *
 * ⚠️ **জানা মিথ্যা-ইতিবাচক:** `2026 Calendar Design.ai` ধাঁচের নাম বছরটাকে
 * নম্বর ধরে নেবে। ব্যবসার নম্বরগুলো পাঁচ অঙ্কের (৩৭৯৩৩) বলে এটা বিরল,
 * তবু সংখ্যা হঠাৎ বাড়লে এই দিকটা আগে দেখবেন।
 */
export function designIdOf(
  processName: string,
  windowTitle: string | null | undefined,
): string | null {
  if (!DESIGN_APPS.includes(processName.toLowerCase() as never)) return null;
  if (windowTitle == null) return null;

  const match = DESIGN_ID.exec(windowTitle.trim());

  return match === null ? null : match[1];
}

/**
 * একদিনের সব শিরোনাম থেকে **অনন্য** ডিজাইন-নম্বরের সেট।
 *
 * ⚠️ একই ডিজাইনে সারাদিনে বহুবার ফেরা হয় (মাঠে ৩৮৭৩টা সারিতে ১৫৫৩টা
 * আলাদা শিরোনাম), তাই সারি গুনলে সংখ্যাটা অর্থহীন হতো।
 */
export function designIdsInDay(
  rows: readonly { processName: string; windowTitle: string | null }[],
): Set<string> {
  const ids = new Set<string>();

  for (const row of rows) {
    const id = designIdOf(row.processName, row.windowTitle);
    if (id !== null) ids.add(id);
  }

  return ids;
}

/**
 * ⭐⭐ **টার্গেট কেবল ডিজাইনারের।**
 *
 * ⚠️⚠️ `null` ধরন মানে "এখনো বসানো হয়নি" — তাকে **ছেড়ে দেওয়া হয়**, শূন্য
 * ধরা হয় না। নইলে ধরন বসানোর আগ পর্যন্ত প্রত্যেকে রোজ "০/২৫" হয়ে
 * তালিকায় উঠত, আর সেটা একটা অভিযোগ, তথ্য নয়।
 */
export function hasDesignTarget(staffType: string | null | undefined): boolean {
  return staffType === 'designer';
}

/** পর্দায় দেখানোর মতো — টার্গেট না থাকলে `null`, শূন্য নয় */
export function designProgress(
  staffType: string | null | undefined,
  done: number,
  target: number,
): { done: number; target: number; met: boolean } | null {
  if (!hasDesignTarget(staffType) || target <= 0) return null;

  return { done, target, met: done >= target };
}
