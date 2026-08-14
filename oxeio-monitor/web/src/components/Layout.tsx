import { NavLink, Outlet, useLocation } from 'react-router-dom';

import type { Role } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { BrandMark, Wordmark } from './Brand';
import { ErrorBoundary } from './ErrorBoundary';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** কোন ভূমিকা এই ট্যাবটা **দেখতে পাবে** */
  roles: Role[];
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
   * ⚠️ owner-only — অ্যালার্টে হোস্টনেম, কর্মীর নাম আর ডিভাইসের অবস্থা
   * একসাথে থাকে (§ ৪.৩)। ম্যানেজারকে ব্যাজটাও দেখানো হয় না।
   */
  { to: '/alerts', label: 'Alerts', roles: ['owner'] },
  // ⚠️ owner-only — `App.tsx`-এ রুটটাও শুধু owner-এর জন্যই বসে
  { to: '/settings', label: 'Settings', roles: ['owner'] },
  /**
   * ⭐ I06 — **তিনটে ভূমিকারই**, owner-only নয়: এটা ট্র্যাকিংয়ের পর্দা নয়,
   *    নিজের অ্যাকাউন্টের 2FA সেটিং। owner-only করলে ম্যানেজারের অ্যাকাউন্ট
   *    — যার হাতে সবার ডেটা — কোনোদিন 2FA পেত না।
   *
   * ⚠️ ইচ্ছাকৃতভাবে **সবার শেষে**, সেটিংসের পরেও: এটা রোজকার কাজের পর্দা
   *    নয়, বছরে দু-একবার খোলার জায়গা।
   */
  { to: '/security', label: 'Security', roles: ['owner', 'manager', 'employee'] },
];

/**
 * ⚠️ ভূমিকার নাম **সার্ভারের `role` মান নয়**, পর্দার লেখা। `employee` →
 *    "Staff", কারণ পুরো ড্যাশবোর্ডে মানুষগুলোকে Staff বলা হয় (অভিধান § ১)।
 */
const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'Staff',
};

export function Layout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const nav = user ? NAV.filter((item) => item.roles.includes(user.role)) : [];

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
      <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line bg-surface px-2">
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

      <main className="flex-1 px-4 py-5">
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
  );
}
