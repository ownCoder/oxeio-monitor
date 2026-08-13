import type { LiveCard, LiveStatus } from '../../api/dashboard';

/**
 * বোর্ড দুই ভাগে — **এখন কাজ করছেন** আর **করছেন না**।
 *
 * ⭐ **কেন আলাদা ফাইল:** ভাগটা এক লাইনের `filter`, কিন্তু ভুলটা এক লাইনের
 * নয়। উপরের "Working now" টাইল আর ট্যাবের সংখ্যা **আলাদা জায়গায় গোনা
 * হলে** একদিন তারা আলাদা হয়ে যেত — আর বোর্ড আবার নিজেই নিজেকে মিথ্যা
 * প্রমাণ করত, ঠিক যেমন G88-এ করেছিল (উপরে ১৬:৫০-এর ছবি, নিচে "কখনো
 * সাড়া দেয়নি")।
 *
 * ⚠️⚠️ আর আসল ঝুঁকিটা **ভাগ হারিয়ে যাওয়া**: দ্বিতীয় ট্যাবটা যদি কেউ
 * `status === 'idle'` লিখে বানাত, তাহলে `offline` আর `agent_down` কার্ডগুলো
 * **কোনো ট্যাবেই থাকত না** — বোর্ড থেকে মানুষ নীরবে উধাও। তাই "না-কাজ"
 * তালিকাটা গোনা হয় **বাদ দিয়ে**, বেছে নিয়ে নয়।
 */

/**
 * ⚠️ শুধু `active` = কাজ করছেন। `idle` মানে PC চালু, কিন্তু হাত থেমে আছে —
 * আর সেটা কাজ নয়। দুটো এক করে ফেললে বোর্ডের সংখ্যা মালিকের চোখের সামনেই
 * ফুলে উঠত, অথচ কেউ বেশি কাজ করেনি।
 */
export function isWorking(status: LiveStatus): boolean {
  return status === 'active';
}

export interface BoardSplit {
  working: LiveCard[];
  resting: LiveCard[];
}

/**
 * ⚠️ প্রতিটি কার্ড **ঠিক একটি** তালিকায় পড়ে — বাদ পড়ে না, দুবারও আসে না।
 * নতুন কোনো `LiveStatus` যোগ হলেও সে আপনাআপনি "না-কাজ" দলে চলে যাবে,
 * কারণ শর্তটা বাদ দিয়ে লেখা।
 */
export function splitBoard(cards: readonly LiveCard[]): BoardSplit {
  const working: LiveCard[] = [];
  const resting: LiveCard[] = [];

  for (const card of cards) {
    if (isWorking(card.status)) working.push(card);
    else resting.push(card);
  }

  return { working, resting };
}
