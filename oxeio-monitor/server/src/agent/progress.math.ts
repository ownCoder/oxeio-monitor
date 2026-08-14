/**
 * **B05b** — tray-র "এগিয়ে / পিছিয়ে" সংখ্যাটার খাঁটি অংশ (§ ২.১-খ)।
 *
 * ⭐ আলাদা ফাইলে, কারণ `ProgressService` প্রতিটি heartbeat-এ চলে — অর্থাৎ
 * ১৫টা PC × ৩০ সেকেন্ড = দিনে ~২১,৬০০ বার। এই সূত্রটা ভুল হলে ভুলটা
 * সবার tray-তে সারাদিন জ্বলজ্বল করত, অথচ ধরার একমাত্র উপায় হতো DB ভরে
 * heartbeat পাঠানো। এখানে থাকায় DB ছাড়াই পরীক্ষা করা যায়।
 *
 * ⭐⭐ **সূত্রটা এখন এই ফাইলের নিজের নয়** — `summary.math.ts`-এর
 * `proratedExpectedSec()`। আগে এখানে হুবহু একই গণিত হাতে লেখা ছিল, আর
 * সেটাই ছিল আসল ঝুঁকি: মাসিক rollup-এর সূত্র বদলালে tray চুপচাপ পুরোনো
 * উত্তর দিতেই থাকত, আর কর্মী নিজের tray-তে যা দেখেন owner ড্যাশবোর্ডে তার
 * চেয়ে আলাদা সংখ্যা দেখতেন। এই ফাইল এখন শুধু **heartbeat-এর নিরাপত্তা**
 * যোগ করে (নিচের নোট), গণিত নয়।
 */

import { proratedExpectedSec } from '../summary/summary.math';

const SEC_PER_HOUR = 3600;

export interface PaceInput {
  /** worked + owner-এর সংশোধন (§ ২.১-ঙ) — ঋণাত্মক হলে ০ ধরা হয় */
  creditedSec: number;
  /** work policy থেকে, হার্ডকোড ২০৮ নয় (⭐ G37-এর পর **তার prorated** টার্গেট) */
  monthlyTargetHours: number;
  /** পুরো মাসে **তার** কত কর্মদিবস (সাপ্তাহিক ছুটি ও `holidays` বাদে) */
  expectedWorkdays: number;
  /**
   * কত কর্মদিবস **শেষ হয়ে গেছে** — `summary.math.ts`-এর `elapsedWorkdays()`
   * থেকেই আসতে হবে।
   *
   * ⚠️ "মাসের ১ তারিখ থেকে **আজ ধরে**" **নয়** — এখানে আগে তাই লেখা ছিল,
   * আর `ProgressService` সত্যিই তাই গুনত। দুটো ভুল ওতে ছিল:
   *   ১· আজকের দিনটা প্রত্যাশায় ধরা হতো, তাই ভোরবেলা tray "পিছিয়ে"
   *      দেখাত আর সন্ধ্যায় নিজে থেকেই ঠিক হয়ে যেত।
   *   ২· ট্র্যাকিং শুরুর আগের দিনগুলোও গোনা হতো, তাই এজেন্ট বসার আগের
   *      না-দেখা দিনগুলো কর্মীর ঘাটতি হয়ে দাঁড়াত।
   * ফলে tray আর Monthly পাতা ~৮৯ ঘণ্টা আলাদা বলত।
   */
  workdaysElapsed: number;
}

/**
 * আজ পর্যন্ত কত সেকেন্ড হওয়ার কথা ছিল।
 *
 * ⚠️ `summary.math.ts`-এর `rollupMonth()` ইচ্ছাকৃতভাবে ডাকা হয় না, যদিও
 * expected-এর সূত্র এক। ওটা `targetSec <= 0` পেলে `RangeError` ছোড়ে —
 * মাসিক rollup-এ সেটাই ঠিক (জোরে ভাঙা ভালো), কিন্তু heartbeat-এর পথে একটা
 * ভুল কনফিগ করা work policy তখন ওই কর্মীর **প্রতিটা** heartbeat-কে ৫০০
 * বানিয়ে দিত — অর্থাৎ একটা ভুল সংখ্যার শাস্তি হতো পুরো ট্র্যাকিং বন্ধ।
 * তাই শুধু সংখ্যাটুকু (`proratedExpectedSec`) নেওয়া হয়, যেটা ছোড়ে না।
 */
export function expectedSecOf(input: PaceInput): number {
  return proratedExpectedSec({
    targetSec: input.monthlyTargetHours * SEC_PER_HOUR,
    expectedWorkdays: input.expectedWorkdays,
    workdaysElapsed: input.workdaysElapsed,
  });
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
