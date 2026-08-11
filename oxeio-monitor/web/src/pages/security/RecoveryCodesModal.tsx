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
      title="Recovery codes"
      hint="These are how you get in if you lose your phone"
      dismissible={false}
      onClose={onClose}
      footer={
        <Button tone="primary" disabled={!saved} onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-3">
        <Notice tone="attention">
          These codes will not be shown again — the server keeps only their
          hashes. Copy them somewhere safe now, or write them down on paper.
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
          <Button onClick={copy}>Copy all</Button>
          {copyState === 'ok' && (
            <span className="text-xs text-ink-3">Copied</span>
          )}
          {copyState === 'failed' && (
            <span className="text-xs text-brand-ink">
              Could not copy — select the codes and copy them by hand
            </span>
          )}
        </div>

        <Notice>
          Each code works once. When you run low you can generate a fresh set
          from this page — every old code stops working the moment you do.
        </Notice>

        <label className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 accent-brand"
          />
          <span>I have copied or written down the codes</span>
        </label>
      </div>
    </Modal>
  );
}
