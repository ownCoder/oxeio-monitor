import type { LiveCard } from '../../api/dashboard';
import { designView } from './roster';

/**
 * **আজকের ডিজাইন — খোলা ও শেষ** *(২৩ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ **আলাদা ফাইলে, কারণ দুটো টেবিল একে ব্যবহার করে** — Worklog-এর
 * রোস্টার আর Live Board-এর "Against Today's Target"। মালিক দুই জায়গাতেই
 * সংখ্যাটা চেয়েছেন, আর মার্কআপ নকল করলে একদিন একটা বদলাত আর অন্যটা নয়
 * — ঠিক যে কারণে `TeamRoster`-এর মার্কআপও **সরানো** হয়েছিল, নকল নয়।
 */
export function DesignCell({ card }: { card: LiveCard }) {
  const view = designView(card);
  if (view === null) return <span className="text-ink-3">—</span>;

  return (
    <span className="num whitespace-nowrap">
      {/* ⭐ **খোলা** — নিজে থেকে গোনা হয়, ফাইলের নামের নম্বর ধরে */}
      <span className={view.met ? 'font-semibold text-ok' : 'font-medium text-ink'}>
        {view.done}
      </span>

      {/*
        ⭐⭐ **শেষ** — ডিজাইনার নিজে Complete চেপে বলেছেন।

        ⚠️⚠️ ০ হলে ঘরটা **খালি রাখা হয়**, "০" লেখা হয় না। কারণ বোতামটা
        সবে বসেছে; "১৮ · ০" দেখতে "কিছুই শেষ হয়নি"-র মতো লাগত, অথচ আসল
        কথা হলো কেউ এখনো বোতামটা ব্যবহার করছেন না — দুটো আলাদা ব্যাপার।
      */}
      {view.finished > 0 && (
        <>
          <span className="text-ink-3"> · </span>
          <span className="font-medium text-ok">{view.finished}</span>
        </>
      )}

      {/*
        ⚠️ টার্গেট না থাকলে "/ ২৫"-ও নেই — ওই কর্মীর কোনো টার্গেটই নেই,
           তাই ভগ্নাংশটা লিখলে সেটা একটা দাবি হয়ে যেত যা সত্যি নয়।
      */}
      {view.target !== null && (
        <span className="text-ink-3"> / {view.target}</span>
      )}
    </span>
  );
}
