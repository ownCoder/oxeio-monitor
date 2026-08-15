import { useSearchParams } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page } from '../../components/Page';
import { ErrorBox } from '../../components/States';
import { Tabs } from '../../components/Tabs';
import { AgentVersionsTab } from './AgentVersionsTab';
import { AuditTab } from './AuditTab';
import { CategoriesTab } from './CategoriesTab';
import { LeaveTab } from './LeaveTab';
import { MonthsTab } from './MonthsTab';
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
  { id: 'staff', label: 'Staff' },
  { id: 'categories', label: 'Categories' },
  { id: 'policies', label: 'Policies & holidays' },
  // ⭐ Policies-এর ঠিক পরে: ছুটির তালিকা মাসের সংখ্যা **বদলায়**, আর এই
  //    ট্যাবটা সেগুলো **থামায়** — একই প্রশ্নের দুই দিক, তাই পাশাপাশি।
  { id: 'leave', label: 'Leave' },
  { id: 'months', label: 'Months' },
  // ⚠️ audit-এর **আগে**: এটা রোজকার কাজের ট্যাব নয়, কিন্তু audit log
  //    সবার শেষে থাকাটা প্রতিষ্ঠিত (বছরে দু-একবার খোলা হয়)
  { id: 'agent', label: 'Agent updates' },
  { id: 'audit', label: 'Audit log' },
] as const;

type TabKey = (typeof TABS)[number]['id'];

const SUBTITLE: Record<TabKey, string> = {
  // ⚠️⚠️ **"Devices" ট্যাবটা ইচ্ছাকৃতভাবে তুলে দেওয়া হয়েছে।** মালিকের
  //    কথায়: *"ami Devices ei option tai chai na, eta full system take
  //    complex banacche."* — আর তিনি ঠিক ছিলেন: একই প্রশ্নের ("Belal-এর
  //    PC ঠিক আছে তো?") উত্তর দুই পর্দায় খুঁজতে হতো।
  //
  // ⭐ ওই পর্দার একমাত্র সত্যিকারের দরকারি কাজটা — বন্ধ এজেন্ট ফেরানো —
  //    এখন Staff সারিতেই, "Turn agent on" হিসেবে। আর লুকিয়ে ফেলা নয়,
  //    **মানুষ ধরে সাজানো**: মালিক ডিভাইস নম্বর নিয়ে ভাবেন না।
  staff: 'Add, edit and deactivate people — nothing is ever deleted',
  categories: 'Which apps and sites fall into which category',
  policies: 'Monthly target, screenshot window and days off',
  leave: 'Agreed days off — the hours target drops, the salary does not',
  months: 'Freeze a finished month so its hours and pay stop moving',
  agent: 'Which build each PC is offered — and how widely',
  audit: 'Who looked at what, and who changed what',
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
      <Page title="Settings">
        {/*
          ⚠️ `<ErrorBox>` নিজেই ৪০৩ চেনে আর "আবার চেষ্টা করুন" বোতামটা
             লুকিয়ে দেয় — বারবার চাপলেও অনুমতি আসবে না, শুধু বিভ্রান্তি
             বাড়ত। তাই আলাদা বার্তা না লিখে সেই একই বাক্সটাই দেখানো হয়,
             যাতে পুরো পণ্যে ৪০৩-এর চেহারা এক থাকে।
        */}
        <ErrorBox error={new ApiError(403, "You don't have access")} />
      </Page>
    );
  }

  return (
    <Page title="Settings" subtitle={SUBTITLE[active]}>
      <div className="mb-4">
        <Tabs
          items={TABS}
          active={active}
          label="Settings sections"
          // `replace` — ট্যাব বদলানো ব্রাউজারের ইতিহাসে জমা হলে
          // "back" চেপে বেরোতে গিয়ে পাঁচবার ট্যাব ফিরত
          onChange={(key) => setParams({ tab: key }, { replace: true })}
        />
      </div>

      {active === 'staff' && <StaffTab />}
      {active === 'categories' && <CategoriesTab />}
      {active === 'policies' && <PoliciesTab />}
      {active === 'leave' && <LeaveTab />}
      {active === 'months' && <MonthsTab />}
      {active === 'agent' && <AgentVersionsTab />}
      {active === 'audit' && <AuditTab />}
    </Page>
  );
}
