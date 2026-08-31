import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { VersionBadge } from './components/VersionBadge';
import { AlertsPage } from './pages/AlertsPage';
import { DepositsPage } from './pages/DepositsPage';
import { WorklogPage } from './pages/WorklogPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';
import { StaffPage } from './pages/StaffPage';
import { GalleryPage } from './pages/GalleryPage';
import { LiveBoardPage } from './pages/LiveBoardPage';
import { LoginPage } from './pages/LoginPage';
import { MonthlyPage } from './pages/MonthlyPage';
import { AllTargetsPage } from './pages/AllTargetsPage';
import { ReviewPage } from './pages/ReviewPage';
import { TargetsPage } from './pages/TargetsPage';
import { MyDataPage } from './pages/MyDataPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReportsPage } from './pages/ReportsPage';
import { SecurityPage } from './pages/security/SecurityPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { homePathFor, seesEveryone } from './api/auth';

/**
 * তিনটি অবস্থা, তিনটি আলাদা রুট-গাছ — তাই "লগইন করেনি অথচ ভেতরের পেজ দেখছে"
 * বা "পাসওয়ার্ড না বদলে ঘুরে বেড়াচ্ছে" — এমন কিছু সম্ভবই নয়।
 */
function Router() {
  const { user, loading, offline, refresh } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center text-sm text-ink-3">
        Loading…
      </div>
    );
  }

  /**
   * ⭐⭐ "সার্ভারে পৌঁছাতে পারিনি" আর "সেশন শেষ" — দুটো আলাদা কথা,
   * তাই দুটো আলাদা পর্দা।
   *
   * ⚠️ এখানে লগইন পর্দা দেখানো মানে ব্যবহারকারীকে একটা **মিথ্যা** বলা:
   *    তাঁর cookie দিব্যি বেঁচে আছে, শুধু প্লেনটা পৌঁছায়নি। হোমস্ক্রিনের
   *    PWA মোবাইল ডেটায় বারবার ঠান্ডা-চালু হয়, তাই ফোনে এটাই নিত্য ঘটনা
   *    হতো — আর পাসওয়ার্ড টাইপ করে সাবমিট না করা পর্যন্ত আসল কারণটা
   *    জানাই যেত না।
   */
  if (!user && offline) {
    return (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div className="max-w-xs">
          <p className="text-sm font-medium text-ink">No connection</p>
          <p className="mt-2 text-sm text-ink-3">
            Can’t reach the server. You are still signed in — this page will
            recover on its own once the connection is back.
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 rounded-md border border-line px-3 py-2 text-sm text-ink-2 hover:bg-surface-2"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  if (user.mustChangePassword) {
    return (
      <Routes>
        <Route path="*" element={<ChangePasswordPage />} />
      </Routes>
    );
  }

  const isOwner = user.role === 'owner';
  /**
   * ⭐ Settings-এর রুটটা ম্যানেজারেরও *(১৫ আগস্ট)* — তিনি Staff · Categories
   * · Holidays পান। ভেতরে কোন ট্যাব তিনি দেখবেন সেটা `SettingsPage`-এর কাজ।
   *
   * ⚠️⚠️ এটা আলাদা চলক, `isOwner || isManager` নয়: **নেভ, রুট আর পর্দা —
   * তিন জায়গায় একই শর্ত থাকতে হয়**। মাঠে ধরা পড়েছে ঠিক এই ফাঁকটাই —
   * `Layout`-এর নেভ আর `SettingsPage` দুটোই ম্যানেজারকে ঢুকতে দিচ্ছিল,
   * কিন্তু রুটটা owner-only থেকে গিয়েছিল; ম্যানেজার নেভে Settings দেখতেন,
   * চাপলে **"Not found"**।
   */
  const mayOpenSettings = isOwner || user.role === 'manager';
  /**
   * ⚠️ সার্ভারের গার্ড পড়ে দেখা: স্টাফের জন্য `/screenshots` ও `/me`
   *    **ছাড়া** আর কোনো ড্যাশবোর্ড endpoint খোলা নেই (`live`, `employees`,
   *    `activity`, `reports` — সবগুলোয় ক্লাস-লেভেল `@Roles(owner, manager)`)।
   *    তাই লগইনের পর তাকে লাইভ বোর্ডে নামালে প্রথম যা দেখত তা একটা ৪০৩ বাক্স।
   */
  /**
   * ⚠️⚠️ নামটা `isStaff` **থাকল**, সূত্রটা উল্টে গেছে *(২৫ আগস্ট)*।
   * আগে লেখা ছিল `role === 'employee'`, তাই `researcher` রোল আসার পর
   * গবেষক আর "স্টাফ" থাকতেন না — তিনি লাইভ বোর্ডে নামতেন, আর সেখানে
   * তাঁর জন্য একটা ৪০৩ বাক্স ছাড়া কিছুই নেই।
   * ⭐ প্রশ্নটা আসলে *"ইনি কি গোটা দল দেখেন না?"* — সেটাই এখন লেখা।
   */
  const isStaff = !seesEveryone(user.role);

  /**
   * ⭐ Worklog — Live Board-এর মতোই owner ও manager।
   *
   * ⚠️⚠️ `mayOpenSettings`-এর মতোই **আলাদা নাম**, `!isStaff` নয়। শর্তটা
   * তিন জায়গায় থাকে (নেভ · রুট · পর্দা), আর নাম না দিলে একদিন একটা
   * বদলাত আর বাকি দুটো নয় — G134-এ ঠিক সেটাই ঘটেছিল।
   */
  const mayOpenWorklog = isOwner || user.role === 'manager';

  /**
   * ⭐⭐ **গবেষক লগইন করে নিজের কাজের তালিকায় নামেন** *(২৪ আগস্ট ২০২৬)*।
   *
   * ⚠️⚠️ আগে তিনিও `/me`-তে নামতেন — চারটে **ঘণ্টার** টাইল, একটাও তাঁর
   * কাজের নয়। দিনের প্রথম পর্দাটাই বলত *"তোমাকে মাপা হচ্ছে"*, আর তাঁর
   * উৎপাদনের কথা কিছুই বলত না। ⭐ মাঠের ফল: দুজন গবেষকের **শেষ লগইন
   * ১৩ আগস্ট** — সিস্টেম চালুর দিন, তারপর আর ফেরেননি।
   *
   * ⚠️ এখানে আগে লেখা ছিল `user.canAddTargets ? ... : '/me'` — তখন
   * "ইনি গবেষক" কথাটা ওই পতাকাটাই বহন করত, কারণ রোল ছিল `employee`।
   * ⭐ ২৫ আগস্ট রোলটা আলাদা হলো, তাই প্রশ্নটা এখন সরাসরি — আর সূত্রটা
   * `homePathFor`-এ **এক জায়গায়**, "পাওয়া যায়নি" পাতাটাও সেটাই পড়ে।
   */
  const staffLanding = homePathFor(user.role);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            /*
              ⭐ স্টাফ নামে **নিজের পাতায়**, গ্যালারিতে নয়। আগে গ্যালারিই
              ছিল (তখন আর কিছু ছিল না), কিন্তু লগইনের পর প্রথম যা দেখা
              দরকার তা নিজের ছবির গ্রিড নয় — নিজের ঘণ্টা।
            */
            isStaff ? <Navigate to={staffLanding} replace /> : <LiveBoardPage />
          }
        />

        {/*
          ⭐⭐ **Staff তালিকা** *(মালিকের চাওয়া, ১৫ আগস্ট — মকআপ ক-এর
             সাইডবারে ওটা আছে)*।

          ⚠️ এখানে আগে লেখা ছিল "`staff` বলে কোনো তালিকা-পর্দা নেই" — আর
             সেটাই ছিল সাইডবার থেকে ট্যাবটা তুলে দেওয়ার কারণ। এখন পাতাটা
             আছে, তাই ট্যাবটাও ফিরেছে।

          ⚠️ owner + manager — `/live` থেকেই ডেটা আসে, আর ওই endpoint
             স্টাফের জন্য ৪০৩। নেভেও তাই কেবল দুজনের।
        */}
        {(isOwner || user?.role === 'manager') && (
          <Route path="staff" element={<StaffPage />} />
        )}
        <Route path="staff/:id" element={<EmployeeDetailPage />} />

        {/*
          ⭐ **J05 · J08** — tray-র "My data" মেনু ঠিক এখানেই নামে
          (`StaffPortalUrl`)। পাতাটা না থাকায় ওই মেনুটা এতদিন ৪০৪ দেখাত।

          ⚠️ রুটটা **সব ভূমিকার জন্য**, `isStaff &&` দিয়ে ঘেরা নয় — owner
          বা manager নিজেও একজন কর্মী হতে পারেন (`users.employee_id`
          বসানো)। যাঁর সেটা নেই, সার্ভার তাঁকে পরিষ্কার ৪০৩ বলে, আর
          পাতাটা সেটাই দেখায়।
        */}
        <Route path="me" element={<MyDataPage />} />

        {/*
          ⭐ Targets *(২২ আগস্ট)* — গবেষক · ম্যানেজার · মালিক।

          ⚠️ রুটটা **সবার জন্য খোলা**, আর সেটা ইচ্ছাকৃত: আসল পাহারা
             সার্ভারে (`assertCanSubmit` → ৪০৩)। কেউ ঠিকানা টাইপ করে
             এলে পাতাটা সার্ভারের বার্তাই দেখাবে, আর সেটাই এই কোডবেসের
             নিয়ম — পর্দায় লুকানো প্রথম রক্ষাকবচ, শেষ নয়।
        */}
        <Route path="targets" element={<TargetsPage />} />
        <Route path="targets/all" element={<AllTargetsPage />} />
        {/*
          ⚠️ owner + manager — সাইডবার, এই রুট আর সার্ভারের
             `@Roles(owner, manager)` তিন জায়গাতেই এক (G134-এর শিক্ষা:
             তিনটের একটা বদলালে বাকি দুটোও বদলাতে হয়)।
        */}
        <Route path="targets/review" element={<ReviewPage />} />

        <Route path="screenshots" element={<GalleryPage />} />
        <Route path="monthly" element={<MonthlyPage />} />
        <Route path="reports" element={<ReportsPage />} />

        {/*
          ⭐ I06 — শর্ত ছাড়া, **সব ভূমিকার জন্য**। নিজের অ্যাকাউন্টের 2FA
             চালু করা কোনো বিশেষাধিকার নয়; স্টাফও নিজের অ্যাকাউন্ট রক্ষা
             করতে পারবে। (এটা তার উপর নজরদারির কোনো নতুন পথ খোলে না —
             পাতাটা শুধু তার নিজের লগইন নিয়ে।)
        */}
        <Route path="security" element={<SecurityPage />} />

        {/*
          ⚠️ owner না হলে রুটটা **থাকেই না** — সেটিংসের মতোই। অ্যালার্টে
          হোস্টনেম, কর্মীর নাম আর ডিভাইসের অবস্থা একসাথে থাকে, আর
          সেগুলো ম্যানেজারের নাগালের বাইরে (স্পেক § ৪.৩)।
        */}
        {isOwner && <Route path="alerts" element={<AlertsPage />} />}

        {/*
          ⭐ **R21** — জামানত আগে `Settings → Deposits` ট্যাব ছিল, এখন
             সাইডবারের নিজের পাতা। সেটিংসে যা থাকে তা একবার বসিয়ে ভুলে
             যাওয়ার জিনিস; জামানতের হিসাবে ঢুকতে হয় বারবার।

          ⚠️ alerts-এর মতোই owner না হলে রুটটা **থাকেই না** — জামানত
             সরাসরি বেতনের অংশ (ADR-023 · ADR-027)।
        */}
        {/*
          ⚠️ owner **ও** manager — `/live`-এর `@Roles`-এর সাথে হুবহু এক।
             G134-এর শিক্ষা: এক অধিকার তিন জায়গায় (নেভ · রুট · পর্দা), আর
             তিনটেই না মিললে ব্যবহারকারী নেভে দেখেন কিন্তু চাপলে "কিছু নেই"।
        */}
        {mayOpenWorklog && <Route path="worklog" element={<WorklogPage />} />}
        {isOwner && <Route path="deposits" element={<DepositsPage />} />}

        {/*
          ⭐ যাঁর অধিকার নেই তাঁর জন্য রুটটা **থাকেই না** — সরাসরি
             `/settings` টাইপ করলে "পাওয়া যায়নি" আসে, ৪০৩ নয়। ৪০৩ বললে
             উল্টো স্বীকার করা হতো যে পর্দাটা আছে। (`createRoutesFromChildren`
             non-element চাইল্ড নীরবে বাদ দেয়, তাই `false` বসানো নিরাপদ —
             v7-এর ডকুমেন্টেড আচরণ, ঠিক এই ধরনের শর্তের জন্যই রাখা।)
        */}
        {mayOpenSettings && (
          <Route path="settings" element={<SettingsPage />} />
        )}

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Router />
        {/*
          ⭐ রুটার ও Layout-এর **বাইরে**, ইচ্ছাকৃতভাবে — তাই ব্যাজটা
             লগইন পাতা, পাসওয়ার্ড-বদলের পাতা আর ৪০৪-সহ **প্রতিটা** পর্দায়
             থাকে। ভেতরে বসালে ঠিক যে অবস্থাগুলোতে "কোন বিল্ড চলছে" জানা
             সবচেয়ে জরুরি, সেখানেই ওটা থাকত না।
        */}
        <VersionBadge />
      </AuthProvider>
    </BrowserRouter>
  );
}
