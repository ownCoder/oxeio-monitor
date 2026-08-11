import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * F05 — .xlsx ডাউনলোড।
 *
 * ⭐ `api<T>()` ব্যবহার করা হয় **না**। ওটা রেসপন্সকে সবসময় JSON ধরে নিয়ে
 * `JSON.parse()` করে, আর সার্ভার এখানে বাইনারি পাঠায় — ফলে ফাইলটা এসে
 * পৌঁছেও `SyntaxError` হয়ে হারিয়ে যেত। তাই আলাদা `fetch`, তারপর `blob()`।
 *
 * ⭐ সাধারণ `<a href download>`-ও কাজ করত, কিন্তু তখন **কখন শেষ হলো তা জানার
 * কোনো উপায় থাকত না**। এক বছরের রেঞ্জে সার্ভারের কয়েক সেকেন্ড লাগে; ওই
 * সময়টুকুতে বোতাম চুপচাপ বসে থাকলে মানুষ বারবার চাপে, আর প্রতিবার সার্ভারে
 * নতুন করে পুরো রিপোর্ট তৈরি হয়। fetch করলে বোতামটা নিষ্ক্রিয় রাখা যায় আর
 * "Preparing…" বলা যায়। ব্যর্থ হলে বার্তাটাও পর্দায় দেখানো যায় — `<a>`-এ
 * ৪০৩ এলে ব্রাউজার নীরবে একটা JSON ফাইল নামিয়ে রাখত।
 */

/** `attachment; filename="oxeio-attendance-2026-08-01_2026-08-11.xlsx"` */
const DISPOSITION_NAME = /filename="?([^";]+)"?/i;

export interface XlsxDownload {
  /** ডাউনলোড চলছে — বোতাম নিষ্ক্রিয় রাখুন */
  busy: boolean;
  error: string | null;
  start: (url: string, fallbackName: string) => void;
  /**
   * পুরোনো এরর মুছে ফেলা। ⚠️ ট্যাব বদলালে এটা ডাকতে হয় — নইলে
   * অ্যাটেনডেন্স নামাতে গিয়ে হওয়া ভুলটা সারাংশ ট্যাবেও ঝুলে থাকত, আর
   * মনে হতো সারাংশেই কিছু একটা গোলমাল।
   */
  clear: () => void;
}

export function useXlsxDownload(): XlsxDownload {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ ফাইল তৈরি হতে কয়েক সেকেন্ড লাগে; এর মধ্যে ব্যবহারকারী অন্য ট্যাবে
  //    চলে গেলে unmount-এর পর `setState` হতো (React-এর সতর্কবার্তা, আর
  //    বাস্তবে হারিয়ে যাওয়া এরর)। তাই বেঁচে আছে কি না মিলিয়ে নেওয়া।
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback((url: string, fallbackName: string) => {
    setBusy(true);
    setError(null);

    void (async () => {
      try {
        // ⚠️ `credentials: 'include'` ছাড়া সেশন cookie যায় না — তখন ৪০১
        //    এসে ব্যবহারকারী হঠাৎ লগইন পর্দায় ছিটকে যেত।
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(await messageOf(res));

        saveBlob(await res.blob(), filenameOf(res) ?? fallbackName);
      } catch (err) {
        if (!alive.current) return;
        setError(err instanceof Error ? err.message : "Couldn't download the file");
      } finally {
        if (alive.current) setBusy(false);
      }
    })();
  }, []);

  const clear = useCallback(() => setError(null), []);

  return { busy, error, start, clear };
}

/**
 * ⚠️ ব্যর্থ হলে সার্ভার JSON পাঠায় (বাইনারি নয়), তাই বার্তাটা তুলে আনা যায়।
 *    ৪০৩-এর নিজস্ব বাক্য — `<ErrorBox>` যা বলে, **হুবহু** সেটাই ("You don't
 *    have access"), যাতে দুই জায়গায় দুই রকম শোনায় না। ওখানে বদলালে এখানেও।
 *
 * ⚠️ মাঝের `body.message` সার্ভারের নিজের লেখা — যেমন আসে তেমনই দেখানো হয়
 *    (`<ErrorBox>`-এর মতোই; ভাষা ঠিক করার জায়গা সার্ভার, ক্লায়েন্ট নয়)।
 */
async function messageOf(res: Response): Promise<string> {
  if (res.status === 403) return "You don't have access";
  if (res.status === 401) return 'Your session ended — please sign in again';

  try {
    const body = (await res.json()) as { message?: string | string[] } | null;
    const message = body?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  } catch {
    // বডি খালি বা বাইনারি — নিচের সাধারণ বার্তাটাই যাবে
  }

  return `Couldn't build the file (${res.status})`;
}

/**
 * ⚠️ নামটা সার্ভারই ঠিক করে (`reports.excel.ts` → `reportFilename`), কারণ
 *    ফাইলের নামে রেঞ্জটা লেখা থাকে। হেডার না পড়া গেলে (প্রক্সি ছেঁটে দিলে)
 *    fallback — নইলে ব্রাউজার `download.xlsx` নামে সেভ করত আর ডাউনলোড
 *    ফোল্ডারে কোনটা কোন রিপোর্ট বোঝার উপায় থাকত না।
 */
function filenameOf(res: Response): string | null {
  const header = res.headers.get('Content-Disposition');
  const match = header ? DISPOSITION_NAME.exec(header) : null;
  return match ? match[1] : null;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // ⚠️⚠️ `revokeObjectURL` **অবশ্যই** করতে হবে — নইলে পুরো ফাইলটা ট্যাব বন্ধ
  //    না করা পর্যন্ত মেমরিতে বসে থাকে, আর রিপোর্ট নামানো মানুষ পরপর দশবার
  //    নামায়। কিন্তু `click()`-এর সাথে সাথেই revoke করা যায় না: ব্রাউজার
  //    তখনো URL-টা পড়ছে, আর সরিয়ে নিলে ডাউনলোডটাই বাতিল হয়ে যেত।
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
