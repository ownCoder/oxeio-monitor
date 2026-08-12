import { Matches } from 'class-validator';

const DATE_MESSAGE = 'Date must be in YYYY-MM-DD format';

/**
 * ⚠️ regex এখানে শুধু **আকৃতি** দেখে; ৩১ ফেব্রুয়ারি ধরা পড়ে
 * `parseWorkDate()`-এ (reports.range.ts) — ক্যালেন্ডার যাচাই খাঁটি
 * ফাংশনেই থাকে, দুই জায়গায় নয়।
 *
 * ⚠️ `@Type(() => Date)` **নেই**, ইচ্ছাকৃতভাবে: ওটা দিলে `2026-08-10`
 * আগে একটা UTC instant হয়ে যেত, আর তখন "কোন কর্মদিবস" প্রশ্নের উত্তর
 * সার্ভারের টাইমজোনের উপর নির্ভর করত। কর্মদিবস ঢাকার ক্যালেন্ডারের
 * জিনিস (§ ২.১-ক), তাই স্ট্রিংটাই সার্ভিস পর্যন্ত যায়।
 */
export class MyDaysQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE })
  to!: string;
}
