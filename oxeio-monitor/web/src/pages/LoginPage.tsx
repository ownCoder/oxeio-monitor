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
          `রিকভারি কোডটি ব্যবহার হয়ে গেছে — আর ${left}টি বাকি।` +
            (left <= 2
              ? ' নিরাপত্তা পাতায় গিয়ে নতুন কোড বানিয়ে নিন।'
              : ''),
        );
      }
      // সফল হলে রুটিং নিজেই বদলে যায় — user সেট হওয়ার সাথে সাথে
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'সার্ভারে পৌঁছানো যাচ্ছে না',
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
        <div className="mb-6 flex items-center justify-center gap-2.5 rounded-lg bg-black px-4 py-3 text-white">
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
                <h1 className="text-lg font-semibold">লগইন</h1>
                <p className="mt-1 text-sm text-ink-3">
                  শুধু Owner ও Manager — স্টাফ নিজের হিসাব দেখতে একই জায়গায়
                  ঢুকবে।
                </p>
              </div>

              {/* I09 — "হঠাৎ লগইন পর্দা কেন?" প্রশ্নটার উত্তর */}
              {timedOut && !error && (
                <p className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink-2">
                  অনেকক্ষণ কোনো কাজ না হওয়ায় সেশন বন্ধ হয়ে গেছে। আবার ঢুকুন।
                </p>
              )}

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
            </>
          ) : (
            <>
              <div>
                <h1 className="text-lg font-semibold">দুই ধাপের যাচাই</h1>
                <p className="mt-1 text-sm text-ink-3">
                  {email} — {useRecovery
                    ? 'কাগজে লিখে রাখা রিকভারি কোডটি দিন।'
                    : 'আপনার authenticator অ্যাপের ৬ অঙ্কের কোডটি দিন।'}
                </p>
              </div>

              {error && <ErrorNote>{error}</ErrorNote>}

              {useRecovery ? (
                <Field
                  id="recovery"
                  label="রিকভারি কোড"
                  type="text"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="ABCDE-FGHJK"
                  hint="প্রতিটি কোড একবারই চলে।"
                />
              ) : (
                <Field
                  id="totp"
                  label="যাচাই কোড"
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
                  placeholder="১২৩৪৫৬"
                  hint="প্রতিটি কোড একবারই চলে — আগেরটা আবার দেওয়া যাবে না।"
                />
              )}

              <SubmitButton busy={busy}>যাচাই করুন</SubmitButton>

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
                    ? 'অ্যাপের কোড দিয়ে চেষ্টা করি'
                    : 'ফোন হাতে নেই — রিকভারি কোড দিই'}
                </button>
                <button
                  type="button"
                  onClick={backToPassword}
                  className="text-ink-3 underline underline-offset-2 hover:text-ink"
                >
                  ফিরে যাই
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
