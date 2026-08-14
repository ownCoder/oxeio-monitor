import { useMemo, useState } from 'react';

import {
  getTimeline,
  type SegmentState,
  type Timeline,
  type TimelineSegment,
} from '../../api/dashboard';
import { useApi } from '../../api/useApi';
import { Card, Stat, StatRow } from '../../components/Card';
import { Duration } from '../../components/Duration';
import { SectionHead } from '../../components/Page';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import {
  formatCount,
  formatDuration,
  formatTime,
  parseWorkDate,
} from '../../lib/format';

/**
 * E04 — একজনের একদিনের টাইমলাইন বার।
 *
 * ⭐⚠️ **ডিভাইস অনুযায়ী আলাদা সারি।** একজনের দুটো PC চললে সেগমেন্টগুলো
 * সময়ে **overlap** করে (`dashboard.service.ts` ইচ্ছাকৃতভাবে যোগফল রাখে,
 * UNION নয়)। সবগুলো একটাই বারে আঁকলে দুটো সেগমেন্ট একটার উপর আরেকটা বসে
 * যেত — বারটা তখন পড়াই যায় না, আর কেউ বুঝতেই পারত না যে দুটো মেশিন চলছে।
 * তাই `deviceId` ধরে সারি ভাগ করা।
 *
 * ⭐ রঙের নিয়ম: **নিরেট `ink` = গোনা হওয়া কাজ, ধূসর = গোনা হয়নি**। এখানে
 * সলিড লাল নেই — নিষ্ক্রিয় থাকা ভুল নয়, শুধু গোনা হয় না।
 *
 * ⚠️ পর্দার লেখায় "কালো" শব্দটা আর নেই। Midnight থিমে `--color-ink`
 * প্রায় সাদা (#e8ecf1) — "Black = counted work" লিখলে সেটা গাঢ় থিমে
 * সরাসরি মিথ্যে হতো, অথচ কেউ ধরতেও পারত না যে লেখাটা পুরোনো থিমের।
 * তাই লেখা হয় "Solid / grey", রঙের নাম নয়।
 */

/** ⚠️ Asia/Dhaka = UTC+06:00, DST নেই — `lib/format.ts`-এর ঠিক একই ধ্রুবক */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;

/**
 * বারের সর্বনিম্ন প্রস্থ, মিনিটে।
 *
 * ⚠️ কেউ ২০ মিনিট কাজ করলে জানালাটা ২০ মিনিটের হলে ওই একরত্তি সময় পুরো
 * পর্দাজুড়ে ছড়িয়ে যেত — দেখে মনে হতো সারাদিন কাজ হয়েছে। ছ-ঘণ্টার
 * সর্বনিম্ন জানালা সেই বিভ্রমটা আটকায়।
 */
const MIN_WINDOW_MIN = 6 * 60;

const SEG_LABEL: Record<SegmentState, string> = {
  active: 'Working',
  idle: 'Idle',
  locked: 'Screen locked',
};

/**
 * ⚠️ তিনটে অবস্থাকে তিনটে **আলাদা করে চেনা যায় এমন** চেহারা দিতে হবে।
 * idle আর locked দুটোই "গোনা হয়নি", কিন্তু কারণ আলাদা — একটায় মানুষ ছিল,
 * অন্যটায় ছিল না। কাছাকাছি দুটো ধূসর দিলে কেউ পার্থক্যটা ধরতে পারত না,
 * তাই locked-এ সরু বর্ডার বসানো।
 */
const SEG_CLASS: Record<SegmentState, string> = {
  active: 'bg-ink',
  idle: 'bg-ink-3/45',
  locked: 'border border-ink-3/40 bg-ink-3/15',
};

interface Span {
  seg: TimelineSegment;
  /** ঢাকার ওই দিনের ০০:০০ থেকে মিনিট — মধ্যরাত পেরোলে ঋণাত্মক বা ১৪৪০+ */
  fromMin: number;
  toMin: number;
  /** কোন সারিতে বসবে, ১ থেকে শুরু */
  device: number;
}

interface DeviceRow {
  deviceId: number;
  label: number;
  spans: Span[];
}

interface View {
  rows: DeviceRow[];
  winFrom: number;
  winTo: number;
  ticks: number[];
  /** কোনো সেগমেন্ট এই দিনের বাইরে চলে গেছে — বলতেই হবে */
  clipped: boolean;
  multiDevice: boolean;
  /** "এখন" রেখাটা জানালার ভেতরে পড়লে তার মিনিট, নইলে `null` */
  nowMin: number | null;
}

export function TimelineBar({
  employeeId,
  date,
  nonce,
}: {
  employeeId: number;
  date: string;
  /** পেজের রিফ্রেশ বোতাম চাপলে বাড়ে */
  nonce: number;
}) {
  const { data, error, loading, reload } = useApi(
    (signal) => getTimeline(employeeId, date, signal),
    [employeeId, date, nonce],
  );

  return (
    <section>
      <SectionHead
        title="Day timeline"
        hint="Hour scale · hover a segment for its times and length"
      />

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !data || data.segments.length === 0 ? (
        <Empty
          title="No segments on this day"
          hint="The PC was off, it was a day off, or the agent wasn't running — this screen alone can't tell you which. Try another date, or check when that day's last heartbeat arrived."
        />
      ) : (
        <TimelineBody
          // ⚠️ key না দিলে তারিখ বদলালেও hover-এ ধরে রাখা পুরোনো সেগমেন্টটা
          //    নিচের লাইনে বসে থাকত — আগের দিনের সময় নতুন দিনের নিচে।
          key={`${data.employeeId}:${data.date}`}
          timeline={data}
        />
      )}
    </section>
  );
}

function TimelineBody({ timeline }: { timeline: Timeline }) {
  const [hover, setHover] = useState<Span | null>(null);
  const view = useMemo(() => buildView(timeline), [timeline]);

  const span = view.winTo - view.winFrom;
  const clamp = (m: number): number =>
    Math.min(view.winTo, Math.max(view.winFrom, m));
  const leftPct = (m: number): number => ((clamp(m) - view.winFrom) / span) * 100;
  // ⚠️ ৩০ সেকেন্ডের সেগমেন্ট শূন্য-প্রস্থে মিলিয়ে যেত। সর্বনিম্ন প্রস্থ দিলে
  //    ওটা সামান্য বড় দেখায়, কিন্তু **অদৃশ্য হওয়ার চেয়ে সেটা ভালো** —
  //    ফাঁকা বার দেখে কেউ ভাবত ডেটাই আসেনি।
  const widthPct = (s: Span): number =>
    Math.max(0.4, ((clamp(s.toMin) - clamp(s.fromMin)) / span) * 100);

  const { totals, segments } = timeline;

  return (
    <>
      <StatRow>
        <Stat
          label="Counted work"
          value={<Duration seconds={totals.activeSec} />}
        />
        <Stat
          label="Idle"
          value={<Duration seconds={totals.idleSec} tone="muted" />}
          tone="muted"
        />
        <Stat
          label="Screen locked"
          value={<Duration seconds={totals.lockedSec} tone="muted" />}
          tone="muted"
        />
        {/*
          ⚠️ ডিভাইসের সংখ্যা এখানে `unit` হিসেবে বসানো হয়নি — "7" আর "2"
             পাশাপাশি বসে "7 2" পড়া যেত। একাধিক ডিভাইস হলে কথাটা নিচের
             সতর্কবার্তায় পুরো বাক্যে বলা আছে।
        */}
        <Stat
          label={view.multiDevice ? 'Devices' : 'Segments'}
          value={formatCount(
            view.multiDevice ? view.rows.length : segments.length,
          )}
          tone="muted"
        />
      </StatRow>

      <div className="mt-3">
        <Card padded={false}>
          <div className="p-4">
            <div className="space-y-2">
              {view.rows.map((row) => (
                <div key={row.deviceId} className="flex items-center gap-2">
                  {/*
                    ⚠️ E12 — ফোনে "Device" শব্দটা বাদ, শুধু সংখ্যা। ৩৬০px
                       পর্দায় ৬৪px লেবেল কলাম বারটাকে ১৯০px-এ নামিয়ে আনত,
                       আর তখন সেগমেন্টগুলো আলাদা করে চেনাই যেত না।
                  */}
                  {view.multiDevice && (
                    <span
                      className="w-8 flex-none truncate text-[11px] text-ink-3 sm:w-16"
                      title={`Device ID ${row.deviceId}`}
                    >
                      <span className="hidden sm:inline">Device </span>
                      <span className="num">{row.label}</span>
                    </span>
                  )}

                  <div className="relative h-9 min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-paper">
                    {view.ticks.map((m) => (
                      <div
                        key={m}
                        aria-hidden
                        className="absolute top-0 bottom-0 w-px bg-line"
                        style={{ left: `${leftPct(m)}%` }}
                      />
                    ))}

                    {row.spans.map((s) => {
                      const text = describe(s, view.multiDevice);
                      return (
                        <button
                          key={s.seg.id}
                          type="button"
                          title={text}
                          aria-label={text}
                          onMouseEnter={() => setHover(s)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(s)}
                          onBlur={() => setHover(null)}
                          /*
                           * ⚠️ ফোনের জন্য। নিচের স্থির লাইনটা ইচ্ছাকৃতভাবে
                           *    ভাসমান টুলটিপের বদলে বসানো হয়েছিল, যাতে
                           *    ছোঁয়াতেও পড়া যায় — কিন্তু ওটা ভরত শুধু
                           *    `mouseenter`/`focus` থেকে, আর Safari বোতামে
                           *    ট্যাপ করলে ফোকাস দেয় না। ফলে সেগমেন্টে চাপ
                           *    দিয়ে ফোনে কিছুই দেখা যেত না, আর `title`
                           *    টুলটিপও ছোঁয়ার পর্দায় কখনো ওঠে না —
                           *    অর্থাৎ দিনের বিস্তারিত ফোনে সম্পূর্ণ অদৃশ্য।
                           */
                          onClick={() => setHover(s)}
                          className={`absolute top-0 bottom-0 focus:outline-2 focus:outline-brand focus:[outline-offset:-2px] ${SEG_CLASS[s.seg.state]}`}
                          style={{
                            left: `${leftPct(s.fromMin)}%`,
                            width: `${widthPct(s)}%`,
                          }}
                        />
                      );
                    })}

                    {view.nowMin !== null && (
                      <div
                        aria-hidden
                        title="Now"
                        className="absolute top-0 bottom-0 w-0.5 bg-ink/45"
                        style={{ left: `${leftPct(view.nowMin)}%` }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ঘণ্টার অক্ষ — ট্র্যাকের সাথে মিলিয়ে রাখতে লেবেল কলামের সমান ফাঁক */}
            <div className={view.multiDevice ? 'ml-10 sm:ml-18' : ''}>
              <div className="relative mt-1.5 h-4">
                {view.ticks.map((m, i) => (
                  <span
                    key={m}
                    className="num absolute top-0 text-[10px] whitespace-nowrap text-ink-3"
                    style={{
                      left: `${leftPct(m)}%`,
                      transform:
                        i === 0
                          ? 'none'
                          : i === view.ticks.length - 1
                            ? 'translateX(-100%)'
                            : 'translateX(-50%)',
                    }}
                  >
                    {clockOf(m)}
                  </span>
                ))}
              </div>
            </div>

            {/*
              ⭐ hover-এর তথ্য একটা **স্থির লাইনে** বসে, ভাসমান টুলটিপে নয়।
                 ভাসমান টুলটিপ ফোনে ছোঁয়াই যায় না (E12), আর সরু সেগমেন্টের
                 উপর সেটা পর্দার বাইরে চলে যেত। লাইনটার উচ্চতা ধরা থাকে,
                 নইলে মাউস নাড়ালেই নিচের সব লাফাত।
            */}
            <div className="mt-3 min-h-5 text-[12px] text-ink-2">
              {hover ? (
                <span className="num">{describe(hover, view.multiDevice)}</span>
              ) : (
                <span className="text-ink-3">
                  Hover or tap a segment — its start, end and length appear
                  here
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-3">
              {(['active', 'idle', 'locked'] as SegmentState[]).map((state) => (
                <span key={state} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`size-2.5 flex-none rounded-[2px] ${SEG_CLASS[state]}`}
                  />
                  {SEG_LABEL[state]}
                </span>
              ))}
              {/* ⚠️ রঙের নাম নয় — Midnight থিমে `ink` প্রায় সাদা (ফাইলের মাথা দেখুন) */}
              <span>Solid = counted work · grey = not counted</span>
            </div>
          </div>
        </Card>
      </div>

      {view.multiDevice && (
        <Caveat>
          <span className="num">{view.rows.length}</span> devices were running
          on this day, so each one gets its own row. Where two rows are filled
          at the same moment, that time is counted <b>twice</b> in the totals
          above.
        </Caveat>
      )}

      {view.clipped && (
        <Caveat>
          A segment crossed midnight. The bar draws only the part that falls on{' '}
          <span className="num">{timeline.date}</span> — the totals above still
          cover the whole segment.
        </Caveat>
      )}
    </>
  );
}

/**
 * সেগমেন্টগুলো থেকে আঁকার মতো একটা ছবি বানানো।
 *
 * ⚠️ পুরো ফাংশনটা বিশুদ্ধ (`useMemo`-তে বসে) — এখানে কোনো `new Date()`
 *    ছাড়া আর কোনো পার্শ্বপ্রতিক্রিয়া নেই।
 */
function buildView(t: Timeline): View {
  // ⚠️ `parseWorkDate` UTC-midnight দেয়; ৬ ঘণ্টা পিছিয়ে নিলে ঢাকার ০০:০০
  const parsed = parseWorkDate(t.date);
  const dayStartMs = (parsed?.getTime() ?? 0) - DHAKA_OFFSET_MS;
  const minuteOf = (iso: string): number =>
    (new Date(iso).getTime() - dayStartMs) / 60000;

  const byDevice = new Map<number, Span[]>();
  let clipped = false;

  for (const seg of t.segments) {
    const fromMin = minuteOf(seg.startedAt);
    // ⚠️ ঘড়ি পিছিয়ে গেলে `endedAt < startedAt` হতে পারে (সার্ভারও এই
    //    সম্ভাবনা ধরে রাখে) — ঋণাত্মক প্রস্থ আঁকলে বারটা উল্টো দিকে ছড়াত
    const toMin = Math.max(fromMin, minuteOf(seg.endedAt));

    if (fromMin < 0 || toMin > MINUTES_PER_DAY) clipped = true;

    const span: Span = { seg, fromMin, toMin, device: 0 };
    const list = byDevice.get(seg.deviceId);
    if (list) list.push(span);
    else byDevice.set(seg.deviceId, [span]);
  }

  const rows: DeviceRow[] = [...byDevice.keys()]
    .sort((a, b) => a - b)
    .map((deviceId, index) => {
      const spans = byDevice.get(deviceId) ?? [];
      for (const s of spans) s.device = index + 1;
      return { deviceId, label: index + 1, spans };
    });

  let lo = MINUTES_PER_DAY;
  let hi = 0;
  for (const row of rows) {
    for (const s of row.spans) {
      lo = Math.min(lo, s.fromMin);
      hi = Math.max(hi, s.toMin);
    }
  }

  // ⚠️ জানালাটা দিনের ভেতরেই রাখা হয় — বাইরে ছড়ালে অক্ষে "-01:00" বসত,
  //    আর সেটা কেউ পড়ে বুঝত না। বাইরে পড়া অংশটুকু `clipped` দিয়ে বলা হয়।
  let winFrom = clampTo(Math.floor(lo / 60) * 60);
  let winTo = clampTo(Math.ceil(hi / 60) * 60);

  if (winTo - winFrom < MIN_WINDOW_MIN) {
    winTo = Math.min(MINUTES_PER_DAY, winFrom + MIN_WINDOW_MIN);
    winFrom = Math.max(0, winTo - MIN_WINDOW_MIN);
  }

  const hours = (winTo - winFrom) / 60;
  const step = hours <= 8 ? 1 : hours <= 16 ? 2 : 3;
  const ticks: number[] = [];
  for (let m = winFrom; m < winTo; m += step * 60) ticks.push(m);

  // ⚠️ শেষ দাগটা সবসময় জানালার ডান প্রান্তে (`winTo`)। শুধু push করলে
  //    ২১:০০ আর ২২:০০ গায়ে গায়ে বসে একটার উপর আরেকটা লেখা পড়ত, তাই
  //    আধা-ধাপের কম বাকি থাকলে শেষ দাগটাকে **সরিয়ে** দেওয়া হয়।
  const last = ticks[ticks.length - 1];
  if (winTo - last < step * 60) ticks[ticks.length - 1] = winTo;
  else ticks.push(winTo);

  const nowMin = (Date.now() - dayStartMs) / 60000;

  return {
    rows,
    winFrom,
    winTo,
    ticks,
    clipped,
    multiDevice: rows.length > 1,
    nowMin: nowMin >= winFrom && nowMin <= winTo ? nowMin : null,
  };
}

function clampTo(minutes: number): number {
  return Math.min(MINUTES_PER_DAY, Math.max(0, minutes));
}

/** মিনিট → `'14:00'`। ১৪৪০ → `'24:00'` (মকআপের অক্ষও তাই)। */
function clockOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function describe(s: Span, multiDevice: boolean): string {
  const parts = [
    `${formatTime(s.seg.startedAt)}–${formatTime(s.seg.endedAt)}`,
    SEG_LABEL[s.seg.state],
    formatDuration(s.seg.durationSec),
  ];
  if (multiDevice) parts.push(`Device ${s.device}`);
  return parts.join(' · ');
}
