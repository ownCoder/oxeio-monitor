import { useState } from 'react';

import { useApi } from '../../api/useApi';
import {
  disableTwoFactor,
  enableTwoFactor,
  regenerateRecoveryCodes,
  setupTwoFactor,
  twoFactorStatus,
  type TwoFactorSetup,
} from '../../auth/twoFactorApi';
import { useAuth } from '../../auth/AuthContext';
import { Card } from '../../components/Card';
import { ErrorBox, Loading } from '../../components/States';
import { Button, Page, SectionHead } from '../../components/Page';
import { Modal, Notice, ServerError, useMutation } from '../settings/ui';
import { RecoveryCodesModal } from './RecoveryCodesModal';

/**
 * I06 — নিজের অ্যাকাউন্টের 2FA। **নিজের**, অন্য কারো নয়: সব endpoint
 * সেশনের ইউজারের উপরেই কাজ করে, তাই owner-only করার দরকার নেই — ম্যানেজার
 * বা স্টাফও নিজের অ্যাকাউন্ট শক্ত করতে পারবে।
 */
export function SecurityPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi(
    (signal) => twoFactorStatus(signal),
    [],
  );

  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState<'disable' | 'regenerate' | null>(
    null,
  );

  const start = useMutation();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;

  return (
    <Page
      title="Security"
      subtitle={`${user?.email ?? ''} — two-factor authentication and sessions`}
    >
      <Card>
        <SectionHead
          title="Two-Factor Authentication (2FA)"
          hint={
            data.enabled
              ? `On · ${data.recoveryCodesLeft} recovery codes left`
              : 'Off'
          }
        />

        {data.enabled ? (
          <div className="space-y-3">
            <Notice>
              Signing in needs a 6-digit code from your authenticator app after
              the password. Even a leaked password will not let anyone in.
            </Notice>

            {/*
              ⚠️ কোড ফুরিয়ে গেলে ফোন হারানোর দিন ঢোকার আর কোনো পথ থাকে না —
                 তাই কম থাকলে চুপ না থেকে বলে দেওয়া।
            */}
            {data.recoveryCodesLeft <= 2 && (
              <Notice tone="attention">
                You are nearly out of recovery codes ({data.recoveryCodesLeft}{' '}
                left). Generate a fresh set now — if you lose your phone, these
                are the only way back in.
              </Notice>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setConfirming('regenerate')}>
                New recovery codes
              </Button>
              <Button tone="danger" onClick={() => setConfirming('disable')}>
                Turn off 2FA
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Notice>
              Google Authenticator, Microsoft Authenticator, Authy — any TOTP
              app works. You get 10 recovery codes when you turn it on; those
              are what you sign in with if you lose your phone.
            </Notice>

            {data.pendingSetup && (
              <Notice tone="attention">
                Setup was started once before and never finished. Starting again
                gives you a new QR code — if you already scanned the old one,
                delete it from your app.
              </Notice>
            )}

            <ServerError error={start.error} />

            <Button
              tone="primary"
              disabled={start.busy}
              onClick={() =>
                start.run(async () => {
                  setSetup(await setupTwoFactor());
                })
              }
            >
              {start.busy ? 'Please wait…' : 'Turn on 2FA'}
            </Button>
          </div>
        )}
      </Card>

      {setup && (
        <EnableModal
          setup={setup}
          onCancel={() => {
            setSetup(null);
            reload();
          }}
          onDone={(codes) => {
            setSetup(null);
            setFreshCodes(codes);
          }}
        />
      )}

      {confirming && (
        <PasswordConfirmModal
          mode={confirming}
          onCancel={() => setConfirming(null)}
          onDone={(codes) => {
            setConfirming(null);
            if (codes) setFreshCodes(codes);
            reload();
          }}
        />
      )}

      {freshCodes && (
        <RecoveryCodesModal
          codes={freshCodes}
          onClose={() => {
            setFreshCodes(null);
            reload();
          }}
        />
      )}
    </Page>
  );
}

/**
 * ধাপ ২ — QR দেখানো আর একটা কোড দিয়ে প্রমাণ।
 *
 * ⚠️ এই মোডাল বন্ধ করলে 2FA **চালু হয় না** — সার্ভারে সিক্রেটটা
 *    `enabled: false` অবস্থায় পড়ে থাকে। ইচ্ছাকৃত: স্ক্যান করতে ভুলে গিয়ে
 *    বা ভুল অ্যাপে স্ক্যান করে কেউ যেন নিজের অ্যাকাউন্ট থেকে চিরতরে
 *    তালাবদ্ধ না হয়।
 */
function EnableModal({
  setup,
  onCancel,
  onDone,
}: {
  setup: TwoFactorSetup;
  onCancel: () => void;
  onDone: (codes: string[]) => void;
}) {
  const [code, setCode] = useState('');
  const m = useMutation();

  const submit = (): void => {
    m.run(async () => {
      const { recoveryCodes } = await enableTwoFactor(code);
      onDone(recoveryCodes);
    });
  };

  return (
    <Modal
      title="Turn on 2FA"
      hint="Scan the QR code, then enter the code from your app"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button tone="primary" disabled={m.busy} onClick={submit}>
            {m.busy ? 'Verifying…' : 'Verify and turn on'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ol className="list-inside list-decimal space-y-1 text-[13px] text-ink-2">
          <li>Open the authenticator app on your phone</li>
          <li>Scan the QR code below</li>
          <li>Type the 6 digits your app is showing</li>
        </ol>

        {/*
          ⚠️ ছবিটা data URL — বাইরের কোনো সার্ভারে যায় না। QR-এর ভেতরে
             সিক্রেট আছে; তৃতীয় পক্ষের API দিয়ে আঁকালে সেটা তাদের লগে বসত।
          ⚠️ সাদা পটভূমি হার্ডকোড: QR স্ক্যানার গাঢ়-হালকার বৈসাদৃশ্য খোঁজে,
             তাই ডার্ক থিমেও ছবির চারপাশের quiet zone সাদাই থাকতে হবে।
          ⚠️ সাদা বাক্সটা **ভেতরের** div-এ, বাইরের বর্ডারওয়ালা div-এ নয় —
             ইচ্ছে করেই আলাদা রাখা। `index.css`-এ একসময় একটা সেতু-নিয়ম ছিল
             যা `border-line bg-white` জোড়াটাকে ডার্কে `surface` করে দিত;
             ইনপুট দুটো `bg-surface`-এ সরে যাওয়ায় নিয়মটা এখন মুছে গেছে।
             তবু ক্লাস দুটো আলাদা এলিমেন্টে রাখা হলো: ভবিষ্যতে কেউ ওই
             ধরনের নিয়ম আবার লিখলেও এই quiet zone সাদাই থাকবে — গাঢ় হলে
             স্ক্যানার আটকাত, আর 2FA চালু করার একমাত্র পথ ওই স্ক্যান।
        */}
        <div className="flex justify-center rounded-lg border border-line bg-paper p-3">
          <div className="rounded bg-white p-2">
            <img
              src={setup.qrDataUrl}
              alt="2FA QR code"
              width={240}
              height={240}
              className="h-auto max-w-full"
            />
          </div>
        </div>

        <details className="rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink-2">
          <summary className="cursor-pointer">Can&rsquo;t scan the QR?</summary>
          <p className="mt-2">
            Choose &ldquo;enter a setup key&rdquo; in your app and give it this
            secret:
          </p>
          <p className="num mt-1.5 break-all text-ink select-all">
            {setup.secret}
          </p>
        </details>

        <ServerError error={m.error} />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            The 6-digit code from your app
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !m.busy) submit();
            }}
            placeholder="123456"
            className="num w-full rounded-md border border-line bg-surface px-3 py-2 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
        </label>

        <Notice tone="attention">
          2FA is not turned on until the code matches. Closing this dialog
          changes nothing — so there is no risk of locking yourself out by
          forgetting to scan.
        </Notice>
      </div>
    </Modal>
  );
}

/**
 * ⚠️ বন্ধ করা আর নতুন কোড বানানো — দুটোতেই পাসওয়ার্ড। সেশন cookie-ই যথেষ্ট
 *    ধরলে খোলা রেখে যাওয়া ল্যাপটপ থেকে যে কেউ 2FA খুলে ফেলতে পারত, অথচ
 *    2FA-র উদ্দেশ্যই cookie চুরির বিরুদ্ধে রক্ষা।
 */
function PasswordConfirmModal({
  mode,
  onCancel,
  onDone,
}: {
  mode: 'disable' | 'regenerate';
  onCancel: () => void;
  onDone: (codes: string[] | null) => void;
}) {
  const [password, setPassword] = useState('');
  const m = useMutation();

  const submit = (): void => {
    m.run(async () => {
      if (mode === 'disable') {
        await disableTwoFactor(password);
        onDone(null);
        return;
      }
      const { recoveryCodes } = await regenerateRecoveryCodes(password);
      onDone(recoveryCodes);
    });
  };

  const isDisable = mode === 'disable';

  return (
    <Modal
      title={isDisable ? 'Turn off 2FA?' : 'New recovery codes'}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            tone={isDisable ? 'danger' : 'primary'}
            disabled={m.busy || password === ''}
            onClick={submit}
          >
            {m.busy ? 'Please wait…' : isDisable ? 'Turn off' : 'Generate'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="attention">
          {isDisable
            ? 'Once it is off, a password alone gets you in, and your recovery codes are deleted.'
            : 'Generating a new set makes every old recovery code stop working immediately.'}
        </Notice>

        <ServerError error={m.error} />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            Your password
          </span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !m.busy && password !== '') submit();
            }}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
        </label>
      </div>
    </Modal>
  );
}
