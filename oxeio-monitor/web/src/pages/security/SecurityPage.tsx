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
      title="নিরাপত্তা"
      subtitle={`${user?.email ?? ''} — দুই ধাপের যাচাই ও সেশন`}
    >
      <Card>
        <SectionHead
          title="দুই ধাপের যাচাই (2FA)"
          hint={
            data.enabled
              ? `চালু · ${data.recoveryCodesLeft}টি রিকভারি কোড বাকি`
              : 'বন্ধ'
          }
        />

        {data.enabled ? (
          <div className="space-y-3">
            <Notice>
              লগইনের সময় পাসওয়ার্ডের পর authenticator অ্যাপের ৬ অঙ্কের কোড
              লাগবে। পাসওয়ার্ড ফাঁস হলেও কেউ ঢুকতে পারবে না।
            </Notice>

            {/*
              ⚠️ কোড ফুরিয়ে গেলে ফোন হারানোর দিন ঢোকার আর কোনো পথ থাকে না —
                 তাই কম থাকলে চুপ না থেকে বলে দেওয়া।
            */}
            {data.recoveryCodesLeft <= 2 && (
              <Notice tone="attention">
                রিকভারি কোড প্রায় ফুরিয়ে এসেছে ({data.recoveryCodesLeft}টি
                বাকি)। এখনই নতুন সেট বানিয়ে রাখুন — ফোন হারালে এগুলোই
                একমাত্র পথ।
              </Notice>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setConfirming('regenerate')}>
                নতুন রিকভারি কোড
              </Button>
              <Button tone="danger" onClick={() => setConfirming('disable')}>
                2FA বন্ধ করুন
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Notice>
              Google Authenticator, Microsoft Authenticator, Authy — যেকোনো
              TOTP অ্যাপ চলবে। চালু করার সময় ১০টি রিকভারি কোড পাবেন, ফোন
              হারালে সেগুলো দিয়েই ঢুকবেন।
            </Notice>

            {data.pendingSetup && (
              <Notice tone="attention">
                আগে একবার শুরু করে শেষ করা হয়নি। আবার শুরু করলে নতুন QR
                আসবে — পুরোনোটা স্ক্যান করে থাকলে অ্যাপ থেকে মুছে দিন।
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
              {start.busy ? 'অপেক্ষা করুন…' : '2FA চালু করি'}
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
      title="2FA চালু করুন"
      hint="QR স্ক্যান করে অ্যাপের কোডটি দিন"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>বাতিল</Button>
          <Button tone="primary" disabled={m.busy} onClick={submit}>
            {m.busy ? 'যাচাই হচ্ছে…' : 'যাচাই করে চালু করুন'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ol className="list-inside list-decimal space-y-1 text-[13px] text-ink-2">
          <li>ফোনে authenticator অ্যাপ খুলুন</li>
          <li>নিচের QR কোডটি স্ক্যান করুন</li>
          <li>অ্যাপে যে ৬ অঙ্ক দেখাচ্ছে সেটা এখানে লিখুন</li>
        </ol>

        <div className="flex justify-center rounded-lg border border-line bg-white p-3">
          {/*
            ⚠️ ছবিটা data URL — বাইরের কোনো সার্ভারে যায় না। QR-এর ভেতরে
               সিক্রেট আছে; তৃতীয় পক্ষের API দিয়ে আঁকালে সেটা তাদের লগে বসত।
            ⚠️ সাদা পটভূমি হার্ডকোড: QR স্ক্যানার গাঢ়-হালকার বৈসাদৃশ্য
               খোঁজে, তাই ডার্ক থিমেও এই বাক্সটা সাদাই থাকবে।
          */}
          <img
            src={setup.qrDataUrl}
            alt="2FA QR কোড"
            width={240}
            height={240}
            className="h-auto max-w-full"
          />
        </div>

        <details className="rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink-2">
          <summary className="cursor-pointer">QR স্ক্যান করা যাচ্ছে না?</summary>
          <p className="mt-2">
            অ্যাপে &ldquo;কোড হাতে লিখুন&rdquo; বেছে নিয়ে এই সিক্রেটটি দিন:
          </p>
          <p className="num mt-1.5 break-all text-ink select-all">
            {setup.secret}
          </p>
        </details>

        <ServerError error={m.error} />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            অ্যাপের ৬ অঙ্কের কোড
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
            placeholder="১২৩৪৫৬"
            className="num w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
        </label>

        <Notice tone="attention">
          কোড না মেলা পর্যন্ত 2FA চালু হবে না। এই মোডাল বন্ধ করলেও কিছুই
          বদলাবে না — তাই স্ক্যান করতে ভুলে গিয়ে আটকে যাওয়ার ভয় নেই।
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
      title={isDisable ? '2FA বন্ধ করবেন?' : 'নতুন রিকভারি কোড'}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>বাতিল</Button>
          <Button
            tone={isDisable ? 'danger' : 'primary'}
            disabled={m.busy || password === ''}
            onClick={submit}
          >
            {m.busy ? 'অপেক্ষা করুন…' : isDisable ? 'বন্ধ করুন' : 'বানান'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="attention">
          {isDisable
            ? 'বন্ধ করলে শুধু পাসওয়ার্ড দিয়েই ঢোকা যাবে, আর রিকভারি কোডগুলোও মুছে যাবে।'
            : 'নতুন সেট বানালে পুরোনো সব রিকভারি কোড সাথে সাথেই অচল হয়ে যাবে।'}
        </Notice>

        <ServerError error={m.error} />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            আপনার পাসওয়ার্ড
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
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
        </label>
      </div>
    </Modal>
  );
}
