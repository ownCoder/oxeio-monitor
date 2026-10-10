import { useEffect, useState } from 'react';
import { createTelegramAiCode, getTelegramAiStatus, unlinkTelegramAi, type TelegramAiCode, type TelegramAiStatus } from '../api/telegramAi';

export function TelegramAiPage() {
  const [status, setStatus] = useState<TelegramAiStatus | null>(null);
  const [code, setCode] = useState<TelegramAiCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void getTelegramAiStatus().then(setStatus).catch(() => setError('Link status এখন পাওয়া যাচ্ছে না।')); }, []);
  async function makeCode() {
    setBusy(true); setError('');
    try { setCode(await createTelegramAiCode()); }
    catch { setError('Code তৈরি করা যায়নি। আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  }
  async function unlink() {
    setBusy(true); setError('');
    try { setStatus(await unlinkTelegramAi()); setCode(null); }
    catch { setError('Account বিচ্ছিন্ন করা যায়নি। আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-3xl space-y-6 p-6 text-ink">
    <div><p className="text-xs font-bold uppercase tracking-widest text-accent">Office assistant</p><h1 className="mt-2 text-3xl font-bold">AI Manager on Telegram</h1><p className="mt-2 text-sm text-ink-3">বর্তমান oXeio alert bot-এ নিজের account যুক্ত করে কাজ ও report নিয়ে প্রশ্ন করুন।</p></div>
    <section className="rounded-xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold">Your connection</h2>
      <p className="mt-2 text-sm text-ink-2">{status === null ? 'Checking…' : status.linked ? `Connected${status.linkedAt ? ` · ${new Date(status.linkedAt).toLocaleString()}` : ''}` : 'Not connected'}</p>
      {status?.linked ? <button type="button" disabled={busy} onClick={() => void unlink()} className="mt-4 rounded-md border border-line px-4 py-2 text-sm">Unlink Telegram</button> : <>
        <ol className="mt-4 list-inside list-decimal space-y-2 text-sm text-ink-2"><li>Telegram-এ বর্তমান oXeio alert bot-এর private chat খুলুন।</li><li>নিচে link code তৈরি করুন; এটি ১০ মিনিটের জন্য একবারই চলবে।</li><li>Bot-এ <code>/link CODE</code> পাঠান। Code-এর জায়গায় তৈরি code বসান।</li></ol>
        <button type="button" disabled={busy} onClick={() => void makeCode()} className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Generate link code</button>
        {code && <div className="mt-4 rounded-md border border-line bg-surface-2 p-4" role="status"><p className="text-xs text-ink-3">One-time code · expires {new Date(code.expiresAt).toLocaleTimeString()}</p><p className="mt-2 font-mono text-xl tracking-widest">{code.code}</p><p className="mt-2 text-xs text-ink-3">এই code অন্য কাউকে দেবেন না।</p></div>}
      </>}
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
    </section>
    <section className="rounded-xl border border-line bg-surface p-6 text-sm text-ink-2"><h2 className="text-lg font-semibold text-ink">What you can ask</h2><p className="mt-3"><code>/today</code> নিজের আজকের কাজ · <code>/help</code> নির্দেশনা · <code>/unlink</code> Telegram বিচ্ছিন্ন</p><p className="mt-2">Manager ও owner: <code>/team</code> দলের গত ৭ দিনের সারাংশ। প্রশ্নও করতে পারবেন, যেমন “এই সপ্তাহে কার কত design complete হয়েছে?”</p><p className="mt-3 text-xs text-ink-3">Bot শুধু যুক্ত account-এর অনুমতিপ্রাপ্ত তথ্য দেখায়। কর্মীদের বেতন, screenshots বা disciplinary decision AI chat-এ দেওয়া হয় না।</p></section>
  </div>;
}
