import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { listAlerts } from '../api/alerts';
import type { Role } from '../api/auth';
import { usePolling } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { BrandMark, Wordmark } from './Brand';
import { ErrorBoundary } from './ErrorBoundary';
import { ThemeToggle } from './ThemeToggle';

/**
 * নেভের ব্যাজের তাল — বোর্ডের pulse-এর মতোই ধীরে।
 *
 * ⚠️ অ্যালার্ট মিনিটে মিনিটে বদলায় না, আর এটা **প্রতিটা পাতায়** চলে
 *    (Layout সব রুটের বাইরে)। দ্রুত ডাকলে গোটা অ্যাপ জুড়ে অকারণ ট্রাফিক হতো।
 */
const ALERT_BADGE_MS = 120_000;

/**
 * উপরের বারে পাতা-নির্দিষ্ট জিনিস বসানোর ঘরের id।
 * ⚠️ `Layout` ও `LiveBoardPage` দুটোই এটা ব্যবহার করে, তাই ধ্রুবকটা
 *    এখানেই রপ্তানি — দু-জায়গায় স্ট্রিং লিখলে একদিন একটা বদলে অন্যটা
 *    থেকে যেত, আর ঘরটা নীরবে খালি থাকত।
 */
export const TOPBAR_SLOT_ID = 'oxeio-topbar-slot';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** কোন ভূমিকা এই ট্যাবটা **দেখতে পাবে** */
  roles: Role[];
  /**
   * ⭐ মকআপ ক-এর ভাগের লেবেল — এই আইটেমটার **ঠিক আগে** বসে।
   *
   * ⚠️ কেবল সাইডবারে (`lg`-এর উপরে)। ফোনের আড়াআড়ি সারিতে ভাগের লেবেল
   *    মানে ট্যাবের মাঝে একটা লেখা যেটা চাপা যায় না — সরু পর্দায় ওটা
   *    জায়গা খায় আর ট্যাব বলে ভুল হয়।
   */
  section?: string;
  /**
   * ⭐ নামের পাশে একটা সংখ্যা (মকআপে `Alerts 2`)।
   *
   * ⚠️⚠️ `undefined` আর `0` **এক নয়**: `0` মানে "গুনেছি, কিছু নেই" — ব্যাজ
   *    বসে না; `undefined` মানে "এখনো জানি না"। দুটোকে এক ধরলে সংখ্যা
   *    আসার আগেই নেভ দাবি করত সব ঠিক আছে।
   */
  badge?: number;
}

/**
 * ⭐ **নেভ থেকেই ফিল্টার হয়, ৪০৩ থেকে নয়।** যে পর্দায় ঢোকার অনুমতি নেই
 *    সেটার নামটাই দেখানো হয় না — নইলে ম্যানেজার "সেটিংস" শব্দটা পড়ে বুঝে
 *    ফেলত কী কী তার নাগালের বাইরে আছে, আর চেপে "অনুমতি নেই" খেয়ে ভাবত
 *    কিছু ভেঙেছে। পেজের ৪০৩ পর্দাগুলো শেষ রক্ষাকবচ, প্রথম নয়।
 *
 * ⚠️ **`/staff` তালিকা-ট্যাবটা সরানো হয়েছে।** স্পেক § ৫-এ ছ-টা পর্দা, আর
 *    "স্টাফ তালিকা" তাদের একটাও নয় — কর্মী যোগ/সম্পাদনা সেটিংসের স্টাফ
 *    ট্যাবে (owner-only)। `/staff/:id` রুটটা আছে, কিন্তু সেখানে যাওয়ার পথ
 *    লাইভ বোর্ডের কার্ড। খালি `/staff` কোনো পর্দা নয়, তাই ট্যাবটা রাখলে
 *    "পাওয়া যায়নি"-তে গিয়ে ঠেকত।
 *
 * ⚠️ স্টাফের জন্য একটাই ট্যাব — সার্ভারে তার জন্য `/screenshots` ছাড়া আর
 *    কোনো ড্যাশবোর্ড endpoint খোলা নেই। একটা ট্যাবের সারি দেখতে ফাঁকা লাগে,
 *    কিন্তু চারটে ট্যাবের তিনটেয় ৪০৩ পাওয়ার চেয়ে সেটা ভালো।
 */
const NAV: NavItem[] = [
  {
    to: '/',
    label: 'Live Board',
    end: true,
    roles: ['owner', 'manager'],
  },
  /**
   * ⭐ **J05** — স্টাফের নিজের পাতা। নামটা tray-র মেনু আইটেমের সাথে
   * **হুবহু এক** ("My data") — দুই জায়গায় দু-রকম নাম হলে স্টাফ ভাবত
   * দুটো আলাদা জিনিস।
   *
   * ⚠️ শুধু স্টাফের জন্য নেভে দেখানো হয়: owner/manager-এর
   * `users.employee_id` সাধারণত null, তাই তাঁদের কাছে পাতাটা ৪০৩ হতো।
   * (রুটটা তবু সবার জন্য খোলা — যিনি সত্যিই কর্মী, তিনি সরাসরি গিয়ে
   * দেখতে পারবেন।)
   */
  { to: '/me', label: 'My data', roles: ['employee'] },
  /**
   * ⭐ মকআপ ক-এর সাইডবারে Live Board-এর ঠিক পরেই।
   *
   * ⚠️ এখানে আগে লেখা ছিল ট্যাবটা "সরানো হয়েছে" — কারণ `/staff` বলে
   *    কোনো পাতা ছিল না, ট্যাবটা "পাওয়া যায়নি"-তে ঠেকত। এখন পাতাটা
   *    আছে (`StaffPage`), তাই ট্যাবটাও ফিরল।
   * ⚠️ **Settings → Staff-এর নকল নয়**: ওখানে সম্পাদনা, এখানে দেখা।
   */
  { to: '/staff', label: 'Staff', roles: ['owner', 'manager'] },
  {
    to: '/screenshots',
    label: 'Screenshots',
    roles: ['owner', 'manager', 'employee'],
  },
  /**
   * ⚠️ শুধু "Monthly" — "Monthly progress" নয়। নেভের সব ট্যাব এক-দুই শব্দে,
   *    আর ৩৭৫px-এ লম্বা লেবেলগুলোই প্রথমে সারিটাকে স্ক্রল করায়।
   */
  { to: '/monthly', label: 'Monthly', roles: ['owner', 'manager'] },
  { to: '/reports', label: 'Reports', roles: ['owner', 'manager'] },
  /**
   * ⭐ **R21 — জামানত।** Monthly ও Reports-এর ঠিক পরে, কারণ তিনটেই একই
   * প্রশ্নের দিক: **টাকা কোথায় দাঁড়িয়ে আছে।**
   *
   * ⚠️ আগে এটা `Settings → Deposits` ট্যাব ছিল। সেটিংসে যা থাকে তা একবার
   * বসিয়ে ভুলে যাওয়ার জিনিস (নীতি, ছুটি, ক্যাটাগরি); জামানতের হিসাবে
   * ঢুকতে হয় বারবার, আর প্রতিবার আটটা ট্যাবের ভেতর খোঁজা অকারণ ঘষা।
   *
   * ⚠️⚠️ owner-only, ম্যানেজারও নয় — সরাসরি বেতনের অংশ (ADR-023 · ADR-027)।
   */
  { to: '/deposits', label: 'Deposits', roles: ['owner'] },
  /**
   * ⚠️ owner-only — অ্যালার্টে হোস্টনেম, কর্মীর নাম আর ডিভাইসের অবস্থা
   * একসাথে থাকে (§ ৪.৩)। ম্যানেজারকে ব্যাজটাও দেখানো হয় না।
   */
  { to: '/alerts', label: 'Alerts', roles: ['owner'], section: 'Oversight' },
  // ⚠️ owner-only — `App.tsx`-এ রুটটাও শুধু owner-এর জন্যই বসে
  // ⭐ ম্যানেজারও ঢোকেন *(১৫ আগস্ট)* — Staff · Categories · Policies &
  //    holidays, এই তিনটে ট্যাব তাঁর। বাকিগুলো `SettingsPage` নিজেই
  //    role দেখে সরিয়ে রাখে।
  /**
   * ⭐ I06 — **তিনটে ভূমিকারই**, owner-only নয়: এটা ট্র্যাকিংয়ের পর্দা নয়,
   *    নিজের অ্যাকাউন্টের 2FA সেটিং। owner-only করলে ম্যানেজারের অ্যাকাউন্ট
   *    — যার হাতে সবার ডেটা — কোনোদিন 2FA পেত না।
   *
   * ⚠️ ইচ্ছাকৃতভাবে **সবার শেষে**, সেটিংসের পরেও: এটা রোজকার কাজের পর্দা
   *    নয়, বছরে দু-একবার খোলার জায়গা।
   */
  { to: '/security', label: 'Security', roles: ['owner', 'manager', 'employee'] },
  { to: '/settings', label: 'Settings', roles: ['owner', 'manager'] },
];

/**
 * ⚠️ ভূমিকার নাম **সার্ভারের `role` মান নয়**, পর্দার লেখা। `employee` →
 *    "Staff", কারণ পুরো ড্যাশবোর্ডে মানুষগুলোকে Staff বলা হয় (অভিধান § ১)।
 */
/**
 * ঢাকার তারিখ ও ঘড়ি — `15 Aug 2026 · 18:40`।
 *
 * ⚠️ UTC+৬ যোগ করে ISO থেকে কাটা হয়, `toLocaleString` দিয়ে নয় — মেশিনের
 *    টাইমজোন বা লোকেল যাই হোক ফলটা এক থাকে।
 * ⚠️ সেকেন্ড নেই: প্রতি সেকেন্ডে বদলানো একটা সংখ্যা চোখ টানে, অথচ বোর্ড
 *    রিফ্রেশ হয় ৩০ সেকেন্ডে — ঘড়িটা তখন ডেটার চেয়ে তাজা দেখাত।
 */
function dhakaStamp(): string {
  const d = new Date(Date.now() + 6 * 3600_000);
  const iso = d.toISOString();
  const [y, m, day] = iso.slice(0, 10).split('-');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y} · ${iso.slice(11, 16)}`;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'Staff',
};

export function Layout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  /**
   * ⭐ না-দেখা অ্যালার্টের সংখ্যা — নেভের ব্যাজের জন্য।
   *
   * ⚠️ owner ছাড়া কেউ ডাকে না (`listAlerts` owner-only), নইলে ম্যানেজারের
   *    ব্রাউজার প্রতি দু-মিনিটে একটা করে ৪০৩ কুড়াত।
   * ⚠️ ব্যর্থ হলে `undefined` — ০ নয়। সংখ্যাটা না জানলে নেভ চুপ থাকে,
   *    "কোনো অ্যালার্ট নেই" বলে না।
   */
  const alerts = usePolling(
    (signal) =>
      user?.role === 'owner'
        ? listAlerts({ limit: 1 }, signal)
        : Promise.resolve(null),
    ALERT_BADGE_MS,
    [user?.role],
  );

  const nav = user
    ? NAV.filter((item) => item.roles.includes(user.role)).map((item) =>
        item.to === '/alerts'
          ? { ...item, badge: alerts.data?.total }
          : item,
      )
    : [];

  return (
    <div className="flex min-h-full flex-col">
      {/*
        লোগোর গাঢ় ফিল্ড — `chrome`, `paper` নয়।

        ⭐ E13 — এটা পটভূমি নয়, **লোগোর ফিল্ড**: লোগোটা কালোর উপরেই আঁকা,
           তাই থিমের সাথে উল্টে গেলে ব্র্যান্ডটাই বদলে যেত। `chrome`
           টোকেনটা তাই দুই থিমেই গাঢ় (ডার্কে #000, লাইটে #191c22)।
        ⚠️ এর উপরের লেখা তাই `text-white`, `text-on-ink` নয় — ফিল্ডটা
           কখনো হালকা হয় না, তাই উল্টে যাওয়ার কিছু নেই।

        ⚠️ E12 — `flex-wrap` **রাখা হয়েছে**: ফোনে নাম-ভূমিকার ব্লক আর
           দুটো বোতাম দরকার হলে নিজের সারিতে নামে। লম্বা নামে ৩৭৫px-এ
           সবকিছু এক সারিতে চেপে গিয়ে অপঠ্য হতো।
           ⭐ এখানে একসময় গ্লোবাল সার্চের বাক্সও ছিল (E14) — মালিকের
           পছন্দ হয়নি বলে সরানো হয়েছে; কম্পোনেন্টটা `GlobalSearch.tsx`-এ
           আছে, কোথাও বসানো নেই ([G127](../../../docs/08-Gap-Analysis.md))।
      */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-chrome px-4 py-2.5 text-white">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="leading-tight">
            <Wordmark className="text-[15px]" />
            <div className="text-[11px] text-white/55">Workforce Monitor</div>
          </div>
        </div>

        {/*
          ⭐ মকআপ ক-এর উপরের বারে **ঢাকার তারিখ ও ঘড়ি**, লোগোর পাশেই।

          ⚠️⚠️ ঘড়িটা **ঢাকার**, ব্রাউজারের নয় — গোটা অ্যাপের প্রতিটা সংখ্যা
          ঢাকার কর্মদিবস ধরে, তাই এখানে স্থানীয় সময় দেখালে বিদেশ থেকে
          দেখা কারো কাছে বার আর কার্ড দুটো আলাদা দিনের কথা বলত।

          ⚠️ `LIVE` ব্যাজ ও Refresh/Reports বোতাম এখানে **আনা হয়নি**,
          যদিও মকআপে ওগুলোও এই সারিতে। কারণ এই বারটা **সব পাতায়** থাকে,
          আর ওই তিনটে জিনিস কেবল Live Board-এর: Settings বা Reports
          পাতায় বসে "LIVE" জ্বললে সেটা এমন একটা তাজা-ভাব দাবি করত যা
          ওই পাতার নেই। তাই ওগুলো বোর্ডের নিজের শিরোনামেই থাকল।

          ⚠️ ফোনে লুকানো (`hidden sm:block`) — ৩৭৫px-এ নাম, ভূমিকা, থিম
          আর সাইন-আউট এমনিতেই সারিটা ভরে ফেলে।
        */}
        <div className="hidden text-[11.5px] text-white/55 sm:block">
          Dhaka · <span className="num">{dhakaStamp()}</span>
        </div>

        {/*
          ⭐⭐ **পাতার নিজস্ব জিনিস উপরের বারে বসানোর ঘর** — মকআপ ক-এ
          `LIVE` ব্যাজ ও বোতামগুলো এই সারিতেই ছিল।

          ⚠️⚠️ ঘরটা **খালি**, আর ভরে দেয় পাতা নিজে (`TOPBAR_SLOT_ID`-তে
          portal করে)। এটাই একমাত্র উপায় যাতে মকআপের বিন্যাসটা পাওয়া যায়
          অথচ বারটা মিথ্যা না বলে: বারটা **সব পাতায়** থাকে, তাই এখানে
          সরাসরি `LIVE` লিখে দিলে Settings বা Reports পাতায় বসেও সবুজ
          বিন্দু জ্বলত — এমন একটা তাজা-ভাব দাবি করত যা ওই পাতার নেই।

          ⭐ Live Board ছাড়া অন্য পাতায় কেউ কিছু বসায় না, তাই ঘরটা তখন
          শূন্য প্রস্থ নেয় — কোনো ফাঁকা জায়গাও দেখা যায় না।
        */}
        <div id={TOPBAR_SLOT_ID} className="flex items-center gap-2" />

        <div className="ml-auto flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-[12.5px] font-medium">{user?.fullName}</div>
            <div className="text-[11px] text-white/55">
              {user ? (ROLE_LABEL[user.role] ?? user.role) : ''}
            </div>
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void signOut()}
            // ⚠️ `tap` — ফোনে ৪৪px (`index.css`)। ছিল ~২৯px, আর টপবারের
            //    ডান কোণায় থিম-টগলের গা ঘেঁষে — ভুল চাপে লগআউট হয়ে যেত।
            className="tap rounded-md border border-white/20 px-2.5 py-1.5 text-xs text-white/85 transition hover:border-brand hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ⚠️ E12 — ফোনে সারিটা নিজেই আড়াআড়ি স্ক্রল করে, পুরো পাতা নয় */}
      {/*
        ⚠️ `overflow-y-hidden` — `Tabs.tsx`-এর সাথে একই কারণে। Tailwind-এর
           `overflow-x-auto` দুই অক্ষেই `auto` বসায়, আর ভেতরের লিঙ্ক এক
           পিক্সেল উঁচু হলেই Windows-এ তীরসহ উল্লম্ব scrollbar বেরিয়ে আসে।
           এখানে আজ বার নেই, কিন্তু ফাঁদটা হুবহু এক — একই সারিতে একটা লিঙ্ক
           যোগ হলেই ফিরে আসত।
      */}
      <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line bg-surface px-2 lg:hidden">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            // ⚠️ `tap` — ফোনে ৪৪px (`index.css`)। এটাই অ্যাপের প্রধান
            //    নেভিগেশন, অর্থাৎ ফোনে সবচেয়ে বেশি ছোঁয়া জিনিস।
            className={({ isActive }) =>
              `tap whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition ${
                isActive
                  ? 'border-brand font-semibold text-brand-ink'
                  : 'border-transparent text-ink-2 hover:text-ink'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1">
        {/*
          ⭐⭐ **সাইডবার — শুধু `lg`-এর উপরে।**

          ⚠️ উপরের আড়াআড়ি সারিটা মুছে ফেলা হয়নি, `lg:hidden` করা হয়েছে —
             ফোনে ওটাই থাকে। কারণ সরু পর্দায় সাইডবার মানে হয় সবসময় খোলা
             (তখন কনটেন্টের জন্য ২০০px কমে যেত), নয় একটা drawer (নতুন
             অবস্থা, নতুন বোতাম, নতুন ফাঁদ)। দুটোর কোনোটাই ফোনে ভালো নয়,
             আর ওখানে আড়াআড়ি সারিটা ইতিমধ্যেই কাজ করে ও ছোঁয়ার মাপ ঠিক
             (G124)। এক জিনিস দু-জায়গায় দু-রকম হওয়াই এখানে সঠিক উত্তর।

          ⚠️ `min-h-0` না দিলে flex সন্তান নিজের কনটেন্টের চেয়ে ছোট হতে
             পারত না, আর লম্বা টেবিলে সাইডবারটা পর্দার সাথে না থেকে
             পাতার সাথে লম্বা হয়ে যেত।
        */}
        <nav
          aria-label="Sections"
          className="hidden w-44 shrink-0 border-r border-line bg-surface p-2 lg:block"
        >
          {nav.map((item) => (
            <div key={item.to}>
              {/* ⭐ মকআপের `.side .grp` — ৮.৫px, বড় হাতের, ফাঁকা-অক্ষরে */}
              {item.section && (
                <div className="mt-3 mb-1 px-2.5 text-[9px] tracking-[0.1em] text-ink-3 uppercase">
                  {item.section}
                </div>
              )}
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `mb-0.5 flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-[13px] transition ${
                    isActive
                      ? 'bg-ok/10 font-semibold text-ok-ink'
                      : 'text-ink-2 hover:bg-paper hover:text-ink'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                {/*
                  ⭐ মকআপ ক-এর বিন্দু। ⚠️ এটা **সাজসজ্জা নয়, প্রান্তিককরণ**:
                     বিন্দুগুলো এক খাড়া রেখায় বসে বলে চোখ তালিকাটা এক নজরে
                     পড়তে পারে, আর সক্রিয় আইটেমটা রং বদলালে সেটা লেখার
                     আগেই ধরা পড়ে।
                  ⚠️ `aria-hidden` — স্ক্রিন রিডারের কাছে বিন্দুটার কোনো
                     মানে নেই, নামটাই যথেষ্ট।
                */}
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${
                      isActive ? 'bg-ok' : 'bg-ink-3/45'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {/*
                  ⚠️ `> 0` — শূন্য হলে ব্যাজ **বসেই না**। "0" লেখা একটা ব্যাজ
                     চোখ টানে ঠিক যতটা "3" লেখাটা টানে, অথচ বলার মতো কিছু নেই।
                  ⭐ রংটা **লাল**, মকআপের মতোই। ⚠️ এটা বোর্ডের "একটাই লাল
                     টাইল" নিয়মের বিরুদ্ধে নয় — ওই নিয়ম **এক পর্দার ভেতরের**
                     KPI সারির, আর নেভ প্রতিটা পাতায় থাকে। এখানে সংখ্যাটার
                     একমাত্র কাজই হলো "অ্যালার্ট পাতায় যান" বলা; নিরপেক্ষ
                     রঙে সেটা আর কারো চোখেই পড়ত না।
                */}
                {item.badge != null && item.badge > 0 && (
                      <span className="num rounded-full bg-brand-bg px-1.5 py-px text-[10.5px] font-semibold text-brand-ink">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            </div>
          ))}
        </nav>

        {/*
          ⚠️ `min-w-0` — flex সন্তানের ডিফল্ট `min-width: auto`, অর্থাৎ সে
             নিজের সবচেয়ে চওড়া কনটেন্টের চেয়ে ছোট হতে চায় না। এটা না দিলে
             একটা চওড়া টেবিল পুরো লেআউটটাকে ঠেলে বড় করে দিত আর গোটা পাতা
             আড়াআড়ি স্ক্রল করত — ঠিক যেটা টেবিলের নিজের ফ্রেমে স্ক্রল
             করানোর পুরো উদ্দেশ্য ছিল ঠেকানো।
        */}
        <main className="min-w-0 flex-1 px-4 py-5">
          {/*
            ⭐ ভেতরে, বাইরে নয় — কোনো পেজ render-এ ছুড়ে ফেললেও হেডার ও নেভ
               টিকে থাকে, তাই ব্যবহারকারী অন্য ট্যাবে সরে যেতে পারে। বাইরে
               বসালে পুরো পর্দা একটা এরর বাক্স হয়ে যেত আর বেরোনোর কোনো পথ
               থাকত না। `resetKey` রুট — পাতা বদলালেই নিজে থেকে সেরে ওঠে।
          */}
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
