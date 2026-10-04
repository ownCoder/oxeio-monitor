import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { listAlerts } from '../api/alerts';
import type { Role } from '../api/auth';
import { usePolling } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Wordmark } from './Brand';
import '../studio.css';
import { ErrorBoundary } from './ErrorBoundary';
import { ThemeToggle } from './ThemeToggle';
import { workOffsetMs, workTimeZoneLabel } from '../lib/format';

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
   * ⭐⭐ **ভূমিকা ছাড়াও একটা বাড়তি শর্ত** *(২২ আগস্ট)*।
   *
   * ⚠️⚠️ Targets পাতাটা গবেষকও দেখেন, আর তাঁর ভূমিকা `employee` — অর্থাৎ
   * `roles`-এ `employee` বসালে **সব কর্মী** ওটা দেখতেন। ⭐ তাই সার্ভারের
   * তৈরি উত্তরটা (`canAddTargets`) দেখা হয়; নিয়মটা ওয়েবে আবার লেখা
   * হয় না, নইলে একদিন মেনু দেখা যেত অথচ পাতা ৪০৩ দিত।
   */
  when?: (user: { canAddTargets: boolean }) => boolean;
  /**
   * ⭐ মকআপ ক-এর ভাগের লেবেল — এই আইটেমটার **ঠিক আগে** বসে।
   *
   * ⚠️ কেবল সাইডবারে (`lg`-এর উপরে)। ফোনের আড়াআড়ি সারিতে ভাগের লেবেল
   *    মানে ট্যাবের মাঝে একটা লেখা যেটা চাপা যায় না — সরু পর্দায় ওটা
   *    জায়গা খায় আর ট্যাব বলে ভুল হয়।
   */
  section?: string;
  /**
   * ⭐ ভাগের **ভেতরের** আইটেম — একটু ডানে সরে বসে *(২৩ আগস্ট)*।
   *
   * ⚠️ শুধু শিরোনাম দিলে "নিচে আছে" ব্যাপারটা যথেষ্ট চোখে পড়ে না;
   * সরিয়ে বসালে চোখ এক নজরেই দেখে কোনটা কার অধীনে।
   */
  child?: boolean;
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
   * ⭐⭐ **Worklog** — কার্ডগুলো, Live Board-এর নিচ থেকে সরিয়ে আনা
   * *(১৭ আগস্ট, মালিকের অনুরোধে)*।
   *
   * ⚠️ Live Board-এর **ঠিক পরে**, কারণ প্রশ্ন দুটো পাশাপাশি: বোর্ড বলে
   * "দল আজ কেমন করছে", Worklog বলে "এই মুহূর্তে কে কাজ করছে"। মাঝে অন্য
   * কিছু বসালে দ্বিতীয়টা খুঁজতে হতো।
   */
  {
    to: '/worklog',
    label: 'Worklog',
    roles: ['owner', 'manager'],
  },
  /**
   * ⭐⭐ **Targets** *(২২ আগস্ট)* — গবেষকের রোজকার পাতা।
   *
   * ⚠️⚠️ **সাইডবারে, Settings-এ নয়** (মালিকের সিদ্ধান্ত): এখানে **রোজ**
   * আসতে হয়, আর Settings একবার বসিয়ে ভুলে যাওয়ার জায়গা। Deposits-ও
   * ঠিক এই কারণেই সাইডবারে (09 § ৩ঃ)।
   *
   * ### ⭐⭐ এখানে যে হ্যাকটা ছিল, আর কেন সেটা মুছে গেল
   *
   * আগে লেখা ছিল `roles: ['owner','manager','employee']` তার সাথে
   * `when: (user) => user.canAddTargets`, আর টীকায় স্বীকারোক্তি:
   * *"`employee` আছে **কেবল গবেষকের জন্য**, আসল ছাঁকনিটা `when`"*।
   *
   * ⚠️⚠️ কারণটা ছিল বাধ্যবাধকতা, পছন্দ নয়: পোর্টালের রোল ছিল তিনটে,
   * আর গবেষক ঢুকতেন `employee` হিসেবে। তালিকায় `employee` না লিখলে
   * তিনি বাদ পড়তেন, লিখলে **ন-জন ডিজাইনারও** মেনুতে এটা দেখতেন।
   *
   * ⭐ ২৫ আগস্ট মালিক রোলটাই আলাদা করে দিলেন *("researcher and designer
   * same kaj kore na")*, তাই তালিকাটা এখন সত্যি কথাই বলে — আর দুটো
   * জায়গার বদলে **একটা** জায়গা পাহারা দেয়।
   */
  /**
   * ⭐ দুটো পাতা **একটা ভাগের নিচে** *(২৩ আগস্ট, মালিকের সিদ্ধান্ত)* —
   * `Oversight → Alerts`-এর মতোই। ⚠️ ভাগের লেবেলটা কেবল সাইডবারে
   * (`lg`-এর উপরে) দেখা যায়, তাই আইটেমের নাম দুটো **নিজেরাই** যথেষ্ট
   * হতে হবে: ফোনের আড়াআড়ি সারিতে "Add targets"/"All targets" একা
   * দাঁড়িয়েও বোঝা যায়।
   *
   * ⚠️ নাম দুটোয় আর "Design" নেই — ভাগের শিরোনামেই ওটা লেখা, আর
   * "Targets → Add Design Targets" পড়তে দুবার একই কথা।
   */
  {
    to: '/targets',
    label: 'Add target design',
    roles: ['owner', 'manager', 'researcher'],
    section: 'Targets',
    child: true,
  },
  {
    to: '/targets/all',
    label: 'Design Pool',
    roles: ['owner', 'manager', 'researcher'],
    child: true,
  },
  /**
   * ⭐⭐ **Review** *(মালিকের নির্দেশ, ৩১ আগস্ট ২০২৬)* — Design Pool-এর
   * ঠিক নিচে।
   *
   * ⚠️ গবেষক নেই: ডিজাইনার কেন Skip দিলেন সেটা **দল সামলানোর** প্রশ্ন,
   * আর সার্ভারের `@Roles(owner, manager)`-এর সাথে এটাই মেলে।
   */
  {
    to: '/targets/review',
    label: 'Review',
    roles: ['owner', 'manager'],
    child: true,
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
  /**
   * ⚠️⚠️ **এই শিরোনামটা কেবল সাজসজ্জা নয় — এটাই উপরের ভাগটা বন্ধ করে।**
   * ভাগের লেবেল কেবল **শুরু** চিহ্নিত করে, শেষ নয়; তাই "Targets"-এর পরে
   * কোনো শিরোনাম না থাকলে My data · Staff · Screenshots — সবই ওই
   * ভাগের ভেতরে বলে মনে হতো *(২৩ আগস্ট)*।
   */
  /**
   * ⚠️⚠️ `researcher`-ও এখানে — গবেষকদেরও এজেন্ট আছে, তাঁরাও মাপা হন
   * (২৫ আগস্ট যাচাই করা: OX-04 ও OX-05 দুজনেরই সক্রিয় ডিভাইস)। ব্যক্তিগত
   * পাতা কাজের ধরনের সাথে বাঁধা নয়।
   *
   * ⭐⭐ `manager`-ও এখানে *(২৬ আগস্ট)* — আর এটা ছাড়া ওই দিনের গোটা
   * কাজটাই অর্থহীন হতো। অফিসের ম্যানেজার এখন রোজ ৩০টা ডিজাইন পান
   * (`DESIGN_WORK_STAFF_TYPES`), কিন্তু তালিকাটা **এই পাতাতেই**। মেনুতে
   * লিঙ্কটা না থাকলে তাঁর কাছে রোজ ৩০টা কাজ যেত আর তিনি সেগুলো
   * খুঁজেই পেতেন না — URL হাতে টাইপ করা ছাড়া।
   *
   * ⚠️ পুরোনো টীকা বলত owner/manager-এর `employee_id` সাধারণত `null`
   * তাই পাতাটা তাঁদের কাছে ৪০৩ হতো। ⭐ সেটা আর সত্যি নয়: কর্মী-সারির
   * সাথে যুক্ত নন এমন কেউ ঢুকলে একটা বন্ধুসুলভ খালি বাক্স পান
   * (`MyDataPage`), এরর নয়। owner এখনো বাইরে — তাঁর কর্মী-সারি নেই।
   */
  {
    to: '/me',
    label: 'My data',
    roles: ['manager', 'researcher', 'employee'],
    section: 'Team',
  },
  /**
   * ⭐ মকআপ ক-এর সাইডবারে Live Board-এর ঠিক পরেই।
   *
   * ⚠️ এখানে আগে লেখা ছিল ট্যাবটা "সরানো হয়েছে" — কারণ `/staff` বলে
   *    কোনো পাতা ছিল না, ট্যাবটা "পাওয়া যায়নি"-তে ঠেকত। এখন পাতাটা
   *    আছে (`StaffPage`), তাই ট্যাবটাও ফিরল।
   * ⚠️ **Settings → Staff-এর নকল নয়**: ওখানে সম্পাদনা, এখানে দেখা।
   */
  /**
   * ⚠️ owner/manager-এর তালিকায় `My data` থাকে না, তাই ভাগের শিরোনামটা
   * এখানেও লাগে — নইলে তাঁদের পর্দায় "Targets" ভাগটা কখনো বন্ধই হতো না।
   * ⭐ দুটোর একটাই দেখা যায়, তাই শিরোনাম দুবার বসে না।
   */
  { to: '/staff', label: 'Staff', roles: ['owner', 'manager'], section: 'Team' },
  /** ⚠️ গবেষক ও ডিজাইনার এখানে **নিজেরটাই** দেখেন — সার্ভার স্কোপ করে দেয় */
  {
    to: '/screenshots',
    label: 'Screenshots',
    roles: ['owner', 'manager', 'researcher', 'employee'],
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
  {
    to: '/security',
    label: 'Security',
    roles: ['owner', 'manager', 'researcher', 'employee'],
  },
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
  const d = new Date(Date.now() + workOffsetMs());
  const iso = d.toISOString();
  const [y, m, day] = iso.slice(0, 10).split('-');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y} · ${iso.slice(11, 16)}`;
}

/**
 * ⚠️⚠️ `Record<Role, ...>` — `Record<string, ...>` **নয়**, আর এই বদলটাই
 * এখানে আসল কাজ। আগে `string` লেখা ছিল, তাই ২৫ আগস্ট `researcher` রোল
 * যোগ করার সময় কম্পাইলার কিছুই বলেনি — পর্দার কোণে নামটা নীরবে
 * `researcher` (ছোট হাতের, কাঁচা মান) হয়ে ফুটত।
 * ⭐ এখন enum বাড়লে এখানেই এরর হবে।
 */
const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  researcher: 'Researcher',
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
    ? NAV.filter(
        (item) =>
          item.roles.includes(user.role) && (item.when?.(user) ?? true),
      ).map((item) =>
        item.to === '/alerts'
          ? { ...item, badge: alerts.data?.total }
          : item,
      )
    : [];

  const currentPage = [...nav].sort((a, b) => b.to.length - a.to.length)
    .find((item) => item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`))?.label ?? 'Workspace';
  const initials = user?.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('') ?? '';

  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <div className="studio-brand"><Wordmark /><small>Workforce<br />Monitor</small></div>
        <nav className="studio-nav" aria-label="Sections">
          <div className="studio-nav-label">Workspace</div>
          {nav.map((item) => (
            <div key={item.to}>
              {item.section && <div className="studio-nav-label">{item.section}</div>}
              <NavLink to={item.to} end={item.end} className="studio-nav-link">
                <span className="studio-nav-name"><span className="studio-nav-dot" aria-hidden />{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span className="num rounded-full bg-brand-bg px-1.5 text-xs text-brand-ink">{item.badge}</span>
                )}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="studio-user">
          <span className="studio-avatar" aria-hidden>{initials}</span>
          <div className="min-w-0 text-xs"><div>{user?.fullName}</div><div className="mt-1 text-ink-2">{user ? ROLE_LABEL[user.role] : ''}</div></div>
        </div>
      </aside>
      <div className="studio-workspace">
        <header className="studio-topbar">
          <div><span className="text-ink-2">Workspace / </span><span>{currentPage}</span></div>
          <div className="studio-topbar-actions">
            <span className="studio-topbar-time text-ink-2">{workTimeZoneLabel()} · {dhakaStamp()}</span>
            <ThemeToggle />
            <button type="button" onClick={() => void signOut()} className="tap px-3 py-1.5 text-xs">Sign out</button>
          </div>
        </header>
        <nav className="studio-mobile-nav" aria-label="Mobile sections">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="studio-nav-link">
              {item.label}
              {item.badge != null && item.badge > 0 && <span className="num text-brand-ink">{item.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <main className="studio-main">
          <ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary>
        </main>
      </div>
    </div>
  );
}