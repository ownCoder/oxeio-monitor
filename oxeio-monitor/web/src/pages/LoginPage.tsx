import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Wordmark } from '../components/Brand';
import { ErrorNote, Field, SubmitButton } from '../components/Field';

/**
 * ⭐ দুটো ধাপ, কিন্তু **একটাই ফর্ম state** — ইমেইল/পাসওয়ার্ড মুছে ফেলা হয় না।
 *    কারণ সার্ভারের দ্বিতীয় ধাপেও ইমেইল+পাসওয়ার্ড লাগে (কোনো মাঝপথের
 *    "half-logged-in" টোকেন নেই, ADR — `auth.service.ts` দেখুন)।
 */
type Step = 'password' | 'totp';

export function LoginPage() {
  const { signIn, timedOut } = useAuth();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signIn({
        email,
        password,
        // ⚠️ ধাপ ১-এ ফিল্ড দুটো পাঠানোই হয় না — খালি স্ট্রিং পাঠালে সার্ভার
        //    সেটাকে "কোড দেওয়া হয়েছে কিন্তু ভুল" ধরত না ঠিকই, তবু
        //    অকারণে throttle-এর কাছাকাছি যাওয়ার মানে নেই।
        ...(step === 'totp' && !useRecovery ? { totp: code } : {}),
        ...(step === 'totp' && useRecovery ? { recoveryCode: code } : {}),
      });

      if (result.needsTotp) {
        setStep('totp');
        setBusy(false);
        return;
      }

      /**
       * ⚠️ রিকভারি কোড খরচ হলে সেটা জানানো **জরুরি** — কেউ ১০টার শেষটা
       *    ব্যবহার করে ফেলে টেরও না পেলে পরেরবার আর ঢোকার পথ থাকত না।
       *    রুট বদলে যাওয়ার আগে `alert` ছাড়া উপায় নেই: এই কম্পোনেন্টটা
       *    সাথে সাথেই unmount হয়ে যায়।
       */
      if (result.usedRecoveryCode) {
        const left = result.recoveryCodesLeft ?? 0;
        window.alert(
          `That recovery code is now used up — ${left} left.` +
            (left <= 2
              ? ' Go to the Security page and generate new ones.'
              : ''),
        );
      }
      // সফল হলে রুটিং নিজেই বদলে যায় — user সেট হওয়ার সাথে সাথে
    } catch (err) {
      /**
       * ⚠️ `err.message` সার্ভারের বার্তা ("ইমেইল বা পাসওয়ার্ড ভুল"), আর
       *    সার্ভার এখনো বাংলায় বলে — সেটা যেমন আসে তেমনই দেখানো হয়।
       *    নিচের নেটওয়ার্ক-ব্যর্থতার বাক্যটা আমাদের নিজেদের, তাই ইংরেজি।
       */
      setError(
        err instanceof ApiError ? err.message : "Can't reach the server",
      );
      setBusy(false);
      // ⚠️ ভুল কোডে ধাপ ১-এ ফেরানো হয় না — ফেরালে ব্যবহারকারীকে আবার
      //    পুরো পাসওয়ার্ড টাইপ করতে হতো, অথচ ভুলটা ছিল শুধু ৬ অঙ্কে।
      if (step === 'totp') setCode('');
    }
  }

  function backToPassword(): void {
    setStep('password');
    setCode('');
    setUseRecovery(false);
    setError(null);
  }

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5 rounded-lg bg-chrome px-4 py-3 text-white">
          <Wordmark className="text-lg" />
          <span className="text-xs text-white/55">Workforce Monitor</span>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
        >
          {step === 'password' ? (
            <>
              <div>
                <h1 className="text-lg font-semibold">Sign in</h1>
                <p className="mt-1 text-sm text-ink-3">
                  Owner and Manager — staff sign in here too, to see their own
                  hours.
                </p>
              </div>

              {/* I09 — "হঠাৎ লগইন পর্দা কেন?" প্রশ্নটার উত্তর */}
              {timedOut && !error && (
                <p className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink-2">
                  Your session closed after a long stretch of no activity.
                  Please sign in again.
                </p>
              )}

              {error && <ErrorNote>{error}</ErrorNote>}

              <Field
                id="email"
                label="Email"
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
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <SubmitButton busy={busy}>Sign in</SubmitButton>

              <p className="text-center text-xs text-ink-3">
                Forgot your password? Ask the Owner — they can reset it for you.
              </p>
            </>
          ) : (
            <>
              <div>
                <h1 className="text-lg font-semibold">Two-step verification</h1>
                <p className="mt-1 text-sm text-ink-3">
                  {email} — {useRecovery
                    ? 'Enter one of the recovery codes you wrote down.'
                    : 'Enter the 6-digit code from your authenticator app.'}
                </p>
              </div>

              {error && <ErrorNote>{error}</ErrorNote>}

              {useRecovery ? (
                <Field
                  id="recovery"
                  label="Recovery code"
                  type="text"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="ABCDE-FGHJK"
                  hint="Each code works only once."
                />
              ) : (
                <Field
                  id="totp"
                  label="Verification code"
                  /*
                   * ⚠️ `type="text"` + `inputMode="numeric"` — `type="number"`
                   *    দিলে শুরুর শূন্য মুছে যেত (`012345` → `12345`) আর
                   *    স্ক্রলে সংখ্যা বদলে যেত।
                   */
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  /*
                   * ⚠️ placeholder-এ **ইংরেজি অঙ্ক** — আগে বাংলা অঙ্ক
                   *    ("১২৩৪৫৬") বসানো ছিল, অথচ authenticator অ্যাপ কোড
                   *    দেয় ইংরেজি অঙ্কে। দুটো মেলে না দেখে কেউ ভাবতে পারত
                   *    ভুল ঘরে টাইপ করছে।
                   */
                  placeholder="123456"
                  hint="Each code works only once — an old one won't do."
                />
              )}

              <SubmitButton busy={busy}>Verify</SubmitButton>

              <div className="flex flex-wrap justify-between gap-2 text-center text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setCode('');
                    setError(null);
                  }}
                  className="text-ink-2 underline underline-offset-2 hover:text-ink"
                >
                  {useRecovery
                    ? 'Use the app code instead'
                    : "Phone not with me — use a recovery code"}
                </button>
                <button
                  type="button"
                  onClick={backToPassword}
                  className="text-ink-3 underline underline-offset-2 hover:text-ink"
                >
                  Back
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
