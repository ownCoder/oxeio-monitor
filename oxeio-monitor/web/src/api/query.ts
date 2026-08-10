/**
 * ক্যোয়ারি স্ট্রিং বানানোর একমাত্র জায়গা।
 *
 * ⚠️⚠️ সার্ভারে গ্লোবাল `ValidationPipe` — `whitelist + forbidNonWhitelisted`।
 *    অর্থাৎ DTO-তে **নেই** এমন কোনো প্যারামিটার পাঠালে সরাসরি ৪০০, নীরবে
 *    উপেক্ষা নয়। দুটো ফাঁদ:
 *      · নাম **camelCase** (`?employeeId=3`), snake_case নয়
 *      · মান `undefined` হলে প্যারামিটারটা **পাঠানোই যাবে না** —
 *        `?date=undefined` লিখলে regex-এ আটকে ৪০০ হতো
 *
 *    তাই নিচের ফিল্টারটাই সব API ফাংশনের রক্ষাকবচ। হাতে `?a=${x}` লিখবেন না।
 */
export type QueryValue = string | number | boolean | null | undefined;

export function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    // ⚠️ খালি স্ট্রিংও বাদ — ফাঁকা ইনপুট বাক্স থেকে `?search=` যেত, আর
    //    কিছু DTO-তে সেটা `@MinLength` ভেঙে ৪০০ দিত
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const text = search.toString();
  return text ? `?${text}` : '';
}
