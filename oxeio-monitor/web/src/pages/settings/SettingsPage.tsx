import { useSearchParams } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page } from '../../components/Page';
import { ErrorBox } from '../../components/States';
import { Tabs } from '../../components/Tabs';
import { AuditTab } from './AuditTab';
import { CategoriesTab } from './CategoriesTab';
import { DevicesTab } from './DevicesTab';
import { PoliciesTab } from './PoliciesTab';
import { StaffTab } from './StaffTab';

/**
 * E09 · E10 · E11 · D06 — সেটিংস (**owner-only**)।
 *
 * ⚠️ পুরো পর্দাটাই owner-এর। ম্যানেজারকে Layout-এর নেভে ট্যাবটাই দেখানো
 *    হয় না — এখানকার ৪০৩ পর্দাটা শেষ রক্ষাকবচ, প্রথম নয়। URL হাতে টাইপ
 *    করে কেউ এলে যেন খালি পাতা বা ভাঙা কল দেখে বিভ্রান্ত না হয়, তাই
 *    সোজাসুজি "অনুমতি নেই" বলা হয়।
 *
 * ⭐ ট্যাবগুলো আলাদা রুট নয়, `?tab=` — দুটো কারণে:
 *    ১· `App.tsx` ছুঁতে হয় না (ওটা অন্য এজেন্টের ফাইল), অথচ
 *       "/settings?tab=audit" লিঙ্ক করে পাঠানো যায় আর রিফ্রেশেও টেকে।
 *    ২· ট্যাব বদলালে ভেতরের কোনো কম্পোনেন্ট পুনর্ব্যবহার হয় না — প্রতিটা
 *       ট্যাব নিজের ডেটা নিজে আনে, তাই স্টাফ ট্যাব থেকে ফিরে এলে বাসি
 *       তালিকা বসে থাকার সুযোগ নেই।
 */

const TABS = [
  { id: 'staff', label: 'স্টাফ' },
  { id: 'devices', label: 'ডিভাইস' },
  { id: 'categories', label: 'ক্যাটাগরি' },
  { id: 'policies', label: 'নিয়ম ও ছুটি' },
  { id: 'audit', label: 'Audit log' },
] as const;

type TabKey = (typeof TABS)[number]['id'];

const SUBTITLE: Record<TabKey, string> = {
  staff: 'কর্মী যোগ, সম্পাদনা ও নিষ্ক্রিয় করা — মুছে ফেলা যায় না',
  devices: 'কোন PC থেকে ডেটা আসছে, আর কোনটা বন্ধ করে দেওয়া হয়েছে',
  categories: 'কোন অ্যাপ ও সাইট কোন ক্যাটাগরিতে পড়বে',
  policies: 'মাসের টার্গেট, ছবির উইন্ডো আর ছুটির দিন',
  audit: 'কে কখন কী দেখল ও কী বদলাল',
};

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.id === value);
}

export function SettingsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const raw = params.get('tab');
  const active: TabKey = isTabKey(raw) ? raw : 'staff';

  if (user?.role !== 'owner') {
    return (
      <Page title="সেটিংস">
        {/*
          ⚠️ `<ErrorBox>` নিজেই ৪০৩ চেনে আর "আবার চেষ্টা করুন" বোতামটা
             লুকিয়ে দেয় — বারবার চাপলেও অনুমতি আসবে না, শুধু বিভ্রান্তি
             বাড়ত। তাই আলাদা বার্তা না লিখে সেই একই বাক্সটাই দেখানো হয়,
             যাতে পুরো পণ্যে ৪০৩-এর চেহারা এক থাকে।
        */}
        <ErrorBox error={new ApiError(403, 'অনুমতি নেই')} />
      </Page>
    );
  }

  return (
    <Page title="সেটিংস" subtitle={SUBTITLE[active]}>
      <div className="mb-4">
        <Tabs
          items={TABS}
          active={active}
          label="সেটিংসের অংশ"
          // `replace` — ট্যাব বদলানো ব্রাউজারের ইতিহাসে জমা হলে
          // "back" চেপে বেরোতে গিয়ে পাঁচবার ট্যাব ফিরত
          onChange={(key) => setParams({ tab: key }, { replace: true })}
        />
      </div>

      {active === 'staff' && <StaffTab />}
      {active === 'devices' && <DevicesTab />}
      {active === 'categories' && <CategoriesTab />}
      {active === 'policies' && <PoliciesTab />}
      {active === 'audit' && <AuditTab />}
    </Page>
  );
}
