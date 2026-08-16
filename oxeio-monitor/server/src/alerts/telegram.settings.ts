/**
 * **টেলিগ্রামের সেটিং** — খাঁটি নিয়ম, কোনো I/O নেই।
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো:** টোকেন ও চ্যাট আইডি ছিল কেবল `.env`-এ, অর্থাৎ
 * বদলাতে হলে VPS-এ SSH করে ফাইল সম্পাদনা করে কনটেইনার রিস্টার্ট। মালিকের
 * পক্ষে সেটা কার্যত অসম্ভব — আর ফল হলো, টেলিগ্রাম একবার ভুল হলে সেটা
 * মাসের পর মাস ভুলই থেকে যেত।
 *
 * ⭐ এখন ডাটাবেসে, পর্দা থেকে বদলানো যায়। `.env` **fallback হিসেবে থাকে** —
 * পুরোনো ইনস্টলেশনে কিছু ভাঙে না, আর ডাটাবেস খালি থাকলে আগের আচরণই চলে।
 */

/** ডাটাবেসে `settings` টেবিলে এই চাবিতে বসে */
export const TELEGRAM_SETTING_KEY = 'telegram';

export interface TelegramSettings {
  botToken: string;
  chatId: string;
}

/**
 * ⚠️⚠️ **পর্দায় যা যায় — টোকেন কখনো নয়।**
 *
 * ব্রাউজারে পাঠালে সেটা DevTools, প্রক্সি লগ, বা স্ক্রিন শেয়ারে দেখা যেত।
 * তাই কেবল **শেষ চারটে অক্ষর** — মালিক যেন মিলিয়ে নিতে পারেন কোনটা বসানো
 * আছে, কিন্তু কেউ যেন ওটা দিয়ে বট চালাতে না পারে।
 */
export interface TelegramSettingsView {
  configured: boolean;
  /** `…4821` — টোকেন বসানো না থাকলে `null` */
  tokenHint: string | null;
  /** ⭐ চ্যাট আইডি গোপন নয়, তাই পুরোটাই যায় — ওটা দিয়ে কিছু করা যায় না */
  chatId: string;
  /** ⚠️ `.env` থেকে আসছে না ডাটাবেস থেকে — মালিকের জানা দরকার কোনটা খাটছে */
  source: 'database' | 'env' | 'none';
}

/**
 * ⚠️ চার অক্ষরের কম হলে কিছুই দেখানো হয় না। খুব ছোট টোকেন মানে হয় ভুল
 * বসানো, নয় পরীক্ষার মান — দুই ক্ষেত্রেই অংশ দেখিয়ে লাভ নেই, আর
 * পুরোটা দেখিয়ে ফেলার ঝুঁকি থাকে।
 */
export function tokenHint(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.length < 4) return null;

  return `…${trimmed.slice(-4)}`;
}

/**
 * ডাটাবেস ও `.env` মিলিয়ে **কোনটা আসলে খাটবে**।
 *
 * ⭐⭐ ডাটাবেস জিতবে, কিন্তু **কেবল দুটো ঘরই ভরা থাকলে**। একটা ভরা আর
 * একটা খালি রেখে দিলে টেলিগ্রাম আধা-কনফিগার হয়ে চুপচাপ বন্ধ থাকত, অথচ
 * `.env`-এ কাজ করা মান বসেই আছে — অর্থাৎ পর্দায় হাত দিয়ে জিনিসটা
 * **ভাঙানো** যেত।
 */
export function resolveTelegram(
  db: Partial<TelegramSettings> | null,
  env: Partial<TelegramSettings>,
): { settings: TelegramSettings | null; source: 'database' | 'env' | 'none' } {
  const dbToken = db?.botToken?.trim() ?? '';
  const dbChat = db?.chatId?.trim() ?? '';

  if (dbToken.length > 0 && dbChat.length > 0) {
    return { settings: { botToken: dbToken, chatId: dbChat }, source: 'database' };
  }

  const envToken = env.botToken?.trim() ?? '';
  const envChat = env.chatId?.trim() ?? '';

  if (envToken.length > 0 && envChat.length > 0) {
    return { settings: { botToken: envToken, chatId: envChat }, source: 'env' };
  }

  return { settings: null, source: 'none' };
}

/**
 * পর্দার জন্য ছবি।
 *
 * ⚠️ `source` পাঠানো হয় ইচ্ছাকৃতভাবে: `.env`-এ মান থাকা অবস্থায় মালিক
 * পর্দায় নতুন মান বসালে কোনটা খাটছে সেটা না জানালে তিনি ভাবতেন সেভ
 * হয়নি — অথচ হয়েছে, শুধু অন্যটা জিতছে না।
 */
export function telegramView(
  resolved: ReturnType<typeof resolveTelegram>,
): TelegramSettingsView {
  const s = resolved.settings;

  return {
    configured: s !== null,
    tokenHint: s ? tokenHint(s.botToken) : null,
    chatId: s?.chatId ?? '',
    source: resolved.source,
  };
}
