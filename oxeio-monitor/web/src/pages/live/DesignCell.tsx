import type { LiveCard } from '../../api/dashboard';
import { designView } from './roster';

/**
 * **আজ কতগুলো ডিজাইন শেষ হয়েছে** *(২৩ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ **আলাদা ফাইলে, কারণ দুটো টেবিল একে ব্যবহার করে** — Worklog-এর
 * রোস্টার আর Live Board-এর "Against Today's Target"। মার্কআপ নকল করলে
 * একদিন একটা বদলাত আর অন্যটা নয়।
 *
 * ⭐⭐ **কেবল "শেষ" গোনা হয়** *(মালিকের সিদ্ধান্ত)* — ফাইল খোলা নয়।
 * মাঠে ধরা পড়েছিল ম্যানেজার "১৬" দেখাচ্ছেন, অথচ তিনি ১৯টা ফাইলে মোট
 * ৪৪ মিনিট দিয়ে সেগুলো **খুলে দেখছিলেন**। খোলা-গণনা যে বানায় আর যে
 * দেখে — দুজনকে আলাদা করতে পারে না।
 */
export function DesignCell({ card }: { card: LiveCard }) {
  const view = designView(card);
  if (view === null) return <span className="text-ink-3">—</span>;

  return (
    <span className="num whitespace-nowrap">
      {/* ⭐ সবুজ কেবল টার্গেট ছোঁয়া হলে — নইলে সংখ্যাটা নিরপেক্ষ */}
      <span className={view.met ? 'font-semibold text-ok' : 'font-medium text-ink'}>
        {view.done}
      </span>

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
