import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  DESIGN_APPS_SQL,
  DESIGN_ID_SQL_EXPR,
} from '../summary/design.rules';

/**
 * **ফাইলের চিহ্ন** *(৯ সেপ্টেম্বর ২০২৬)* — একটা জব-নম্বরের ফাইল
 * ডিজাইন-অ্যাপে মোট কতক্ষণ পর্দায় ছিল।
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো।** টার্গেটের "শেষ" চিহ্নটা কর্মীর **নিজের
 * দাবি** — কেউ যাচাই করে না, আর সিস্টেম সেটা প্রশ্ন না করেই বোর্ডে তোলে।
 * ৮ সেপ্টেম্বরে একজনের ৩২টা "শেষ" নিয়ে প্রশ্ন উঠেছিল, আর উত্তর দিতে
 * ডাটাবেসে হাতে কোয়েরি লিখতে হয়েছিল — কারণ পর্দায় দাবিটা ছিল,
 * দাবির পাশে কিছু ছিল না।
 *
 * ⭐⭐ নতুন কোনো ডেটা জমা করতে হয়নি: এজেন্ট শিরোনাম **আগে থেকেই** রাখে,
 * আর ফাইলের নাম শুরু হয় জব-নম্বর দিয়ে। অর্থাৎ প্রশ্নটার উত্তর ইতিমধ্যেই
 * টেবিলে ছিল, কেউ জিজ্ঞেস করত না।
 *
 * ⚠️⚠️ **এটা "কাজ হয়েছে কি না" মাপে না।** যা মাপে তা হলো *ওই নম্বরওয়ালা
 * একটা ফাইল Illustrator/Photoshop-এ খোলা ছিল কি না*। চিহ্ন না থাকার
 * নির্দোষ কারণ অনেক — ফাইলটা সেভ করা হয়নি (`Untitled-20*`), নামের সামনে
 * নম্বর বসানো হয়নি, বা কাজটা অন্য কোনো অ্যাপে হয়েছে। ⭐ তাই সংখ্যাটা
 * **অভিযোগ নয়, প্রসঙ্গ** — আর সেজন্যই এর কোনো অ্যালার্ট নেই।
 */
@Injectable()
export class FileTraceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ⭐⭐ **কোন দিন থেকে শিরোনাম জমা আছে** — `'YYYY-MM-DD'`, কিছু না
   * থাকলে `null`।
   *
   * ⚠️⚠️ **এই তারিখটার আগের কোনো সারি নিয়ে "ফাইল খোলা হয়নি" বলা যায় না**,
   * কারণ তখন আমরা দেখতামই না। মাঠে `app_usage` শুরু হয়েছে ১৩ আগস্ট
   * ২০২৬-এ, অথচ শেষ-হওয়া টার্গেট আছে ২০২৫ সাল থেকে — ওই ২৭ হাজার সারি
   * "চিহ্ন নেই" বলে দেখানো হতো, আর তালিকাটা অর্থহীন হয়ে যেত।
   *
   * ⭐ তারিখটা **ডেটা থেকেই** আসে, ধ্রুবক নয় — কোনোদিন পুরোনো সারি ছাঁটা
   * শুরু হলে সীমানাটা নিজে থেকেই এগিয়ে যাবে, কারো মনে রাখতে হবে না।
   *
   * ### ⚠️ খরচ — মেপে রাখা *(৯ সেপ্টেম্বর ২০২৬)*
   *
   * `min(work_date)`-এর কোনো সূচক নেই, তাই এটা গোটা `app_usage`-এর উপর
   * সমান্তরাল seq scan: প্রোডাকশনে ১,৫৪,০০০ সারিতে **৩২–৫৪ ms**, আর
   * প্রতিবার তালিকা খুললেই একবার। টেবিলটা দিনে ~৭ হাজার সারি বাড়ে।
   *
   * ⚠️⚠️ **একটা ১০-মিনিটের ক্যাশ লেখা হয়েছিল, তারপর তুলে নেওয়া হয়** —
   * কারণ সার্ভিসটা টেস্টে **একটাই ইনস্ট্যান্স**, আর `resetDatabase()`
   * ওই ক্যাশ মোছে না; ফলে এক টেস্টের সীমানা পরের টেস্টে চলে যেত।
   * ⭐ আর যে ক্যাশ ঠিক রাখতে টেস্টকে খোঁচাতে হয়, সেটা প্রোডাকশনেও
   * ভুল হতে পারে — ৩২ ms-এর জন্য ওই লুকোনো অবস্থাটা কেনার মতো নয়।
   *
   * ⭐ কোনোদিন সত্যিই সমস্যা হলে ঠিক পথ দুটো, আর দুটোই লুকোনো অবস্থা
   * ছাড়া: `app_usage(work_date)`-এ একটা সূচক, নয়তো সংখ্যাটা
   * `summary_dirty`-র মতো একটা ছোট টেবিলে লিখে রাখা।
   */
  async since(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ d: string | null }[]>`
      SELECT min(work_date)::text AS d FROM app_usage`;

    return rows[0]?.d ?? null;
  }

  /**
   * ⭐⭐ **কখনো পর্দায় এসেছে এমন সব জব-নম্বর।**
   *
   * ⚠️ গোটা তালিকাটা একবারে আনা হয় (আজ ~২,৮০০টা) — কারণ প্রশ্নটা
   * উল্টো দিকের: *"কোনগুলো কখনো আসেনি"*, আর সেটা `NOT IN` ছাড়া
   * Prisma-য় লেখা যায় না। ⭐ সংখ্যাটা বছরে হাজার দুয়েক বাড়ে, তাই
   * অনেক দিন এভাবেই চলবে।
   *
   * ⚠️ ছয় অঙ্ক বা তার কম **এখানেও থাকে**: `keepKnownLongIds` কেবল
   * ক্রেডিট বসানোর সময় লম্বা নম্বর ছাঁকে, আর এখানে খোঁজা হচ্ছে
   * `design_targets.job_number` ধরে — যা সংজ্ঞা অনুযায়ীই "জানা নম্বর"।
   */
  async seenJobNumbers(): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ did: string | null }[]>`
      SELECT DISTINCT ${Prisma.raw(DESIGN_ID_SQL_EXPR)} AS did
      FROM app_usage
      WHERE ${Prisma.raw(DESIGN_APPS_SQL)}
        AND ${Prisma.raw(DESIGN_ID_SQL_EXPR)} IS NOT NULL`;

    const out: number[] = [];
    for (const r of rows) {
      if (r.did === null) continue;
      const n = Number.parseInt(r.did, 10);
      // ⚠️ `job_number` কলামটা `Int` — বড় কিছু পাঠালে Prisma ছুড়ত
      if (Number.isSafeInteger(n) && n <= 2_147_483_647) out.push(n);
    }

    return out;
  }

  /**
   * ⭐ **এই নম্বরগুলোর প্রতিটায় মোট কত সেকেন্ড** — না পাওয়া নম্বর
   * ম্যাপে **থাকে না** (শূন্য বসে না; পার্থক্যটা কলার ঠিক করে)।
   *
   * ⚠️ কেবল পর্দায় থাকা পাতাটুকুর জন্য ডাকা হয় (৫০টা সারি), তাই
   * ইনডেক্স ধরে ৫০টা লুকআপ — গোটা টেবিল নয়।
   */
  async secondsFor(
    jobNumbers: readonly number[],
  ): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (jobNumbers.length === 0) return out;

    const ids = jobNumbers.map((n) => String(n));

    const rows = await this.prisma.$queryRaw<{ did: string; sec: number }[]>`
      SELECT ${Prisma.raw(DESIGN_ID_SQL_EXPR)} AS did,
             sum(duration_sec)::int AS sec
      FROM app_usage
      WHERE ${Prisma.raw(DESIGN_APPS_SQL)}
        AND ${Prisma.raw(DESIGN_ID_SQL_EXPR)} IN (${Prisma.join(ids)})
      GROUP BY 1`;

    for (const r of rows) {
      const n = Number.parseInt(r.did, 10);
      if (Number.isSafeInteger(n)) out.set(n, r.sec);
    }

    return out;
  }
}
