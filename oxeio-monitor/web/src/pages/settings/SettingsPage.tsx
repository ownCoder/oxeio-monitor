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
 * E09 · E10 · E11 · D06 — সেটিংস।
 *
 * ⭐ **ম্যানেজারও ঢোকেন** *(১৫ আগস্ট)*, তবে তিনটে ট্যাবে: Staff ·
 *    Categories · Policies & holidays। Leave · Months · Agent updates ·
 *    Audit log — এগুলো owner-এরই।
 *
 * ⚠️ পর্দা থেকে ট্যাব লুকানো **শেষ রক্ষাকবচ নয়, প্রথমটা** — আসল পাহারা
 *    সার্ভারের `@Roles`-এ। এখানে লুকানো হয় যাতে কেউ এমন বোতাম না দেখেন
 *    যেটা চাপলে ৪০৩ আসবে।
 *
 * ⚠️ স্টাফ (`role=employee`) এখানে এলে সোজাসুজি "অনুমতি নেই" — খালি পাতা
 *    বা ভাঙা কল দেখে বিভ্রান্ত হওয়ার চেয়ে ভালো।
 *
 * ⭐ ট্যাবগুলো আলাদা রুট নয়, `?tab=` — দুটো কারণে:
 *    ১· `App.tsx` ছুঁতে হয় না (ওটা অন্য এজেন্টের ফাইল), অথচ
 *       "/settings?tab=audit" লিঙ্ক করে পাঠানো যায় আর রিফ্রেশেও টেকে।
 *    ২· ট্যাব বদলালে ভেতরের কোনো কম্পোনেন্ট পুনর্ব্যবহার হয় না — প্রতিটা
 *       ট্যাব নিজের ডেটা নিজে আনে, তাই স্টাফ ট্যাব থেকে ফিরে এলে বাসি
 *       তালিকা বসে থাকার সুযোগ নেই।
 */

/**
 * ⭐ `manager: true` মানে ম্যানেজারও ট্যাবটা পান *(১৫ আগস্ট)*।
 *
 * ⚠️ ঘরটা **প্রতিটা সারিতে লিখতেই হয়** (`false`-ও), ঐচ্ছিক নয় — তাই নতুন
 *    ট্যাব যোগ করলে TypeScript-ই মনে করিয়ে দেবে সিদ্ধান্তটা নিতে।
 *    ঐচ্ছিক রাখলে ভুলে যাওয়া আর "না" বলা দেখতে এক হয়ে যেত, আর একদিন
 *    কেউ ভুলে গিয়ে ভাবত সেটাই ঠিক আছে।
 */
const TABS = [
  { id: 'staff', label: 'Staff', manager: true },
  { id: 'categories', label: 'Categories', manager: true },
  { id: 'policies', label: 'Policies & holidays', manager: true },
  // ⭐ Policies-এর ঠিক পরে: ছুটির তালিকা মাসের সংখ্যা **বদলায়**, আর এই
  //    ট্যাবটা সেগুলো **থামায়** — একই প্রশ্নের দুই দিক, তাই পাশাপাশি।
  // ⚠️ Leave ও Months owner-এর: দুটোই সরাসরি টাকার হিসাব নাড়ায়।
  { id: 'leave', label: 'Leave', manager: false },
  { id: 'months', label: 'Months', manager: false },
  // ⚠️ audit-এর **আগে**: এটা রোজকার কাজের ট্যাব নয়, কিন্তু audit log
  //    সবার শেষে থাকাটা প্রতিষ্ঠিত (বছরে দু-একবার খোলা হয়)
  { id: 'agent', label: 'Agent updates', manager: false },
  // ⚠️ audit log-এ কে কার স্ক্রিনশট দেখেছে সেটাও থাকে — owner-এরই
  { id: 'audit', label: 'Audit log', manager: false },
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

  const isOwner = user?.role === 'owner';
  const tabs = isOwner ? TABS : TABS.filter((t) => t.manager);

  const raw = params.get('tab');
  /**
   * ⚠️ ট্যাবটা **এই ব্যবহারকারীর জন্য** বৈধ কি না, শুধু "নাম মেলে কি না"
   * নয়। নইলে `?tab=audit` টাইপ করলে ম্যানেজার খালি পাতা দেখতেন —
   * নেভে কিছু নেই, অথচ কনটেন্টও নেই।
   */
  const active: TabKey =
    isTabKey(raw) && tabs.some((t) => t.id === raw) ? raw : 'staff';

  if (user?.role !== 'owner' && user?.role !== 'manager') {
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
          items={tabs}
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
