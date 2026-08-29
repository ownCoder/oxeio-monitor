/**
 * **একসাথে অনেকগুলো লিঙ্ক নতুন ট্যাবে** *(২৯ আগস্ট ২০২৬, মালিকের চাওয়া:
 * "30 design gula ek sathe open korar ekta button")*।
 *
 * ⚠️⚠️ **ব্রাউজার দ্বিতীয় ট্যাব থেকেই বাধা দেয়, আর এটাই এই ফাইলের গোটা
 * কারণ।** এক চাপে একাধিক `window.open()` মানে ব্রাউজারের চোখে পপ-আপ:
 * Chrome প্রথমটা খোলে, বাকি ২৯টা আটকায় আর ঠিকানা-বারে ছোট একটা আইকন
 * বসিয়ে চুপ করে থাকে। ⭐ তাই "খুলে দিলাম" বলে কাজ শেষ করা যায় না —
 * **কতগুলো সত্যিই খুলল** সেটা গুনতে হয়, নইলে ডিজাইনার একটা ট্যাব দেখে
 * ভাবতেন বোতামটা ভাঙা, আর বাকি ২৯টা কোথায় গেল কেউ বলত না।
 *
 * ⚠️ **`'noopener'` ইচ্ছাকৃতভাবে বাদ, তার বদলে হাতে `opener = null`।**
 * `window.open(url, '_blank', 'noopener')` দিলে নিরাপত্তা একই থাকত,
 * কিন্তু তখন ফেরত মান **সবসময় `null`** — অর্থাৎ আটকানো আর খোলা ট্যাব
 * আলাদা করার উপায়ই থাকত না, আর উপরের গোনাটাই অসম্ভব হতো।
 */

/**
 * ⚠️ `Window` নয়, শুধু যেটুকু দরকার — তাতে টেস্টে jsdom ছাড়াই নকল
 * ট্যাব বানানো যায় (`vitest.config.ts`-এ `environment: 'node'`)।
 */
export interface OpenedTab {
  opener: unknown;
}

export type TabOpener = (url: string) => OpenedTab | null;

export interface OpenTabsResult {
  opened: number;
  blocked: number;
}

/**
 * ⭐ প্রতিটা URL আলাদা ট্যাবে, আর ফেরত আসে **কী ঘটল** — কতগুলো খুলল,
 * কতগুলো ব্রাউজার আটকাল।
 *
 * ⚠️ আটকে গেলেও লুপ থামে না। Chrome প্রথমটা খুলে বাকিগুলো আটকায়, কিন্তু
 * সব ব্রাউজার এক নিয়মে চলে না — মাঝপথে থেমে গেলে যে ট্যাবগুলো খুলতে
 * পারত সেগুলোও হারাত।
 */
export function openInTabs(
  urls: readonly string[],
  open: TabOpener,
): OpenTabsResult {
  let opened = 0;
  let blocked = 0;

  for (const url of urls) {
    const tab = open(url);
    if (tab === null) {
      blocked++;
      continue;
    }
    // ⚠️ tabnabbing — নতুন ট্যাব `window.opener` ধরে এই পাতাটাকে অন্য
    //    কোথাও সরিয়ে দিতে পারত (`MyTargets`-এর `rel="noopener"`-এর একই কারণ)
    tab.opener = null;
    opened++;
  }

  return { opened, blocked };
}

/**
 * ⭐⭐ **আটকে গেলে মানুষকে কী বলতে হবে** — খাঁটি ফাংশন, তাই টেস্টযোগ্য।
 *
 * ⚠️⚠️ বার্তায় **কী করতে হবে** সেটা থাকতেই হবে, শুধু "আটকে গেছে" নয়।
 * সমাধানটা এক জায়গাতেই — ঠিকানা-বারের পপ-আপ আইকনে গিয়ে এই সাইটকে
 * অনুমতি দেওয়া, একবারই। ⭐ ওই বাক্যটা না থাকলে ডিজাইনার বোতামটাকেই
 * ভাঙা ধরে নিতেন, আর রোজ ৩০টা লিঙ্ক হাতে খুলতেন।
 *
 * ⚠️ সব খুললে `null` — "সব ঠিক আছে" জাতীয় আশ্বাস পর্দায় বসে না
 * (`Notice`-এর নিয়ম)। কাজটা হয়ে গেলে ট্যাবগুলোই তার প্রমাণ।
 */
export function blockedNotice(total: number, blocked: number): string | null {
  if (blocked <= 0) return null;

  const what =
    blocked === total
      ? `The browser blocked all ${total} tabs.`
      : `The browser blocked ${blocked} of ${total} tabs.`;

  return `${what} Allow pop-ups for this site — the icon at the right of the address bar — then press again.`;
}
