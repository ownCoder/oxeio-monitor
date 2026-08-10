/**
 * **B05b** — tray-র "এগিয়ে / পিছিয়ে" সংখ্যাটার খাঁটি অংশ (§ ২.১-খ)।
 *
 * ⭐ আলাদা ফাইলে, কারণ `ProgressService` প্রতিটি heartbeat-এ চলে — অর্থাৎ
 * ১৫টা PC × ৩০ সেকেন্ড = দিনে ~২১,৬০০ বার। এই সূত্রটা ভুল হলে ভুলটা
 * সবার tray-তে সারাদিন জ্বলজ্বল করত, অথচ ধরার একমাত্র উপায় হতো DB ভরে
 * heartbeat পাঠানো। এখানে থাকায় DB ছাড়াই পরীক্ষা করা যায়।
 *
 * ⚠️ `summary.math.ts`-এর `rollupMonth()` ইচ্ছাকৃতভাবে **ব্যবহার করা হয়নি**,
 * যদিও সূত্র একই। ওটা `targetSec <= 0` পেলে `RangeError` ছোড়ে — মাসিক
 * rollup-এ সেটাই ঠিক (জোরে ভাঙা ভালো), কিন্তু heartbeat-এর পথে একটা
 * ভুল কনফিগ করা work policy তখন ওই কর্মীর **প্রতিটা** heartbeat-কে ৫০০
 * বানিয়ে দিত — অর্থাৎ একটা ভুল সংখ্যার শাস্তি হতো পুরো ট্র্যাকিং বন্ধ।
 * এখানে তাই ছোড়া হয় না, `0` ধরে নেওয়া হয়।
 */

export interface PaceInput {
  /** worked + owner-এর সংশোধন (§ ২.১-ঙ) — ঋণাত্মক হলে ০ ধরা হয় */
  creditedSec: number;
  /** work policy থেকে, হার্ডকোড ২০৮ নয় */
  monthlyTargetHours: number;
  /** পুরো মাসে কত কর্মদিবস (সাপ্তাহিক ছুটি ও `holidays` বাদে) */
  expectedWorkdays: number;
  /** মাসের ১ তারিখ থেকে **আজ ধরে** কত কর্মদিবস পেরিয়েছে */
  workdaysElapsed: number;
}

/**
 * আজ পর্যন্ত কত সেকেন্ড হওয়ার কথা ছিল।
 *
 * ⚠️ `expectedWorkdays === 0` হলে ০ — পুরো মাস ছুটি ঘোষণা করলে সেটা সম্ভব।
 * না আটকালে `NaN` তারে চলে যেত, আর এজেন্টের `System.Text.Json` `NaN`
 * চেনে না — গোটা heartbeat-এর উত্তরটাই (revoke কমান্ড সহ) পড়া যেত না।
 */
export function expectedSecOf(input: PaceInput): number {
  const { monthlyTargetHours, expectedWorkdays, workdaysElapsed } = input;

  if (!Number.isFinite(monthlyTargetHours) || monthlyTargetHours <= 0) return 0;
  if (!Number.isFinite(expectedWorkdays) || expectedWorkdays <= 0) return 0;

  // ⚠️ ০ ও `expectedWorkdays`-এর মধ্যে আটকানো। আজকের তারিখ থেকেই মাসের
  //    সীমা বের করা হয় বলে বাস্তবে ছাড়ানোর কথা নয়, কিন্তু ভবিষ্যতে কেউ
  //    পুরোনো তারিখ দিয়ে ডাকলে প্রত্যাশা টার্গেট ছাড়িয়ে যেত — তখন সবাই
  //    "পিছিয়ে" দেখাত।
  const elapsed = Math.min(Math.max(workdaysElapsed, 0), expectedWorkdays);

  return Math.round((monthlyTargetHours * 3600 * elapsed) / expectedWorkdays);
}

/**
 * `credited − expected`; ধনাত্মক = এগিয়ে, ঋণাত্মক = পিছিয়ে।
 *
 * ⚠️ `credited` ০-তে আটকানো — `payroll.math.ts`-এর মতোই কারণে। একজনের
 * বড় কর্তন `credited`-কে ঋণাত্মক করে ফেললে tray দেখাত "−৩১২ ঘণ্টা
 * পিছিয়ে", যা কারো কাছেই কোনো অর্থ বহন করে না।
 */
export function paceSecOf(input: PaceInput): number {
  return Math.max(0, input.creditedSec) - expectedSecOf(input);
}
