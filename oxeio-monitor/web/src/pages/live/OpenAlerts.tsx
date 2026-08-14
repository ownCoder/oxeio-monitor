import { Link } from 'react-router-dom';

import type { AlertPage } from '../../api/alerts';
import { formatTime } from '../../lib/format';

/**
 * E15 — **এখনো দেখা হয়নি এমন অ্যালার্ট**, বোর্ডেই।
 *
 * ⭐ এতদিন অ্যালার্ট দেখতে হলে আলাদা পাতায় যেতে হতো, অর্থাৎ **যাওয়ার কথা
 * মনে থাকলে তবেই**। বোর্ড দিনে বহুবার খোলা হয়; সমস্যাটা যেখানে চোখ পড়ে
 * সেখানেই থাকা উচিত।
 *
 * ⚠️⚠️ **পর্দায় লাল একটাই জায়গায়।** উপরের টাইলের সারিতে লাল কেবল
 * "Agent down"-এ, আর এখানে — দুটোই "এখনই হাত দিন" শ্রেণির। মাসের pace
 * পিছিয়ে থাকলে সেটা **হলুদ**, কারণ ওটা খারাপ কিন্তু জরুরি নয়। তিন রকম
 * খবরকে এক রঙে দেখালে লাল রঙের মানেই হারিয়ে যেত।
 *
 * ⚠️ খালি অবস্থাটা **সবুজ নয়, নিরপেক্ষ** — "কিছু নেই" আর "সব ভালো" এক কথা
 * নয়; অ্যালার্ট না থাকা মানে কেবল এই মুহূর্তে কেউ কিছু ধরেনি।
 */
export function OpenAlerts({ page }: { page: AlertPage }) {
  if (page.openCount === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">
        Nothing waiting. New alerts show up here on their own.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 pt-1 pb-3">
      {page.rows.slice(0, 3).map((row) => (
        <div
          key={row.id}
          className="rounded-md border border-attention/30 bg-brand-bg px-3 py-2"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold text-brand-ink">
              {row.title}
            </span>
            {/*
              ⚠️ সময়টা **সবসময়** থাকে — "কখন" ছাড়া অ্যালার্ট পড়ে সিদ্ধান্ত
                 নেওয়া যায় না; দু-ঘণ্টা আগের আর দু-দিন আগের ঘটনা এক নয়।
            */}
            <span className="num shrink-0 text-[10.5px] text-ink-3">
              {formatTime(row.createdAt)}
            </span>
          </div>
          {/*
            ⚠️ `detail` **খালি হতে পারে** — কিছু অ্যালার্টে শিরোনামই পুরো
               কথা। খালি হলে সারিটা বসে না, নইলে একটা ফাঁকা লাইন থেকে যেত
               আর দেখে মনে হতো কিছু লোড হয়নি।
          */}
          {row.detail && (
            <p className="mt-0.5 text-[11.5px] text-ink-2">{row.detail}</p>
          )}
        </div>
      ))}

      {/*
        ⚠️ সংখ্যাটা **মোট খোলা**, উপরে দেখানো তিনটে নয় — তিনটে দেখিয়ে
           "এই তো সব" ভাব তৈরি করা যাবে না।
      */}
      <Link
        to="/alerts"
        className="tap text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
      >
        {page.openCount === 1
          ? 'See the open alert'
          : `See all ${page.openCount} open alerts`}
      </Link>
    </div>
  );
}
