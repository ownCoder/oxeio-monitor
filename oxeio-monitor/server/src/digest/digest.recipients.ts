/**
 * সাপ্তাহিক সারাংশ **কার কাছে যাবে** — খাঁটি নিয়ম, কোনো I/O নেই।
 *
 * ⭐ আলাদা ফাইল, কারণ নিয়মটা ছোট হলেও ভুলটা বড়: এই বার্তায় প্রতিটা
 * কর্মীর **নাম ও ঘণ্টা** থাকে। ভুল ঠিকানায় গেলে ফেরানো যায় না।
 *
 * ⚠️⚠️ **ম্যানেজারদের পাঠানো হয় না** — অ্যালার্টের ঠিক একই যুক্তিতে
 * (`alerts.dispatcher.ts`)। সারাংশটা owner-only পর্দার সমান জিনিস; ইমেইলে
 * পাঠিয়ে role-এর দেয়ালটা ফাঁকি দেওয়া চলবে না।
 */

export interface DigestRecipientsInput {
  /** `DIGEST_EMAIL_TO` — কমা দিয়ে আলাদা করা, না দিলে খালি */
  explicit: string | undefined;
  /** সক্রিয় owner-দের ইমেইল */
  owners: readonly string[];
}

/**
 * ⭐ স্পষ্ট তালিকা থাকলে সেটাই, নইলে সক্রিয় owner-রা — অ্যালার্টের
 * `recipients()`-এর হুবহু একই ক্রম, যাতে দুটো আলাদা জায়গায় দুই রকম
 * আচরণ না দাঁড়ায়।
 *
 * ⚠️ ফাঁকা ঘর ও ডুপ্লিকেট ছেঁকে ফেলা হয়: `.env`-এ `a@x.com,,a@x.com`
 * লেখা থাকলে একজনের কাছে দুবার যেত, আর একটা খালি ঠিকানায় SMTP ছুড়ত।
 */
export function digestRecipients(input: DigestRecipientsInput): string[] {
  const explicit = (input.explicit ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  const chosen = explicit.length > 0 ? explicit : input.owners;

  // ⚠️ ছোট হাতের করে তুলনা — `A@x.com` আর `a@x.com` একই ঠিকানা
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of chosen) {
    const email = raw.trim();
    if (email.length === 0) continue;

    const key = email.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(email);
  }

  return out;
}
