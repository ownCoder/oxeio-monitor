/**
 * **Teams-এ পাঠানোর পে-লোড** — খাঁটি ফাংশন, কোনো নেটওয়ার্ক নেই।
 *
 * ⭐ আলাদা ফাইল, কারণ গড়নটাই এখানে সবচেয়ে ভঙ্গুর অংশ: JSON-এর একটা ঘর
 * ভুল হলে Teams **২০০ ফেরত দিয়েও কিছু দেখায় না** — অর্থাৎ ব্যর্থতাটা
 * নীরব। খাঁটি রাখায় গড়নটা টেস্টে বেঁধে ফেলা যায়।
 *
 * ⚠️⚠️ **কোন গড়ন, আর কেন:** Microsoft পুরোনো "Office 365 connector"
 * (MessageCard) তুলে দিয়েছে; এখনকার পথ **Workflows / Power Automate**-এর
 * "When a Teams webhook request is received", আর সেটা চায় একটা
 * <b>Adaptive Card</b>, নির্দিষ্ট খামে মোড়া। তাই সেই খামটাই ব্যবহার করা
 * হয়েছে — পুরোনো connector URL-ও সাধারণত এটা মেনে নেয়।
 */

/** Teams কার্ডের বাইরের খাম — নাম তিনটে হুবহু এই বানানেই লাগে */
export interface TeamsPayload {
  type: 'message';
  attachments: {
    contentType: 'application/vnd.microsoft.card.adaptive';
    contentUrl: null;
    content: Record<string, unknown>;
  }[];
}

/**
 * ⚠️ Adaptive Card-এর সংস্করণ **১.৪**, নতুনটা নয়। Teams-এর ডেস্কটপ ও
 * ওয়েব ক্লায়েন্ট সব সংস্করণ সমানভাবে আঁকে না, আর বেশি নতুন চাইলে কার্ডটা
 * কারো কারো কাছে **ফাঁকা** দেখাত — আবারও নীরব ব্যর্থতা।
 */
const CARD_VERSION = '1.4';

/**
 * ⚠️⚠️ Teams-এ একটা বার্তার সীমা আছে (~২৮ KB)। সাপ্তাহিক সারাংশ ১৫ জনের
 * অফিসে অনেক ছোট, কিন্তু দল বাড়লে একদিন সীমা ছুঁতে পারে — আর তখন Teams
 * **পুরো বার্তাটাই ফেলে দিত**, অর্ধেক নয়। তাই এখানেই কেটে দেওয়া হয়, আর
 * কাটা পড়েছে সেটা বার্তাতেই লেখা থাকে।
 */
const MAX_CHARS = 20_000;
const TRIMMED_NOTE = '\n\n_(বার্তাটা লম্বা হওয়ায় কেটে দেওয়া হয়েছে — পুরোটা সার্ভারের লগে)_';

export function trimForTeams(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS - TRIMMED_NOTE.length) + TRIMMED_NOTE;
}

/**
 * সাদামাটা লেখা → Teams কার্ড।
 *
 * ⭐ `wrap: true` আর `TextBlock` — কোনো টেবিল বা কলাম নয়। সারাংশটা
 * টেলিগ্রামের জন্য লেখা সাদা টেক্সট; ওটাকে কার্ডের ছকে ঢোকাতে গেলে
 * বার্তার উৎসটাই দুই জায়গায় দুরকম হয়ে যেত, আর একদিন একটা বদলাত অন্যটা নয়।
 */
export function teamsCard(title: string, text: string): TeamsPayload {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        // ⚠️ `null` **বাদ দেওয়া যাবে না** — কিছু ক্লায়েন্ট ঘরটা না পেলে
        //    সংযুক্তিটা নীরবে বাদ দেয়।
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: CARD_VERSION,
          body: [
            {
              type: 'TextBlock',
              text: title,
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: trimForTeams(text),
              wrap: true,
            },
          ],
        },
      },
    ],
  };
}
