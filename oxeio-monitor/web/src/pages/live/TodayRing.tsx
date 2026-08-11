import { ProgressRing } from '../../components/ProgressRing';
import { formatDuration, formatHours } from '../../lib/format';

/**
 * E01/E02 — **আজকের** টার্গেটের রিং (`todayWorkedSec / dailyTargetSec`)।
 *
 * ⭐ এটা এখন শেয়ার্ড `components/ProgressRing`-এর **পাতলা মোড়ক**, নিজের
 *    আলাদা SVG নয়।
 *
 *    আগে এখানে গোটা রিংটা আবার লেখা ছিল, দুটো কারণে: (১) `ProgressRing`-এর
 *    doc-এ লেখা ছিল "রিংটা মাসিক, দৈনিক নয়", আর (২) ওর `aria-label`-এ
 *    "মাসিক অগ্রগতি" হার্ডকোড ছিল — স্ক্রিন রিডারে আজকের রিংটা "মাসিক" বলে
 *    পরিচয় দিত। **দুটোই এখন নেই**: ওটা `ariaLabel` প্রপ নিয়েছে আর doc-ও
 *    সংশোধন হয়েছে, তাই কারণ দুটো উঠে গেছে।
 *
 * ⚠️ নকলটা রেখে দেওয়া যেত, কিন্তু তাতে জ্যামিতি ও রঙের নিয়ম **দুই জায়গায়**
 *    থাকত। ঠিক সেটাই একবার ঘটেছিল: রঙের নিয়ম বদলানোর পর লাইভ বোর্ডের রিং
 *    পুরোনো নিয়মেই রয়ে গিয়েছিল, আর একই ড্যাশবোর্ডে দুই রকম রিং দাঁড়িয়ে
 *    গিয়েছিল। এক জায়গায় রাখলে ওটা আর সম্ভব নয়।
 */
export function TodayRing({
  workedSec,
  targetSec,
  size = 46,
}: {
  workedSec: number;
  /** ⚠️ **সার্ভারের `dailyTargetSec`** — ৮ ঘণ্টা হার্ডকোড নয় */
  targetSec: number;
  size?: number;
}) {
  return (
    <ProgressRing
      value={workedSec}
      max={targetSec}
      size={size}
      ariaLabel="Today's target"
    />
  );
}

/**
 * রিংয়ের নিচের `of 8h` — **সার্ভারের `dailyTargetSec` থেকে**।
 *
 * ⭐ পুরো ঘণ্টা হলে `8h`, নইলে শেয়ার্ড `formatDuration` (`7h 42m`)।
 *    সরাসরি `formatDuration` লিখলে আগস্টে `8h 0m` বসত — ওই শূন্য মিনিটটা
 *    প্রতিদিন প্রতিটা কার্ডে চোখে লাগত, অথচ কিছুই বলত না।
 *
 * ⚠️ `formatHours(sec, 0)` এখানে **শুধু পুরো ঘণ্টার শাখায়** — round করে
 *    বলে ২৭ কর্মদিবসের মাসে ৭ঘ ৪২মি-কে সে "8" বানিয়ে দিত, আর টার্গেট
 *    নীরবে ভুল দেখাত। ভগ্নাংশ থাকলে তাই `formatDuration`।
 *
 * ⚠️ শেয়ার্ড `format.ts`-এ `formatDurationShort()` যোগ হলে এটা মুছে
 *    দেওয়াই ভালো — সময়ের লেখা এক জায়গাতেই থাকা উচিত।
 */
export function targetText(targetSec: number): string {
  return targetSec % 3600 === 0
    ? `${formatHours(targetSec, 0)}h`
    : formatDuration(targetSec);
}

/**
 * রিংয়ের জায়গায় ছুটির চিহ্ন — `todayIsWorkday === false` হলে।
 *
 * ⚠️ লেখাটা কেন "Weekly off"/"Holiday" নয়: `GET /live` শুধু
 *    `todayIsWorkday` (bool) পাঠায়, **কারণটা নয়**। শুক্রবারের সাপ্তাহিক
 *    ছুটিকে "Holiday" বা ২১শে ফেব্রুয়ারিকে "Weekly off" লিখলে অর্ধেক
 *    ক্ষেত্রেই ভুল শব্দ বসত — আর ভুল শব্দ কেউ ধরতেও পারত না। সার্ভার
 *    `'weekly_off' | 'holiday'` পাঠাতে শুরু করলে (রিপোর্টে `DayType`
 *    আগে থেকেই আছে) এখানে ঠিক শব্দটাই বসবে।
 *
 * ⚠️ ছুটি মানে "কাজ নিষিদ্ধ" নয় — তাই কার্ডে আজকের ঘণ্টা তবু দেখানো হয়,
 *    শুধু টার্গেটের তুলনাটা থাকে না।
 */
export function DayOffTag() {
  return (
    <span
      title="Weekly off or holiday — nothing is expected today"
      className="flex-none rounded-full border border-line bg-paper px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-ink-3"
    >
      Day off
    </span>
  );
}
