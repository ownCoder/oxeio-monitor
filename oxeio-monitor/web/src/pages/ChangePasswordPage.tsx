import { useState, type FormEvent } from 'react';

import { changePassword } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Wordmark } from '../components/Brand';
import { ErrorNote, Field, SubmitButton } from '../components/Field';

const MIN_LENGTH = 10;

/**
 * G33 — seed বা owner-এর দেওয়া অস্থায়ী পাসওয়ার্ড নিয়ে সিস্টেম ব্যবহার করা যায় না।
 * সার্ভার `mustChangePw` থাকলে অন্য সব রুটে 403 দেয়, তাই এই পর্দা এড়ানোর উপায় নেই।
 */
export function ChangePasswordPage() {
  const { user, signOut, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;

    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      await refresh();
    } catch (err) {
      // ⚠️ `err.message` সার্ভারের বার্তা — এখনো বাংলায় আসে, সেভাবেই যায়
      setError(err instanceof ApiError ? err.message : "Couldn't change it");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5 rounded-lg bg-chrome px-4 py-3 text-white">
          <Wordmark className="text-lg" />
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
        >
          <div>
            <h1 className="text-lg font-semibold">Change your password</h1>
            <p className="mt-1 text-sm text-ink-3">
              {user?.email} — the password has to be changed on first sign-in.
              Nothing else can be done until then.
            </p>
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Field
            id="current"
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />

          <Field
            id="next"
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            hint={`At least ${MIN_LENGTH} characters, and not the old one`}
          />

          <Field
            id="confirm"
            label="New password again"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          {mismatch && <ErrorNote>The two passwords don't match</ErrorNote>}

          <SubmitButton busy={busy} disabled={mismatch}>
            Change password
          </SubmitButton>

          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full text-center text-xs text-ink-3 underline-offset-2 hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
