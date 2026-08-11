import { useCallback, useEffect, useState } from 'react';

/**
 * লাইট/ডার্ক সুইচ।
 *
 * রংগুলো সব `index.css`-এর টোকেনে, `light-dark()`-এর ভেতরে। এই ফাইলের
 * একমাত্র কাজ `<html>`-এ `data-theme` বসানো — বাকিটা CSS নিজেই করে।
 *
 * ⭐ **দুটো অবস্থা, তিনটে নয়।** আগে "কিছুই বাছা হয়নি" বলে তৃতীয় একটা
 * অবস্থা ছিল, আর তখন OS-কে অনুসরণ করা হতো। এখন **ডিফল্ট গাঢ়** (Midnight,
 * মালিকের বাছা), `prefers-color-scheme` ইচ্ছে করেই দেখা হয় না — একই অফিসের
 * দুজন যেন এক পর্দা দেখে। বাছাইটা `localStorage`-এ থাকে, তাই পরেরবারও
 * মনে থাকে।
 *
 * ⚠️ OS অনুসরণ ফিরিয়ে আনতে হলে `index.css`-এর `color-scheme` আর নিচের
 *    ডিফল্ট — **দুটোই** বদলাতে হবে। একটা বদলালে JS-এর ভাবনা আর CSS-এর
 *    আঁকা দুই রকম হতো, আর `dark:` ক্লাসগুলো টোকেনের সাথে মিলত না।
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'oxeio.theme';

/** ⭐ কিছু বাছা না থাকলে যেটা — Midnight */
const DEFAULT_THEME: Theme = 'dark';

/**
 * ⚠️ `localStorage` ছুঁলেই throw করতে পারে (কড়া প্রাইভেসি সেটিং, কিছু
 *    কিয়স্ক প্রোফাইল)। থিম না পড়তে পারা অ্যাপ ভেঙে ফেলার মতো কারণ নয় —
 *    তখন ডিফল্টেই চলুক।
 * ⚠️ মানটা যাচাই করা হয়: কেউ হাতে `'banana'` বসিয়ে দিলে সেটা `<html>`-এ
 *    বসত আর `light-dark()` চুপচাপ ডিফল্টে ফিরে যেত, অথচ বোতামটা উল্টো
 *    ছবি দেখাত — দুটোয় দুই কথা।
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
    // পছন্দ জমল না — এই সেশনে কাজ করবে, পরেরবার আবার ডিফল্ট
  }
}

function stamp(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * ⭐⚠️ মডিউল লোড হওয়ার সাথে সাথেই একবার — React রেন্ডারের **আগে**।
 *
 * `index.html`-এ কোনো স্ক্রিপ্ট বসানো যায়নি (ফাইলটা এই কাজের আওতার
 * বাইরে), তাই সবচেয়ে আগের যে বিন্দুতে পৌঁছানো যায় সেটা এখানে — বান্ডল
 * চালু হওয়ার মুহূর্ত, `<div id="root">` তখনো খালি। ফলে "আমি লাইট বেছেছি"
 * ব্যবহারকারী এক ঝলক গাঢ় পর্দা দেখেন না।
 *
 * ডিফল্টে থাকা ব্যবহারকারীর জন্য এই স্ট্যাম্পটা লাগতই না — `index.css`-এর
 * `color-scheme: dark` HTML পার্স হওয়ার সময়েই ঠিক রংটা আঁকে, আর `dark:`
 * ভ্যারিয়েন্টটাও "লাইট নয়" ধরে নেয়। তবু বসানো হয়, যাতে DOM দেখে সবসময়
 * বলা যায় এখন কোন থিম চলছে।
 */
if (typeof document !== 'undefined') {
  stamp(readPreference() ?? DEFAULT_THEME);
}

export interface ThemeState {
  /** এই মুহূর্তে যেটা চলছে */
  theme: Theme;
  toggle: () => void;
}

/**
 * ⚠️ এখন একমাত্র ব্যবহারকারী `ThemeToggle` নিজে। দ্বিতীয় কেউ ডাকলে
 *    দুটো আলাদা `useState` হবে আর একটায় টগল করলে অন্যটা জানত না —
 *    তখন এটাকে context-এ তুলতে হবে (`stamp` করা DOM-ই সত্য, state নয়)।
 */
export function useTheme(): ThemeState {
  const [theme, setTheme] = useState<Theme>(
    () => readPreference() ?? DEFAULT_THEME,
  );

  /**
   * ⚠️ অন্য ট্যাবে থিম বদলালে এই ট্যাবটাও সাথে বদলায়। না রাখলে দুটো ট্যাব
   *    দুই থিমে বসে থাকত, আর ফিরে এসে মনে হতো সুইচটা কাজ করেনি।
   *    (`storage` ইভেন্ট শুধু *অন্য* ট্যাব থেকে আসে, নিজের লেখায় নয়।)
   * ⚠️ `e.key === null` মানে কেউ পুরো `localStorage` মুছেছে — তখনও
   *    আবার পড়া হয়, অর্থাৎ ডিফল্টে ফিরে যায়।
   */
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      setTheme(readPreference() ?? DEFAULT_THEME);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    stamp(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      writePreference(next);
      return next;
    });
  }, []);

  return { theme, toggle };
}

/**
 * হেডারের বোতাম।
 *
 * ⚠️ হেডারের ফিল্ড দুই থিমেই গাঢ় (`--color-chrome`), তাই এখানকার রং
 *    ink/paper টোকেন নয় — লগআউট বোতামের মতো সাদার অস্বচ্ছতা। টোকেন
 *    বসালে ডার্কে প্রায়-সাদা লেখা প্রায়-সাদা হয়ে মিলিয়ে যেত।
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const goingLight = theme === 'dark';

  const label = goingLight ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="rounded-md border border-white/20 p-1.5 text-white/85 transition hover:border-brand hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
    >
      {goingLight ? <SunIcon /> : <MoonIcon />}
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
