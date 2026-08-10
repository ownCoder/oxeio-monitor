import { useCallback, useEffect, useState } from 'react';

/**
 * E13 — লাইট/ডার্ক সুইচ।
 *
 * রংগুলো সব `index.css`-এর টোকেনে, `light-dark()`-এর ভেতরে। এই ফাইলের
 * একমাত্র কাজ `<html>`-এ `data-theme` বসানো — বাকিটা CSS নিজেই করে।
 *
 * ⭐ **তিনটে অবস্থা, দুটো নয়:** `light`, `dark`, আর *কিছুই বাছা হয়নি*।
 * শেষেরটাই ডিফল্ট, আর তখন OS-কে অনুসরণ করা হয় **সারাক্ষণ** — সন্ধ্যায়
 * উইন্ডোজ নিজে ডার্কে গেলে ট্যাব খোলা থাকা অবস্থাতেই বদলে যায়। প্রথমবারেই
 * `localStorage`-এ `'light'` লিখে রাখলে পছন্দটা ওখানেই জমে যেত, আর
 * ব্যবহারকারী কখনো কিছু না বেছেও চিরকাল লাইটে আটকে থাকত।
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'oxeio.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * ⚠️ `localStorage` ছুঁলেই throw করতে পারে (কড়া প্রাইভেসি সেটিং, কিছু
 *    কিয়স্ক প্রোফাইল)। থিম না পড়তে পারা অ্যাপ ভেঙে ফেলার মতো কারণ নয় —
 *    তখন OS-এর পছন্দেই চলুক।
 * ⚠️ মানটা যাচাই করা হয়: কেউ হাতে `'banana'` বসিয়ে দিলে সেটা `<html>`-এ
 *    বসত আর `light-dark()` চুপচাপ লাইটে ফিরে যেত, অথচ বোতামটা "ডার্ক"
 *    দেখাত — দুটোয় দুই কথা।
 */
function readPreference(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

function writePreference(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // পছন্দ জমল না — এই সেশনে কাজ করবে, পরেরবার আবার OS-এর পছন্দ
  }
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function stamp(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * ⭐⚠️ মডিউল লোড হওয়ার সাথে সাথেই একবার — React রেন্ডারের **আগে**।
 *
 * `index.html`-এ কোনো স্ক্রিপ্ট বসানো যায়নি (ফাইলটা এই কাজের আওতার
 * বাইরে), তাই সবচেয়ে আগের যে বিন্দুতে পৌঁছানো যায় সেটা এখানে — বান্ডল
 * চালু হওয়ার মুহূর্ত, `<div id="root">` তখনো খালি। ফলে "OS লাইট কিন্তু
 * আমি ডার্ক বেছেছি" ব্যবহারকারী এক ঝলক সাদা পর্দা দেখেন না।
 *
 * OS-এর পছন্দে চলা ব্যবহারকারীর জন্য এই স্ট্যাম্পটা লাগতই না —
 * `color-scheme: light dark` HTML পার্স হওয়ার সময়েই ঠিক রংটা আঁকে। তবু
 * বসানো হয়, কারণ `dark:` ভ্যারিয়েন্টটা `[data-theme='dark']` খোঁজে:
 * অ্যাট্রিবিউট না বসালে টোকেন ডার্ক হতো অথচ `dark:` ক্লাসগুলো নয়।
 */
if (typeof document !== 'undefined') {
  stamp(readPreference() ?? systemTheme());
}

export interface ThemeState {
  /** এই মুহূর্তে যেটা চলছে */
  theme: Theme;
  /** কিছু বাছা হয়নি — OS-এর সাথে সাথে বদলায় */
  followsSystem: boolean;
  toggle: () => void;
}

export function useTheme(): ThemeState {
  const [preference, setPreference] = useState<Theme | null>(readPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);

  // OS-এর পছন্দ বদলালে (উইন্ডোজের "সূর্যাস্তে ডার্ক")
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (): void => setSystem(mq.matches ? 'dark' : 'light');
    // ⚠️ প্রথম রেন্ডার আর এই effect-এর মাঝেই OS বদলে যেতে পারে
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /**
   * ⚠️ অন্য ট্যাবে থিম বদলালে এই ট্যাবটাও সাথে বদলায়। না রাখলে দুটো ট্যাব
   *    দুই থিমে বসে থাকত, আর ফিরে এসে মনে হতো সুইচটা কাজ করেনি।
   *    (`storage` ইভেন্ট শুধু *অন্য* ট্যাব থেকে আসে, নিজের লেখায় নয়।)
   */
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      setPreference(readPreference());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const theme = preference ?? system;

  useEffect(() => {
    stamp(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setPreference((prev) => {
      // ⚠️ পর্দায় যা দেখা যাচ্ছে তার উল্টোটা — `prev` নয়। `prev` তখনো
      //    `null` (OS অনুসরণ) হতে পারে, আর তখন `null`-এর উল্টো বলে কিছু নেই।
      const next: Theme =
        (prev ?? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light')) ===
        'dark'
          ? 'light'
          : 'dark';
      writePreference(next);
      return next;
    });
  }, []);

  return { theme, followsSystem: preference === null, toggle };
}

/**
 * হেডারের বোতাম।
 *
 * ⚠️ হেডারের ফিল্ড দুই থিমেই কালো, তাই এখানকার রং টোকেন নয় — লগআউট
 *    বোতামের মতো সাদার অস্বচ্ছতা। টোকেন বসালে ডার্কে সাদা-অন-কালো হতো।
 */
export function ThemeToggle() {
  const { theme, followsSystem, toggle } = useTheme();
  const goingDark = theme === 'light';

  const label = goingDark ? 'ডার্ক মোড চালু করুন' : 'লাইট মোড চালু করুন';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={
        followsSystem
          ? `${label} (এখন সিস্টেমের পছন্দ অনুযায়ী)`
          : label
      }
      className="rounded-md border border-white/20 p-1.5 text-white/85 transition hover:border-brand hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
    >
      {goingDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

/* ছবিদুটো `currentColor` ব্যবহার করে — hover-এ বোতামের সাথেই উজ্জ্বল হয় */

function MoonIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    >
      <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
    </svg>
  );
}
