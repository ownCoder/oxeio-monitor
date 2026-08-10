import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * `?date=2026-08-10` — E04 ও E05 দুটোতেই এক।
 *
 * ⚠️ `@Type(() => Date)` ইচ্ছাকৃতভাবে **নেই**। ওটা দিলে `2026-08-10` আগে
 *    UTC instant হয়ে যেত, আর তখন "কোন কর্মদিবস" প্রশ্নের উত্তর টাইমজোনের
 *    উপর নির্ভর করত। কর্মদিবস ঢাকার ক্যালেন্ডারের জিনিস (§ ২.১-ক), তাই
 *    স্ট্রিংটাই সার্ভিস পর্যন্ত যায় এবং `parseWorkDate` সেটাকে ধরে।
 *
 * ⚠️ গ্লোবাল ValidationPipe-এ forbidNonWhitelisted — তাই `?date=` ছাড়া
 *    বাড়তি কোনো query param পাঠালে ৪০০ যাবে, নীরবে উপেক্ষা হবে না।
 */
export class WorkDateQueryDto {
  /** না দিলে ঢাকার আজকের দিন ধরা হয় */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date দিতে হবে YYYY-MM-DD ফরম্যাটে',
  })
  date?: string;
}
