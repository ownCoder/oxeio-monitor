import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Wordmark } from '../components/Brand';
import { ErrorNote, Field, SubmitButton } from '../components/Field';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      // সফল হলে রুটিং নিজেই বদলে যায় — user সেট হওয়ার সাথে সাথে
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'সার্ভারে পৌঁছানো যাচ্ছে না',
      );
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5 rounded-lg bg-black px-4 py-3 text-white">
          <Wordmark className="text-lg" />
          <span className="text-xs text-white/55">Workforce Monitor</span>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
        >
          <div>
            <h1 className="text-lg font-semibold">লগইন</h1>
            <p className="mt-1 text-sm text-ink-3">
              শুধু Owner ও Manager — স্টাফ নিজের হিসাব দেখতে একই জায়গায় ঢুকবে।
            </p>
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Field
            id="email"
            label="ইমেইল"
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@oxeio.local"
          />

          <Field
            id="password"
            label="পাসওয়ার্ড"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <SubmitButton busy={busy}>ঢুকুন</SubmitButton>

          <p className="text-center text-xs text-ink-3">
            পাসওয়ার্ড ভুলে গেলে Owner-কে বলুন — তিনি রিসেট করে দিতে পারবেন।
          </p>
        </form>
      </div>
    </div>
  );
}
