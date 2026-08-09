import { useAuth } from '../auth/AuthContext';

/**
 * Phase 1-এর শেষ ধাপ — লগইনের পর ইউজার সত্যিই ভেতরে ঢুকেছে তা দেখানো।
 * আসল Live Board আসবে Phase 3-এ (E01)।
 */
export function HomePage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-xl border border-line bg-surface p-6">
        <h1 className="text-lg font-semibold">
          স্বাগতম, {user?.fullName}
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          লগইন কাজ করছে — সেশন cookie বসেছে, CSRF টোকেন যাচাই হচ্ছে।
        </p>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
          <div className="bg-surface p-3">
            <dt className="text-xs text-ink-3">ইমেইল</dt>
            <dd className="mt-0.5 text-sm">{user?.email}</dd>
          </div>
          <div className="bg-surface p-3">
            <dt className="text-xs text-ink-3">ভূমিকা</dt>
            <dd className="mt-0.5 text-sm">{user?.role}</dd>
          </div>
          <div className="bg-surface p-3">
            <dt className="text-xs text-ink-3">সর্বশেষ লগইন</dt>
            <dd className="num mt-0.5 text-sm">
              {user?.lastLoginAt
                ? new Date(user.lastLoginAt).toLocaleString('en-GB', {
                    timeZone: 'Asia/Dhaka',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold">এরপর যা আসবে</h2>
        <p className="mt-1 text-sm text-ink-3">
          উপরের ট্যাবগুলো এখনো খালি। Live Board, টাইমলাইন, স্ক্রিনশট গ্যালারি ও
          মাসিক হিটম্যাপ তৈরি হবে Phase 3-এ — ডিজাইন মকআপে সাতটি পর্দাই দেখা
          যাচ্ছে।
        </p>
      </div>
    </div>
  );
}

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-line bg-surface p-10 text-center">
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-ink-3">এই পর্দাটি Phase 3-এ তৈরি হবে।</p>
    </div>
  );
}
