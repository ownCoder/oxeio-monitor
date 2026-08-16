import { useState } from 'react';

import {
  getTelegramSettings,
  saveTelegramSettings,
  testTelegram,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Caveat, ErrorBox, Loading } from '../../components/States';
import {
  MiniButton,
  Notice,
  ServerError,
  TextField,
  useMutation,
} from './ui';

/**
 * **G08 — টেলিগ্রামের কনফিগ, পর্দা থেকে।**
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো:** টোকেন ও চ্যাট আইডি ছিল কেবল `.env`-এ, তাই
 * বদলাতে হলে VPS-এ SSH → ফাইল সম্পাদনা → কনটেইনার রিস্টার্ট। মালিকের
 * পক্ষে সেটা কার্যত অসম্ভব — ফলে একবার ভুল হলে সেটা মাসের পর মাস ভুলই
 * থেকে যেত, আর সাপ্তাহিক সারাংশ নীরবে আসা বন্ধ থাকত।
 *
 * ⚠️ **পুরো টোকেন এই পর্দায় কোনোদিন আসে না** — সার্ভার শেষ চার অক্ষর
 * ছাড়া কিছু পাঠায় না। তাই ঘরটা সবসময় খালি দেখায়; বসালে নতুনটা বসে,
 * খালি রেখে সেভ করলে আগেরটাই থাকে।
 */
export function NotificationsTab() {
  const telegram = useApi(getTelegramSettings, []);
  const save = useMutation();
  const probe = useMutation();

  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const current = telegram.data;

  if (telegram.loading && !current) return <Loading />;
  if (telegram.error && !current) {
    return <ErrorBox error={telegram.error} retry={telegram.reload} />;
  }

  return (
    <div className="space-y-3">
      <Card
        title="Telegram"
        hint="Where the weekly summary and alerts are sent"
      >
        <div className="space-y-3.5 p-4">
          <Notice>
            Create a bot with <b>@BotFather</b> on Telegram, then send it a
            message so it can reply. The chat id is the conversation it should
            post into.
          </Notice>

          {/*
            ⚠️⚠️ কোনটা **আসলে** খাটছে সেটা বলা হয় — না বললে মালিক পর্দায়
               নতুন মান বসিয়ে ভাবতেন সেভ হয়নি, অথচ হয়েছে; শুধু `.env`-এরটা
               তখনো জিতছিল (দুটো ঘরের একটা খালি রাখলে সেটাই হয়)।
          */}
          {current && (
            <div className="text-[13px]">
              {current.source === 'database' && (
                <span className="text-ok">
                  Set here · token {current.tokenHint} · chat{' '}
                  <span className="num">{current.chatId}</span>
                </span>
              )}
              {current.source === 'env' && (
                <span className="text-idle">
                  Currently using the server&rsquo;s <span className="num">.env</span>{' '}
                  · token {current.tokenHint} · chat{' '}
                  <span className="num">{current.chatId}</span>
                </span>
              )}
              {current.source === 'none' && (
                <span className="text-ink-3">
                  Not set — nothing is being sent to Telegram
                </span>
              )}
            </div>
          )}

          <TextField
            label="Bot token"
            value={token}
            onChange={setToken}
            mono
            placeholder={current?.configured ? 'leave empty to keep the current one' : ''}
            hint="From @BotFather. It is never shown again after saving."
          />

          <TextField
            label="Chat id"
            value={chatId}
            onChange={setChatId}
            mono
            placeholder={current?.chatId || ''}
            hint="A number. Negative numbers are groups."
          />

          <ServerError error={save.error ?? probe.error} />

          {result && (
            <Notice tone={result.startsWith('✓') ? 'info' : 'attention'}>
              {result}
            </Notice>
          )}

          <div className="flex gap-2">
            <MiniButton
              disabled={save.busy}
              onClick={() =>
                save.run(async () => {
                  /**
                   * ⚠️ ঘর খালি রাখলে **আগেরটাই** পাঠানো হয় — নইলে শুধু
                   * চ্যাট আইডি ঠিক করতে গিয়ে টোকেনটা মুছে যেত, আর
                   * টেলিগ্রাম নীরবে বন্ধ হয়ে থাকত।
                   */
                  await saveTelegramSettings(
                    token.trim(),
                    chatId.trim() || (current?.chatId ?? ''),
                  );
                  setToken('');
                  setChatId('');
                  setResult(null);
                  telegram.reload();
                })
              }
            >
              {save.busy ? 'Saving…' : 'Save'}
            </MiniButton>

            {/*
              ⭐⭐ পরীক্ষার বোতামটা **সবচেয়ে দরকারি অংশ**। এটা না থাকলে
                 মালিক সেভ করে শুক্রবার পর্যন্ত অপেক্ষা করতেন, আর কিছু না
                 এলে বুঝতেন ভুল ছিল — কিন্তু কী ভুল, তা জানার উপায় নেই।
            */}
            <MiniButton
              disabled={probe.busy || !current?.configured}
              onClick={() =>
                probe.run(async () => {
                  const { outcome } = await testTelegram();
                  setResult(
                    outcome === 'sent'
                      ? '✓ Sent — check Telegram now.'
                      : outcome === 'not_configured'
                        ? 'Nothing is configured yet.'
                        : 'Telegram refused it — check the token and chat id.',
                  );
                })
              }
            >
              {probe.busy ? 'Sending…' : 'Send a test message'}
            </MiniButton>
          </div>
        </div>

        <Caveat>
          The weekly summary contains staff names and hours, so it only goes to
          the chat set here. Changing it takes effect immediately — no restart.
        </Caveat>
      </Card>
    </div>
  );
}
