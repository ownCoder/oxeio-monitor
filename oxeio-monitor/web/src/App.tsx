import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { HomePage, PlaceholderPage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

/**
 * তিনটি অবস্থা, তিনটি আলাদা রুট-গাছ — তাই "লগইন করেনি অথচ ভেতরের পেজ দেখছে"
 * বা "পাসওয়ার্ড না বদলে ঘুরে বেড়াচ্ছে" — এমন কিছু সম্ভবই নয়।
 */
function Router() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center text-sm text-ink-3">
        লোড হচ্ছে…
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

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="staff" element={<PlaceholderPage title="স্টাফ" />} />
        <Route
          path="screenshots"
          element={<PlaceholderPage title="স্ক্রিনশট গ্যালারি" />}
        />
        <Route
          path="monthly"
          element={<PlaceholderPage title="মাসিক অগ্রগতি" />}
        />
        <Route path="reports" element={<PlaceholderPage title="রিপোর্ট" />} />
        <Route path="*" element={<PlaceholderPage title="পাওয়া যায়নি" />} />
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
