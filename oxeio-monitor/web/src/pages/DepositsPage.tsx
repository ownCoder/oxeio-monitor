import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Page } from '../components/Page';
import { ErrorBox } from '../components/States';
import { DepositsTab } from './settings/DepositsTab';

/**
 * **R21 — সিকিউরিটি মানি (জামানত)**, সাইডবারের নিজের পাতায়।
 *
 * ⚠️⚠️ **কেন Settings থেকে সরানো হলো:** জামানত রোজকার টাকার হিসাব —
 * কে কত জমাল, কে ছেড়ে গেলে কত ফেরত। সেটা "সেটিংস" নয়। মালিকের কথায়:
 * *"Setting > Deposits ta ke sidebar-e niye aso."*
 *
 * ⭐ সেটিংসে যা থাকে তা **একবার বসিয়ে ভুলে যাওয়ার** জিনিস (নীতি, ছুটির
 * তালিকা, ক্যাটাগরি)। জামানতের পাতায় ঢুকতে হয় বারবার, আর প্রতিবার
 * সেটিংসের আটটা ট্যাবের ভেতর থেকে খুঁজে বের করাটা অকারণ ঘষা।
 *
 * ⚠️ পর্দার ভেতরটা **হুবহু একই কম্পোনেন্ট** (`DepositsTab`) — নকল করা
 * হয়নি। দুই জায়গায় দুটো কপি থাকলে একদিন একটায় ঠিক হতো, অন্যটায় নয়।
 *
 * ⚠️⚠️ owner-only, ম্যানেজারও নয় — জামানত সরাসরি বেতনের অংশ
 * (ADR-023 · ADR-027)। রুটটাও `App.tsx`-এ শুধু owner-এর জন্যই বসে, তাই
 * এখানকার পরীক্ষাটা **দ্বিতীয় জাল**: কেউ ভবিষ্যতে রুটের শর্তটা আলগা
 * করে ফেললেও পর্দাটা নিজে থেকে খুলে যাবে না।
 */
export function DepositsPage() {
  const { user } = useAuth();

  if (user?.role !== 'owner') {
    return (
      <Page title="Deposits">
        <ErrorBox error={new ApiError(403, "You don't have access")} />
      </Page>
    );
  }

  return (
    <Page
      title="Deposits"
      subtitle="Security money held from salary, and what happens when someone leaves"
    >
      <DepositsTab />
    </Page>
  );
}
