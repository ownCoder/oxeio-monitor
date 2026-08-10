import { useState } from 'react';

import { Button } from '../../components/Page';
import { Modal, Notice } from '../settings/ui';

/**
 * ⭐⚠️ রিকভারি কোড **এই একটিবারই** দেখা যাবে — সার্ভারে শুধু sha256 জমা।
 *
 * `ui.tsx`-এর `SecretModal` একটামাত্র গোপন মান দেখানোর জন্য; এখানে ১০টা,
 * তাই আলাদা। কিন্তু রক্ষাকবচগুলো হুবহু এক:
 *   ১· `dismissible={false}` — Escape বা বাইরে ক্লিকে বন্ধ হয় না
 *   ২· "সংরক্ষণ করেছি" টিক না পড়া পর্যন্ত বন্ধের বোতাম নিষ্ক্রিয়
 *   ৩· সমান-প্রস্থ অক্ষরে, বড় করে — টুকে নিতে গিয়ে যেন ভুল না হয়
 */
export function RecoveryCodesModal({
  codes,
  onClose,
}: {
  codes: string[];
  onClose: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');

  const text = codes.join('\n');

  const copy = (): void => {
    // ⚠️ `navigator.clipboard` শুধু নিরাপদ origin-এ (HTTPS বা localhost)।
    //    http-এ চালালে এটা `undefined` — তখন বোতামটা নীরবে কিছুই করত না,
    //    আর ব্যবহারকারী ভাবত কপি হয়ে গেছে।
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      setCopyState('failed');
      return;
    }
    void clipboard.writeText(text).then(
      () => {
        setCopyState('ok');
        setSaved(true);
      },
      () => setCopyState('failed'),
    );
  };

  return (
    <Modal
      title="রিকভারি কোড"
      hint="ফোন হারালে এগুলো দিয়েই ঢুকতে হবে"
      dismissible={false}
      onClose={onClose}
      footer={
        <Button tone="primary" disabled={!saved} onClick={onClose}>
          বন্ধ করুন
        </Button>
      }
    >
      <div className="space-y-3">
        <Notice tone="attention">
          এই কোডগুলো আর কখনো দেখানো হবে না — সার্ভারে শুধু এদের hash জমা থাকে।
          এখনই কপি করে নিরাপদ জায়গায় রাখুন বা কাগজে লিখে ফেলুন।
        </Notice>

        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-paper px-4 py-4">
          {codes.map((code) => (
            <li
              key={code}
              className="num text-center text-[15px] font-semibold tracking-wide text-ink select-all"
            >
              {code}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={copy}>সবগুলো কপি করুন</Button>
          {copyState === 'ok' && (
            <span className="text-xs text-ink-3">কপি হয়েছে</span>
          )}
          {copyState === 'failed' && (
            <span className="text-xs text-brand-ink">
              কপি করা গেল না — লেখাগুলো নির্বাচন করে হাতে কপি করুন
            </span>
          )}
        </div>

        <Notice>
          প্রতিটি কোড একবারই চলে। ফুরিয়ে এলে এই পাতা থেকেই নতুন সেট বানাতে
          পারবেন — তখন পুরোনো সবগুলো সাথে সাথেই অচল হয়ে যাবে।
        </Notice>

        <label className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 accent-brand"
          />
          <span>আমি কোডগুলো কপি বা লিখে রেখেছি</span>
        </label>
      </div>
    </Modal>
  );
}
