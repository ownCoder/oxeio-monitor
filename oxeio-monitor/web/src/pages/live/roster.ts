import type { LiveCard } from '../../api/dashboard';
import { isWorking } from './onTheClock';

/**
 * **রোস্টারের দুটো সিদ্ধান্ত** — ক্রম, আর মিটার কী বলছে।
 *
 * ⭐ আলাদা ফাইলে, কারণ দুটোই **নিয়ম**, বিন্যাস নয়। বিশেষ করে ক্রমটা:
 * এক সারিতে সাজানো ঘণ্টা নিজেই একটা র‌্যাঙ্কিং হয়ে উঠতে চায়, আর সেই
 * ঝোঁকটা ঠেকানো একটা **সচেতন** সিদ্ধান্ত — কোথাও `sort by hours` লিখে
 * ফেলা যাতে এক লাইনের ভুল না হয়, তাই নিয়মটা এখানে, টেস্টসহ।
 */

/**
 * আজকের মিটারটা কোন সত্যি বলছে।
 *
 * ⚠️⚠️ **শূন্য আর অজানা এক জিনিস নয়, আর পর্দায় এক দেখানো যাবে না।**
 * "আজ কিছু করেননি" (মাপা হয়েছে) আর "আমরা জানি না" (এজেন্টই বসেনি /
 * কখনো সাড়া দেয়নি) — দুটোকে একই খালি বার দিয়ে দেখালে দ্বিতীয়টা
 * নীরবে প্রথমটার অভিযোগ হয়ে যেত।
 */
export type MeterKind = 'counted' | 'zero' | 'unknown';

export function meterKind(card: LiveCard): MeterKind {
  // ⚠️ আগে অজানা, পরে শূন্য — ক্রমটা জরুরি। এজেন্ট না বসা কর্মীর
  //    `todayWorkedSec` ০-ই থাকে, আর শর্ত উল্টো হলে সে "শূন্য কাজ" বলে
  //    গোনা হতো, অথচ তাকে মাপাই হয়নি।
  if (card.agentPresence !== 'installed' || card.lastHeartbeatAt === null) {
    return 'unknown';
  }
  return card.todayWorkedSec > 0 ? 'counted' : 'zero';
}

/**
 * ⭐⭐ **সারির ক্রম — কখনো ঘণ্টা ধরে নয়।**
 *
 * কাজ করছেন যাঁরা আগে, তারপর যাঁরা করছেন না। ⚠️ প্রতিটি দলের **ভেতরে
 * সার্ভারের ক্রমই** অক্ষত থাকে (`empCode` ascending, dashboard.service),
 * অর্থাৎ ক্রমটা নিরপেক্ষ।
 *
 * ⚠️⚠️ ঘণ্টা ধরে সাজালে পাতাটা রোজ সকালে একটা **লিডারবোর্ড** হয়ে উঠত —
 * আর ঠিক সেটাই এই পণ্য করে না (README-র "কখনোই নয়")। ভাগটা `splitBoard`
 * থেকে না নিয়ে এখানে আবার লেখা হয়নি: `isWorking` একটাই জায়গায় থাকুক,
 * নইলে ট্যাবের সংখ্যা আর সারির ক্রম একদিন দ্বিমত করত (G88-এর শিক্ষা)।
 */
export function rosterRows(cards: readonly LiveCard[]): LiveCard[] {
  const working: LiveCard[] = [];
  const resting: LiveCard[] = [];

  for (const card of cards) {
    (isWorking(card.status) ? working : resting).push(card);
  }

  return [...working, ...resting];
}

/**
 * প্রথম "কাজ করছেন না" সারিটা কোথায় — ওখানেই দলছুট ব্যান্ডটা বসবে।
 * কেউ না থাকলে `-1`, আর তখন ব্যান্ডটাই আঁকা হয় না।
 */
export function restingStartsAt(rows: readonly LiveCard[]): number {
  return rows.findIndex((c) => !isWorking(c.status));
}

export interface DesignView {
  done: number;
  /** ⚠️ `null` = **এই কর্মীর কোনো ডিজাইন-টার্গেট নেই** — শূন্য টার্গেট নয় */
  target: number | null;
  /** টার্গেট না থাকলে সবসময় `false` — "ব্যর্থ" নয়, "প্রযোজ্য নয়" */
  met: boolean;
}

/**
 * ⭐⭐ **আজকের ডিজাইন — তিনটে অবস্থা, দুটো নয়** *(মালিকের বাছাই, ২২ আগস্ট)*।
 *
 * | কে | কী দেখায় |
 * |---|---|
 * | ডিজাইনার, টার্গেট আছে | `24 / 25` |
 * | অন্য কেউ, তবু ডিজাইন করেছেন | শুধু `43` |
 * | কেউ ডিজাইন করেননি | কিছুই না |
 *
 * ⚠️⚠️ মাঝের সারিটাই সিদ্ধান্ত: ম্যানেজার (OX-01) নিজেও ডিজাইন করেন —
 * তিন দিনে **৪৩টা**। ধরন `manager` বসানোর পর সংখ্যাটা সব পর্দা থেকে
 * উধাও হয়ে যাচ্ছিল, অথচ কাজটা সত্যি। ⭐ "কত হলো" আর "টার্গেট ছুঁল কি
 * না" — দুটো আলাদা প্রশ্ন হিসেবেই থাকল।
 *
 * ⚠️ **সার্ভারের `design.rules.ts`-এর হুবহু নকল।** দুই জায়গায় দু-রকম
 * হলে টেলিগ্রাম এক কথা বলত আর পর্দা অন্য — আর ঠিক ওই ফাঁদটা এই
 * প্রকল্পে আগে পড়া হয়েছে (`fleet.ts`-এর `compareVersion`-এর নোট)।
 */
export function designView(card: LiveCard): DesignView | null {
  const done = card.designsDone;

  if (card.staffType === 'designer' && card.designTargetPerDay > 0) {
    return { done, target: card.designTargetPerDay, met: done >= card.designTargetPerDay };
  }

  return done > 0 ? { done, target: null, met: false } : null;
}
