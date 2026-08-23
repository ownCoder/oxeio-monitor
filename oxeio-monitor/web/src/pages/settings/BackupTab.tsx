import { useState } from 'react';

import {
  getOffsiteSettings,
  saveOffsiteSettings,
  testOffsite,
} from '../../api/admin';
import { getOpsHealth } from '../../api/ops';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { ErrorBox, Loading } from '../../components/States';
import { formatAgo } from '../../lib/format';
import {
  Chip,
  MiniButton,
  Notice,
  ServerError,
  TextField,
  useMutation,
} from './ui';

/**
 * **R5 · G39 — অফসাইট ব্যাকআপের কনফিগ, পর্দা থেকে।**
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো — মাঠের ঘটনা, ১৮ আগস্ট।** B2-র কী বসাতে হতো
 * VPS-এ SSH করে, `rclone config` চালিয়ে, তারপর `/etc/oxeio-offsite.env`
 * সম্পাদনা করে। মালিক চেষ্টা করলেন, আর একটা আংশিক-পেস্ট হওয়া key নিয়ে
 * `401 bad_auth_token` এল — কারণটা বুঝতে টার্মিনালে বসে খোঁজাখুঁজি।
 *
 * ⭐ এখন এই পর্দাই যথেষ্ট, আর **পরীক্ষার বোতামটাই আসল**: সার্ভার সরাসরি
 * Backblaze-কে জিজ্ঞেস করে, তাই ভুল key সাথে সাথেই ধরা পড়ে — শনিবারের
 * টাইমার ব্যর্থ হওয়া পর্যন্ত অপেক্ষা করতে হয় না।
 *
 * ⚠️ **পুরো application key এই পর্দায় কোনোদিন আসে না** — সার্ভার শেষ চার
 * অক্ষর ছাড়া কিছু পাঠায় না।
 */
export function BackupTab() {
  const offsite = useApi(getOffsiteSettings, []);
  const health = useApi(getOpsHealth, []);
  const save = useMutation();
  const probe = useMutation();

  const [keyId, setKeyId] = useState('');
  const [appKey, setAppKey] = useState('');
  const [bucket, setBucket] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const current = offsite.data;

  if (offsite.loading && !current) return <Loading />;
  if (offsite.error && !current) {
    return <ErrorBox error={offsite.error} retry={offsite.reload} />;
  }

  const backup = health.data?.backup;

  return (
    <div className="space-y-3">
      <Card
        title="Offsite Copy — Backblaze B2"
        hint="A second copy of the nightly backup, off this server"
      >
        <div className="space-y-3.5 p-4">
          <Notice>
            The nightly backup already runs, but it sits on{' '}
            <b>the same machine as the data</b>. If that disk dies, both go
            together. Three steps at{' '}
            <span className="num">backblaze.com</span>: create a{' '}
            <b>Private</b> bucket, then an <b>Application Key</b> limited to
            that bucket, then paste the two values here.
          </Notice>

          {/*
            ⚠️⚠️ কোনটা **আসলে** খাটছে সেটা বলা হয় — না বললে মালিক পর্দায়
               নতুন মান বসিয়ে ভাবতেন সেভ হয়নি, অথচ হয়েছে; শুধু সার্ভারের
               ফাইলেরটা তখনো জিতছিল।
          */}
          {current && (
            <div className="text-[13px]">
              {current.source === 'database' && (
                <span className="text-ok">
                  Set here · key {current.keyHint} · bucket{' '}
                  <span className="num">{current.bucket}</span>
                </span>
              )}
              {current.source === 'env' && (
                <span className="text-idle">
                  Currently using the server&rsquo;s own settings · key{' '}
                  {current.keyHint} · bucket{' '}
                  <span className="num">{current.bucket}</span>
                </span>
              )}
              {current.source === 'none' && (
                <span className="text-ink-3">
                  Not set — the backup exists only on this server
                </span>
              )}
            </div>
          )}

          <TextField
            label="Key ID"
            value={keyId}
            onChange={setKeyId}
            mono
            placeholder={current?.keyId || ''}
            hint="25 characters, shown next to the key on Backblaze"
          />

          <TextField
            label="Application key"
            value={appKey}
            onChange={setAppKey}
            mono
            placeholder={current?.configured ? 'leave empty to keep the current one' : ''}
            /*
              ⚠️⚠️ এই বাক্যটা সাজসজ্জা নয়। Backblaze কী-টা **একবারই দেখায়**,
                 আর ১৮ আগস্ট ঠিক সেখানেই আটকে গেছে — আংশিক পেস্ট হয়েছিল, আর
                 আবার দেখার কোনো উপায় ছিল না।
            */
            hint="31 characters. Backblaze shows it only once — copy all of it."
          />

          <TextField
            label="Bucket"
            value={bucket}
            onChange={setBucket}
            mono
            placeholder={current?.bucket || 'oxeio-backups'}
            hint="The bucket the key is limited to"
          />

          <ServerError error={save.error ?? probe.error} />

          {result && (
            <Notice tone={result.ok ? 'info' : 'attention'}>{result.text}</Notice>
          )}

          <div className="flex gap-2">
            <MiniButton
              disabled={save.busy}
              onClick={() =>
                save.run(async () => {
                  /**
                   * ⚠️ ঘর খালি রাখলে **আগেরটাই** পাঠানো হয় — নইলে শুধু
                   * bucket-এর নাম শুধরাতে গিয়ে key মুছে যেত, আর Backblaze
                   * application key **একবারই দেখায়** বলে ওটা আর ফেরত পাওয়া
                   * যেত না; নতুন key বানানো ছাড়া উপায় থাকত না।
                   */
                  await saveOffsiteSettings(
                    keyId.trim() || (current?.keyId ?? ''),
                    appKey.trim(),
                    bucket.trim() || (current?.bucket ?? ''),
                  );
                  setKeyId('');
                  setAppKey('');
                  setBucket('');
                  setResult(null);
                  offsite.reload();
                })
              }
            >
              {save.busy ? 'Saving…' : 'Save'}
            </MiniButton>

            {/*
              ⭐⭐ **এই বোতামটাই এই পর্দার আসল কারণ।** এটা ছাড়া সেভ করে
                 শনিবার পর্যন্ত অপেক্ষা করতে হতো, আর কিছু না গেলে বোঝা যেত
                 ভুল ছিল — কিন্তু কী ভুল, জানার উপায় নেই।
            */}
            <MiniButton
              disabled={probe.busy || !current?.configured}
              onClick={() =>
                probe.run(async () => {
                  const verdict = await testOffsite();
                  setResult({ ok: verdict.ok, text: verdict.message });
                })
              }
            >
              {probe.busy ? 'Checking…' : 'Test the connection'}
            </MiniButton>
          </div>

          <p className="text-[12px] text-ink-3">
            The copy runs every Saturday at 10:00 Dhaka. Files are encrypted before
            they leave this server, so Backblaze cannot read them —{' '}
            <b>which also means the passphrase is the only way back in</b>. Keep
            it somewhere other than this server.
          </p>
        </div>
      </Card>

      {/*
        ⭐ "কনফিগ করেছি" আর "ব্যাকআপ সত্যিই হচ্ছে" এক কথা নয় — তাই শেষ
           রানের অবস্থাটাও একই পর্দায়।
      */}
      <Card title="Nightly Backup" hint="What the server managed last night">
        <div className="p-4">
          {health.loading && !backup && <Loading />}
          {health.error && !backup && (
            <ErrorBox error={health.error} retry={health.reload} />
          )}

          {backup && (
            <div className="space-y-2 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                {backup.lastOutcome === 'failed' ? (
                  <Chip tone="attention">Failed</Chip>
                ) : backup.lastSuccessAt ? (
                  <Chip tone="counted">Ok</Chip>
                ) : (
                  <Chip tone="muted">Never run</Chip>
                )}
                <span className="text-ink-2">
                  {backup.lastSuccessAt
                    ? `Last good backup ${formatAgo(backup.lastSuccessAt)}`
                    : 'No successful backup yet'}
                </span>
                {/* ⚠️ সার্ভার এটা **আগেই ফরম্যাট করে** পাঠায় (স্ট্রিং) —
                    আবার formatBytes করতে গিয়ে টাইপ ভাঙছিল */}
                {backup.lastSize ? (
                  <span className="num text-ink-3">{backup.lastSize}</span>
                ) : null}
              </div>

              {backup.lastError && (
                <Notice tone="attention">{backup.lastError}</Notice>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
