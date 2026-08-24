import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/Page';
import { Empty } from '../components/States';
import { homePathFor } from '../api/auth';

/**
 * ৪০৪ — ঠিকানাটা নেই।
 *
 * ⭐ owner ছাড়া কেউ `/settings` টাইপ করলে **এই পাতাটাই** আসে, "অনুমতি নেই"
 *    নয়। রুটটা তার জন্য `App.tsx`-এ বসানোই হয় না, তাই ম্যানেজার জানতেও
 *    পারে না যে সেটিংস বলে একটা পর্দা আছে। ৪০৩ বললে উল্টো নিশ্চিত করে
 *    দেওয়া হতো যে জিনিসটা আছে, শুধু তার নাগালের বাইরে।
 *
 * ⚠️ ফেরার লিঙ্কটা ভূমিকা বুঝে — স্টাফের জন্য `/` মানে লাইভ বোর্ড, আর ওটা
 *    তার জন্য ৪০৩। তাকে সেদিকে ঠেলে দেওয়ার মানে হয় না, তাই তার লেখাটাও
 *    আলাদা: "My screenshots"।
 */
/**
 * ⚠️ ফেরার পথের **নাম** — পথটা যেখানে নামায় সেটাই লিখতে হয়। আগে
 * শর্তটা দুবার লেখা ছিল (একবার পথের জন্য, একবার লেখার জন্য), আর
 * নতুন রোল এলে দুটো আলাদা দিকে গড়াত।
 */
const HOME_WORD: Record<string, string> = {
  '/': 'Back to Live Board',
  '/targets/all': 'Back to the Design Pool',
  '/me': 'My data',
};

export function NotFoundPage() {
  const { user } = useAuth();
  /**
   * ⚠️ আগে লেখা ছিল `role === 'employee' ? '/screenshots' : '/'` — গবেষক
   *    রোল এলে তিনি `/` (Live Board) পেতেন, আর সেটা তাঁর কাছে ৪০৩।
   * ⭐ এখন সূত্রটা এক জায়গায়, App.tsx-এর অবতরণের সাথে মিলিয়ে।
   */
  const home = homePathFor(user?.role);

  return (
    <Page title="Not found">
      <Empty
        title="There's nothing at this address"
        hint="The link may be old, or the address has a typo."
        action={
          <Link
            to={home}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-brand hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            {HOME_WORD[home] ?? 'Back'}
          </Link>
        }
      />
    </Page>
  );
}
