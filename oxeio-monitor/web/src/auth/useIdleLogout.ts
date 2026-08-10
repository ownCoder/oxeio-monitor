import { useCallback, useEffect, useRef, useState } from 'react';

import { me } from '../api/auth';
import { idleStateAt, shouldPingSession, type IdleState } from './idle';
import { sessionPolicy } from './twoFactorApi';

/**
 * সার্ভার sliding window বসায় ৫ মিনিট পরপর (`SESSION_REFRESH_AFTER_MIN`)।
 * ⚠️ এর চেয়ে ঘন ঘন টোকা দিলে শুধু অকারণ ট্রাফিক; বিরল দিলে সক্রিয়
 *    ব্যবহারকারীর টোকেনই মরে যেত।
 */
const PING_EVERY_MS = 5 * 60 * 1000;

/** সার্ভার না পাওয়া গেলে এগুলোই ধরে নেওয়া হয় — সার্ভারের ডিফল্টের সমান */
const FALLBACK_TIMEOUT_MS = 30 * 60 * 1000;
const FALLBACK_WARN_MS = 60 * 1000;

/**
 * ⚠️ `scroll` ইচ্ছাকৃতভাবে **নেই** — জড়তায় চলতে থাকা স্ক্রল (touchpad
 *    momentum) পর্দার সামনে কেউ না থাকলেও ইভেন্ট ছুড়তে থাকে।
 * ⚠️ `mousemove` আছে, কারণ শুধু পড়তে থাকা ব্যবহারকারী আর কিছুই করে না —
 *    কিন্তু নিচের থ্রটল ছাড়া এটা সেকেন্ডে ৬০ বার state বদলাত।
 */
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'wheel',
] as const;

/** একাধিক ট্যাবে সক্রিয়তা ভাগ করার চাবি */
const SHARED_KEY = 'oxeio:lastActivity';

/** state বদলানোর সর্বনিম্ন ব্যবধান — নইলে প্রতি মাউস নড়াচড়ায় রি-রেন্ডার */
const THROTTLE_MS = 5_000;

export interface IdleLogout extends IdleState {
  /** "এখনো আছি" — সতর্কবার্তার বোতাম আর যেকোনো ক্লিক এটাই ডাকে */
  stayLoggedIn: () => void;
}

/**
 * I09 — ৩০ মিনিট নিষ্ক্রিয়তায় অটো-লগআউট, ১ মিনিট আগে সতর্কবার্তা।
 *
 * ⚠️ **কাজের মাঝপথে চুপচাপ লগআউট নয়** — এটাই এই হুকের পুরো কারণ। সার্ভার
 *    এমনিতেই টোকেন মেরে ফেলত, কিন্তু ব্যবহারকারী সেটা জানত পরের ক্লিকে,
 *    হঠাৎ লগইন পর্দা দেখে — মাঝপথে থাকা কাজসহ।
 *
 * ⭐ তিনটে কাজ একসাথে:
 *    ১· সক্রিয়তা মাপা (থ্রটল করে, ট্যাবের মধ্যে ভাগ করে)
 *    ২· সক্রিয় থাকলে সার্ভারকে টোকা দেওয়া — নইলে "পর্দায় সক্রিয় অথচ
 *       টোকেন মৃত" অবস্থা তৈরি হতো (দেখুন নিচের `me()` কল)
 *    ৩· সময় ফুরালে `onExpire`
 */
export function useIdleLogout(
  enabled: boolean,
  onExpire: () => void,
): IdleLogout {
  const [timeoutMs, setTimeoutMs] = useState(FALLBACK_TIMEOUT_MS);
  const [warnMs, setWarnMs] = useState(FALLBACK_WARN_MS);
  const [state, setState] = useState<IdleState>({
    phase: 'active',
    msLeft: FALLBACK_TIMEOUT_MS,
  });

  const lastActivityRef = useRef(Date.now());
  const lastPingRef = useRef(Date.now());
  const lastWriteRef = useRef(0);
  /**
   * ⚠️ ref-এ রাখা: `onExpire` বদলালেও নিচের effect আবার চালু হবে না।
   *    dependency-তে রাখলে প্রতিটা রেন্ডারে ইভেন্ট লিসেনার খোলা-বন্ধ হতো
   *    আর কাউন্টডাউন প্রতিবার শূন্য থেকে শুরু হতো।
   */
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  // সার্ভারের আসল সংখ্যা — না পেলে ফলব্যাক (এটা এরর দেখানোর মতো কিছু নয়)
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void sessionPolicy().then(
      (p) => {
        if (!alive) return;
        setTimeoutMs(p.idleTimeoutSec * 1000);
        setWarnMs(p.warnBeforeSec * 1000);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [enabled]);

  const markActive = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;

    // ⚠️ প্রতিবার localStorage-এ লিখলে mousemove-এ সেকেন্ডে ৬০টা লেখা হতো
    if (now - lastWriteRef.current >= THROTTLE_MS) {
      lastWriteRef.current = now;
      try {
        localStorage.setItem(SHARED_KEY, String(now));
      } catch {
        // ⚠️ প্রাইভেট মোড বা কোটা শেষ হলে localStorage ছোড়ে। ট্যাবের মধ্যে
        //    ভাগাভাগি হারানো চলে, কিন্তু লগআউটের হিসাব ভাঙা চলে না।
      }
    }

    setState((prev) =>
      prev.phase === 'active' ? prev : { phase: 'active', msLeft: timeoutMs },
    );
  }, [timeoutMs]);

  // ── সক্রিয়তা শোনা ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    let throttleUntil = 0;
    const onActivity = (): void => {
      const now = Date.now();
      if (now < throttleUntil) {
        // ⚠️ থ্রটলের ভেতরেও সময়টা এগিয়ে রাখা দরকার — নইলে টানা মাউস নাড়তে
        //    থাকা ব্যবহারকারীর `lastActivity` সবসময় ৫ সেকেন্ড পুরোনো থাকত
        lastActivityRef.current = now;
        return;
      }
      throttleUntil = now + THROTTLE_MS;
      markActive();
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }

    /**
     * ⚠️ অন্য ট্যাবে কাজ করলে এই ট্যাবটাও জাগে। এটা না থাকলে দুটো ট্যাব
     *    খোলা রেখে একটায় কাজ করা ব্যবহারকারী অন্যটায় লগআউট হতো — আর
     *    সেশন cookie যেহেতু ভাগাভাগি, তখন **দুটোই** বন্ধ হয়ে যেত।
     */
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== SHARED_KEY || e.newValue === null) return;
      const other = Number(e.newValue);
      if (Number.isFinite(other) && other > lastActivityRef.current) {
        lastActivityRef.current = other;
        setState((prev) =>
          prev.phase === 'active'
            ? prev
            : { phase: 'active', msLeft: timeoutMs },
        );
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
      window.removeEventListener('storage', onStorage);
    };
  }, [enabled, markActive, timeoutMs]);

  // ── প্রতি সেকেন্ডে হিসাব ─────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    // লগইনের ঠিক পরের মুহূর্ত থেকে গোনা শুরু — পুরোনো অবস্থা নিয়ে নয়
    lastActivityRef.current = Date.now();
    lastPingRef.current = Date.now();

    // ⚠️ মেয়াদ ফুরানোর পর `onExpire` **একবারই**। এই পাহারাটা না থাকলে
    //    লগআউট শেষ হওয়ার আগ পর্যন্ত প্রতি সেকেন্ডে একটা করে কল যেত।
    let fired = false;

    /**
     * ⚠️ কাউন্টডাউন `setInterval`-এর টিক **গোনে না**, শুধু ঘড়ি দেখে।
     *    ট্যাব পেছনে গেলে বা ল্যাপটপ ঘুমালে ব্রাউজার টাইমার ধীর করে দেয়
     *    (১ মিনিট পর্যন্ত) — টিক গুনলে ২ ঘণ্টা পরে জেগে ওঠা মেশিনেও
     *    "আর ২৯ মিনিট বাকি" দেখাত, অথচ সার্ভারের টোকেন কবেই মৃত।
     */
    const tick = (): void => {
      const now = Date.now();
      const next = idleStateAt(lastActivityRef.current, now, timeoutMs, warnMs);
      setState(next);

      if (next.phase === 'expired') {
        if (!fired) {
          fired = true;
          expireRef.current();
        }
        return;
      }
      fired = false;

      /**
       * ⚠️ টোকা দিতে `me()` — `session-policy` নয়। ওটা `@Public()`, অর্থাৎ
       *    JwtAuthGuard-এ ঢোকেই না, তাই সেশনের sliding window সরাত না।
       *    ফলে পর্দায় সক্রিয় কিন্তু API-তে নীরব ব্যবহারকারী (যেমন একটা
       *    রিপোর্ট পড়ছে) ৩০ মিনিট পর হঠাৎ লগআউট হয়ে যেত।
       *
       * ⚠️ `lastActivity >= lastPing` — অর্থাৎ **শেষ টোকার পর সত্যিই কিছু
       *    হয়েছে** কি না। এই শর্ত ছাড়া নিষ্ক্রিয় ট্যাবও ২৯ মিনিট ধরে প্রতি
       *    ৫ মিনিটে টোকা দিয়ে যেত, আর সার্ভারের টোকেন বারবার সরে যেত।
       *    তখন ব্রাউজার হঠাৎ বন্ধ হলে (ক্র্যাশ, force quit) সেশনটা শেষ
       *    কাজের ৩০ মিনিট নয়, প্রায় ৫৫ মিনিট পর্যন্ত বেঁচে থাকত।
       */
      if (
        next.phase === 'active' &&
        lastActivityRef.current >= lastPingRef.current &&
        shouldPingSession(lastPingRef.current, now, PING_EVERY_MS)
      ) {
        lastPingRef.current = now;
        // ব্যর্থ হলে চুপ — সেশন সত্যিই মরে থাকলে পরের আসল রিকোয়েস্টের
        // ৪০১ গ্লোবাল হ্যান্ডলারকে জাগিয়ে দেবে
        void me().catch(() => undefined);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [enabled, timeoutMs, warnMs]);

  const stayLoggedIn = useCallback(() => {
    lastWriteRef.current = 0; // অন্য ট্যাবগুলোকেও সাথে সাথে জানানো
    lastPingRef.current = 0; // ⚠️ সাথে সাথেই সার্ভারের উইন্ডোও সরাতে হবে
    markActive();
  }, [markActive]);

  return { ...state, stayLoggedIn };
}
