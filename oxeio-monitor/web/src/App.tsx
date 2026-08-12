import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { AlertsPage } from './pages/AlertsPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';
import { GalleryPage } from './pages/GalleryPage';
import { LiveBoardPage } from './pages/LiveBoardPage';
import { LoginPage } from './pages/LoginPage';
import { MonthlyPage } from './pages/MonthlyPage';
import { MyDataPage } from './pages/MyDataPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReportsPage } from './pages/ReportsPage';
import { SecurityPage } from './pages/security/SecurityPage';
import { SettingsPage } from './pages/settings/SettingsPage';

/**
 * তিনটি অবস্থা, তিনটি আলাদা রুট-গাছ — তাই "লগইন করেনি অথচ ভেতরের পেজ দেখছে"
 * বা "পাসওয়ার্ড না বদলে ঘুরে বেড়াচ্ছে" — এমন কিছু সম্ভবই নয়।
 */
function Router() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center text-sm text-ink-3">
        Loading…
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
   * ⚠️ সার্ভারের গার্ড পড়ে দেখা: স্টাফের জন্য `/screenshots` ও `/me`
   *    **ছাড়া** আর কোনো ড্যাশবোর্ড endpoint খোলা নেই (`live`, `employees`,
   *    `activity`, `reports` — সবগুলোয় ক্লাস-লেভেল `@Roles(owner, manager)`)।
   *    তাই লগইনের পর তাকে লাইভ বোর্ডে নামালে প্রথম যা দেখত তা একটা ৪০৩ বাক্স।
   */
  const isStaff = user.role === 'employee';

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
            isStaff ? <Navigate to="/me" replace /> : <LiveBoardPage />
          }
        />

        {/*
          ⚠️ `staff` বলে কোনো তালিকা-পর্দা নেই (স্পেক § ৫-এ ছ-টা পর্দা, স্টাফ
             ম্যানেজমেন্ট সেটিংসের ভেতরে)। এখানে শুধু একজনের একটা দিন —
             লাইভ বোর্ডের কার্ড থেকে ক্লিক করে আসার জায়গা।
        */}
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
          ⭐ owner না হলে রুটটা **থাকেই না** — সরাসরি `/settings` টাইপ করলে
             "পাওয়া যায়নি" আসে, ৪০৩ নয়। ৪০৩ বললে উল্টো স্বীকার করা হতো যে
             পর্দাটা আছে। (`createRoutesFromChildren` non-element চাইল্ড
             নীরবে বাদ দেয়, তাই `false` বসানো নিরাপদ — v7-এর ডকুমেন্টেড
             আচরণ, ঠিক এই ধরনের শর্তের জন্যই রাখা।)
        */}
        {/*
          ⚠️ owner না হলে রুটটা **থাকেই না** — সেটিংসের মতোই। অ্যালার্টে
          হোস্টনেম, কর্মীর নাম আর ডিভাইসের অবস্থা একসাথে থাকে, আর
          সেগুলো ম্যানেজারের নাগালের বাইরে (স্পেক § ৪.৩)।
        */}
        {isOwner && <Route path="alerts" element={<AlertsPage />} />}

        {isOwner && <Route path="settings" element={<SettingsPage />} />}

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
      </AuthProvider>
    </BrowserRouter>
  );
}
