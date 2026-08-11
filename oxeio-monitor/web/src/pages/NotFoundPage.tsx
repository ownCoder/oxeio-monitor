import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/Page';
import { Empty } from '../components/States';

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
export function NotFoundPage() {
  const { user } = useAuth();
  const home = user?.role === 'employee' ? '/screenshots' : '/';

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
            {user?.role === 'employee' ? 'My screenshots' : 'Back to Live Board'}
          </Link>
        }
      />
    </Page>
  );
}
