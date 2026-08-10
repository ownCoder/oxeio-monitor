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
 * ⚠️ "ফিরে যান" লিঙ্কটা ভূমিকা বুঝে — স্টাফের জন্য `/` মানে লাইভ বোর্ড,
 *    আর ওটা তার জন্য ৪০৩। তাকে সেদিকে ঠেলে দেওয়ার মানে হয় না।
 */
export function NotFoundPage() {
  const { user } = useAuth();
  const home = user?.role === 'employee' ? '/screenshots' : '/';

  return (
    <Page title="পাওয়া যায়নি">
      <Empty
        title="এই ঠিকানায় কিছু নেই"
        hint="লিঙ্কটা পুরোনো হতে পারে, বা ঠিকানায় টাইপো আছে।"
        action={
          <Link
            to={home}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-brand hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            {user?.role === 'employee' ? 'আমার স্ক্রিনশট' : 'লাইভ বোর্ডে ফিরুন'}
          </Link>
        }
      />
    </Page>
  );
}
