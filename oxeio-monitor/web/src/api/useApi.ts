import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from 'react';

import { isAbortError } from './client';

/**
 * ডেটা আনার দুটো হুক — `useApi` (একবার) আর `usePolling` (বারবার)।
 *
 * ⭐ ছ-টা পেজেই এই দুটো ছাড়া `useEffect` + `fetch` লিখবেন না। কারণ নিচের
 *    তিনটে ফাঁদ প্রতিটা পেজে আলাদা করে এড়ানো প্রায় অসম্ভব:
 *      · unmount-এর পর `setState`
 *      · **race** — পুরোনো রিকোয়েস্ট দেরিতে ফিরে নতুন ডেটা মুছে দেওয়া
 *      · লুকোনো ট্যাবে সারারাত পোলিং
 */

export interface ApiResult<T> {
  /** সফল হওয়া শেষ রেসপন্স। কিছু না এলে `null`। */
  data: T | null;
  /** ব্যর্থ হলে — `ApiError` হলে `.status` দেখে ৪০৩ আলাদা করা যায় */
  error: Error | null;
  /** একটা রিকোয়েস্ট এখন চলছে কি না */
  loading: boolean;
  /** শেষ সফল রেসপন্স কখন এল — "শেষ হালনাগাদ 22:10" দেখাতে */
  updatedAt: Date | null;
  /** আবার আনা — `<ErrorBox retry={reload}>`-এ সরাসরি দেওয়া যায় */
  reload: () => void;
}

export interface PollingResult<T> extends ApiResult<T> {
  /** ⭐ ট্যাব লুকোনো বলে পোলিং থেমে আছে — পেজ চাইলে সেটা বলতে পারে */
  paused: boolean;
}

/**
 * ⚠️ fetcher-টা `signal` পায় — সেটা `api()`-কে দিয়ে দিলে বাতিল হওয়া
 *    রিকোয়েস্ট সত্যিই নেটওয়ার্ক থেকেও সরে যায়:
 *
 *    `useApi((signal) => getLiveBoard(signal), [])`
 */
export type Fetcher<T> = (signal: AbortSignal) => Promise<T>;

interface State<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  updatedAt: Date | null;
}

const INITIAL: State<never> = {
  data: null,
  error: null,
  loading: true,
  updatedAt: null,
};

/**
 * এক দফা ডেটা আনা। `deps` বদলালে আবার আনে।
 *
 * ```tsx
 * const { data, error, loading, reload } = useApi(
 *   (signal) => getTimeline(employeeId, date, signal),
 *   [employeeId, date],
 * );
 * if (loading && !data) return <Loading />;
 * if (error) return <ErrorBox error={error} retry={reload} />;
 * if (!data || data.segments.length === 0) return <Empty title="…" />;
 * ```
 *
 * ⚠️ `deps` বদলালে `data` **শূন্য করা হয়** — অন্য কর্মীর নাম বসিয়ে আগের
 *    কর্মীর ঘণ্টা এক মুহূর্তের জন্যও দেখানো যায় না।
 */
export function useApi<T>(
  fetcher: Fetcher<T>,
  deps: DependencyList = [],
): ApiResult<T> {
  const runner = useRunner(fetcher, true);
  const { run, invalidate, tick } = runner;

  useEffect(() => {
    const controller = run();
    return () => {
      // ⭐ দুটোই দরকার: `abort()` নেটওয়ার্ক থামায়, `invalidate()` দেরিতে
      //    ফেরা রেসপন্সকে অকেজো করে। শুধু abort-এ ভরসা করা যায় না — রেসপন্স
      //    ইতিমধ্যেই এসে গিয়ে `.then` সারিতে অপেক্ষা করতে পারে।
      invalidate();
      controller.abort();
    };
    // ⚠️ `deps` ইচ্ছাকৃতভাবে ছড়ানো — কোন কোন মান বদলালে আবার আনতে হবে
    //    সেটা কল করা পেজই জানে, এই হুক নয়।
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, invalidate, tick, ...deps]);

  return { ...runner.state, reload: runner.reload };
}

/**
 * প্রতি `intervalMs` মিলিসেকেন্ডে আবার আনা — লাইভ বোর্ডের ৩০ সেকেন্ড (E01)।
 *
 * ⭐ পুরোনো `data` **মুছে যায় না** — প্রতি ৩০ সেকেন্ডে বোর্ড সাদা হয়ে গেলে
 *    পড়াই যেত না। রিফ্রেশ চলাকালীন `loading` সত্যি থাকে, ডেটা আগেরটাই থাকে।
 *
 * ⭐⚠️ ট্যাব লুকোনো থাকলে টাইমারটা **বন্ধ** (`document.hidden`)। নইলে
 *    ড্যাশবোর্ড খোলা রেখে কেউ বাড়ি চলে গেলে সারারাত প্রতি ৩০ সেকেন্ডে
 *    সার্ভারে হিট হতো — পনেরোটা ট্যাব থেকে রাতে ২১,৬০০ রিকোয়েস্ট।
 *    ট্যাবে ফিরলে সাথে সাথেই একবার আনা হয়, নইলে ব্যবহারকারী ৩০ সেকেন্ড
 *    ধরে বাসি বোর্ড দেখত আর বুঝতেই পারত না।
 */
export function usePolling<T>(
  fetcher: Fetcher<T>,
  intervalMs: number,
  deps: DependencyList = [],
): PollingResult<T> {
  const runner = useRunner(fetcher, false);
  const { run, invalidate, tick } = runner;
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let controller: AbortController | null = null;
    let timer: number | undefined;

    const fetchNow = (): void => {
      controller?.abort();
      controller = run();
    };

    const startTimer = (): void => {
      window.clearInterval(timer);
      timer = window.setInterval(fetchNow, intervalMs);
    };

    const stopTimer = (): void => {
      window.clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = (): void => {
      if (document.hidden) {
        setPaused(true);
        stopTimer();
        return;
      }
      setPaused(false);
      fetchNow();
      startTimer();
    };

    // ⚠️ প্রথমবার সবসময় আনা হয়, ট্যাব লুকোনো থাকলেও — নইলে ব্যাকগ্রাউন্ডে
    //    খোলা ট্যাবে ফিরে এসে ৩০ সেকেন্ড খালি পর্দা দেখা যেত।
    fetchNow();
    setPaused(document.hidden);
    if (!document.hidden) startTimer();

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopTimer();
      invalidate();
      controller?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, invalidate, tick, intervalMs, ...deps]);

  return { ...runner.state, reload: runner.reload, paused };
}

// ── ভেতরের অংশ ──────────────────────────────────────────────────────────────

interface Runner<T> {
  state: State<T>;
  /** একটা রিকোয়েস্ট শুরু করে তার controller ফেরত দেয় */
  run: () => AbortController;
  /** চলমান রিকোয়েস্টগুলোর ফলাফল আর নেওয়া হবে না */
  invalidate: () => void;
  reload: () => void;
  /**
   * ⚠️ `reload()` ডাকলে এটা বাড়ে, আর এটা effect-এর deps-এ থাকে বলেই
   *    effect আবার চলে। deps-এ রাখতে ভুললে reload বোতামটা নীরবে কিছুই
   *    করত না — কোনো এরর নয়, শুধু একটা মরা বোতাম।
   */
  tick: number;
}

/**
 * দুটো হুকের সাধারণ যন্ত্রপাতি।
 *
 * ⭐ **generation counter**-টাই এখানকার আসল কথা। `AbortController` একা যথেষ্ট
 *    নয়: রেসপন্স এসে গিয়ে `.then` চলার আগে যদি নতুন রিকোয়েস্ট শুরু হয়,
 *    abort তখন আর কিছু থামাতে পারে না — পুরোনো ফলাফল নতুনটার উপরে বসে যেত।
 *    যেমন তারিখ দ্রুত দুবার বদলালে ১০ তারিখের ডেটা ৯ তারিখের পর্দায় বসত।
 */
function useRunner<T>(fetcher: Fetcher<T>, clearOnStart: boolean): Runner<T> {
  const [state, setState] = useState<State<T>>(INITIAL as State<T>);

  // ⚠️ প্রতি রেন্ডারে fetcher-এর পরিচয় বদলায় (অ্যারো ফাংশন), তাই সেটা
  //    deps-এ রাখা যায় না — রাখলে অসীম লুপ হতো। ref-এ রেখে সবসময়
  //    সর্বশেষটাই ডাকা হয়। ⚠️ assign করা হয় effect-এ, রেন্ডারের ভেতরে নয়।
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const genRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    // ⚠️ StrictMode-এ effect দুবার চলে (mount → cleanup → mount), তাই
    //    প্রতিবার `true` বসানো দরকার — নইলে দ্বিতীয় mount-এ কোনো ডেটাই
    //    বসত না, আর সেটা শুধু dev-এ ঘটত বলে ধরাও পড়ত না।
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const invalidate = useCallback(() => {
    genRef.current += 1;
  }, []);

  const run = useCallback((): AbortController => {
    genRef.current += 1;
    const gen = genRef.current;
    const controller = new AbortController();

    setState((prev) =>
      clearOnStart
        ? { data: null, error: null, loading: true, updatedAt: null }
        : { ...prev, loading: true, error: null },
    );

    void fetcherRef.current(controller.signal).then(
      (data) => {
        if (gen !== genRef.current || !aliveRef.current) return;
        setState({ data, error: null, loading: false, updatedAt: new Date() });
      },
      (err: unknown) => {
        // বাতিল করা রিকোয়েস্ট ব্যর্থতা নয় — এটাকে এরর দেখালে তারিখ
        // বদলানোর মতো নিরীহ কাজেও পর্দায় লাল বার্তা উঠত
        if (isAbortError(err)) return;
        if (gen !== genRef.current || !aliveRef.current) return;

        setState((prev) => ({
          // ⭐ পোলিং-এ পুরোনো ডেটা ধরে রাখা হয়: এক দফা নেটওয়ার্ক হোঁচট
          //    খেলে গোটা বোর্ড উধাও হওয়ার চেয়ে বাসি সংখ্যা + এরর বার্তা ভালো
          data: clearOnStart ? null : prev.data,
          error: err instanceof Error ? err : new Error(String(err)),
          loading: false,
          updatedAt: prev.updatedAt,
        }));
      },
    );

    return controller;
  }, [clearOnStart]);

  // ⭐ `reload` সরাসরি `run()` ডাকে না — একটা tick বাড়িয়ে effect-কেই আবার
  //    চালায়। ফলে abort ও cleanup-এর নিয়মগুলো এক জায়গাতেই থাকে; সরাসরি
  //    ডাকলে ওই রিকোয়েস্টটা unmount-এ বাতিল হতো না।
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { state, run, invalidate, reload, tick };
}
