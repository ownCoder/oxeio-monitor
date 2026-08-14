import { useState } from 'react';

import { getHourly, type HourlyChart as HourlyData } from '../../api/dashboard';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Duration } from '../../components/Duration';
import { SectionHead } from '../../components/Page';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import { formatDuration } from '../../lib/format';

/**
 * E05 — ২৪টা কলাম, কোন ঘণ্টায় কত মিনিট কাজ।
 *
 * ⭐ SVG হাতে আঁকা, কোনো চার্ট লাইব্রেরি নেই — একটা বার-চার্টের জন্য
 * ২০০ কিলোবাইট নির্ভরতা টানার মানে হয় না, আর ব্র্যান্ডের রঙ-নিয়ম
 * (নিরেট `ink` = গোনা হওয়া কাজ) লাইব্রেরির ডিফল্ট প্যালেটের সাথে লড়ত।
 * ⚠️ `ink` মানে "কালো" নয় — Midnight থিমে ওটা প্রায় সাদা (#e8ecf1)।
 *
 * ⚠️ সার্ভার শুধু `countsAsWork` সেগমেন্ট গোনে — idle বা locked এই চার্টে
 * নেই। তাই টাইমলাইনের মোট সময়ের চেয়ে এখানকার যোগফল ছোট হবে, এবং সেটাই ঠিক।
 */

const PAD_X = 8;
const PAD_TOP = 14;
/** কলামপ্রতি প্রস্থ — ২৪ × ৩০ = ৭২০, মোবাইলে স্ক্রল করে (E12) */
const COL = 30;
const BODY = 104;
const LABELS = 20;

const W = PAD_X * 2 + 24 * COL;
const H = PAD_TOP + BODY + LABELS;
const BASE = PAD_TOP + BODY;
const FULL_HOUR_SEC = 3600;

export function HourlyChart({
  employeeId,
  date,
  nonce,
}: {
  employeeId: number;
  date: string;
  nonce: number;
}) {
  const { data, error, loading, reload } = useApi(
    (signal) => getHourly(employeeId, date, signal),
    [employeeId, date, nonce],
  );

  return (
    <section>
      <SectionHead
        title="Work by hour"
        hint="Counted time only · 24 hours on the Dhaka clock"
      />

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !data || data.buckets.length === 0 || data.totalActiveSec === 0 ? (
        <Empty
          title="No counted work on this day"
          hint="Idle and locked time never reaches this chart. Grey bands in the timeline above mean the PC was on, but the work wasn't counted."
        />
      ) : (
        <Body data={data} />
      )}
    </section>
  );
}

function Body({ data }: { data: HourlyData }) {
  const peak = Math.max(...data.buckets.map((b) => b.activeSec));
  /**
   * ⭐⚠️ স্কেলের সিলিং **৬০ মিনিটের কম হয় না**। শুধু `peak` দিয়ে স্কেল করলে
   * যেদিন সর্বোচ্চ ১২ মিনিট, সেদিনও একটা বার আকাশ ছুঁয়ে থাকত — দেখে মনে হতো
   * ঘণ্টাটা পুরো কাজে কেটেছে। ঘণ্টার চার্টে ঘণ্টাই স্বাভাবিক সিলিং।
   *
   * ⚠️ কিন্তু `peak` ৬০ মিনিট ছাড়াতেও পারে: একজনের দুটো PC একসাথে চললে
   *    এক ঘণ্টায় ৬০-এর বেশি সেকেন্ড জমে (যোগফল, UNION নয়)। তখন সিলিং
   *    বাড়িয়ে না নিলে বারটা ফ্রেমের বাইরে চলে যেত।
   */
  const ceiling = Math.max(FULL_HOUR_SEC, peak);
  const overFull = peak > FULL_HOUR_SEC;
  const refY = BASE - (FULL_HOUR_SEC / ceiling) * BODY;

  /**
   * ⚠️⚠️ বেছে নেওয়া ঘণ্টা — **ফোনে এটাই একমাত্র উপায়**।
   *
   * আগে প্রতি ঘণ্টার মান ছিল কেবল SVG-র `<title>`-এ, অর্থাৎ হোভার-টুলটিপে।
   * ⚠️ ছোঁয়ার পর্দায় ওটা **কখনো ওঠে না**, তাই ফোনে চার্টটা ছিল ২৪টা নামহীন
   *    বার। ⭐ `DayPulse` ও "Last 7 days"-এ একই সমস্যা একইভাবে সারানো:
   *    স্থির readout লাইন + পুরো কলামজোড়া hit-target।
   * ⚠️ `<title>` **রাখা হয়েছে** — ডেস্কটপে টুলটিপ আর স্ক্রিন-রিডারে নাম,
   *    দুটোই ওটা থেকেই আসে।
   */
  const [pick, setPick] = useState<number | null>(null);
  const shown = pick === null ? null : data.buckets.find((b) => b.hour === pick);

  return (
    <>
      <Card padded={false}>
        {/*
          ⭐ readout লাইনটা স্ক্রল-ফ্রেমের **বাইরে** — ভেতরে রাখলে চার্ট ডানে
             সরানোর সাথে সংখ্যাটাও সরে যেত, অথচ ওটাই তখন পড়ার জিনিস।
        */}
        <p className="px-4 pt-3 text-xs text-ink-3">
          {shown ? (
            <span className="text-ink-2">
              <span className="num font-semibold text-ink">
                {pad2(shown.hour)}:00–{pad2(shown.hour + 1)}:00
              </span>{' '}
              · <span className="num">{formatDuration(shown.activeSec)}</span>
            </span>
          ) : (
            <>
              Counted{' '}
              <span className="num font-semibold text-ink">
                {formatDuration(data.totalActiveSec)}
              </span>{' '}
              in total
            </>
          )}
        </p>

        {/* ⚠️ চওড়া চার্ট **নিজের ফ্রেমে** স্ক্রল করে, পুরো পাতা নয় (E12) */}
        <div className="overflow-x-auto px-4 pt-2 pb-4">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block w-full min-w-[620px]"
            role="img"
            aria-label={`Work by hour — ${formatDuration(data.totalActiveSec)} in total`}
            // ⚠️ মাউস চার্ট ছাড়লে readout ডিফল্টে ফেরে। ফোনে এই ইভেন্টটা
            //    আসে না, তাই সেখানে শেষ ট্যাপ করা ঘণ্টাটাই দেখা যেতে থাকে —
            //    সেটাই কাম্য, নইলে আঙুল তোলামাত্র সংখ্যাটা মিলিয়ে যেত।
            onMouseLeave={() => setPick(null)}
          >
            {/* এক ঘণ্টার রেফারেন্স রেখা — বারগুলো কীসের তুলনায় লম্বা */}
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={refY}
              y2={refY}
              strokeDasharray="3 4"
              className="stroke-line"
            />
            <text
              x={W - PAD_X}
              y={refY - 4}
              textAnchor="end"
              fontSize={9}
              className="num fill-ink-3"
            >
              60m
            </text>

            {data.buckets.map((b) => {
              const raw = (b.activeSec / ceiling) * BODY;
              // শূন্য ঘণ্টাও ২px-এর একটা ধূসর দাগ পায় — একেবারে কিছু না
              // আঁকলে "কাজ হয়নি" আর "ডেটাই আসেনি" দেখতে একরকম হতো
              const barH = b.activeSec > 0 ? Math.max(2, raw) : 2;
              const x = PAD_X + b.hour * COL + 3;
              const w = COL - 6;

              return (
                <g key={b.hour}>
                  <title>
                    {`${pad2(b.hour)}:00–${pad2(b.hour + 1)}:00 · ${formatDuration(b.activeSec)}`}
                  </title>
                  <rect
                    x={x}
                    y={BASE - barH}
                    width={w}
                    height={barH}
                    rx={2}
                    className={b.activeSec > 0 ? 'fill-ink' : 'fill-line'}
                    // ⭐ বাছাই হলে বাকিগুলো ম্লান — উপরের সংখ্যাটা কোন ঘণ্টার,
                    //    সেটা তখন চোখেই দেখা যায়।
                    opacity={pick === null || pick === b.hour ? 1 : 0.4}
                  />
                  {/*
                    ⚠️⚠️ **স্বচ্ছ hit-target, পুরো কলামের উচ্চতা জুড়ে।** আসল
                       বারটা ২px উঁচুও হতে পারে (যে ঘণ্টায় প্রায় কাজ হয়নি) —
                       ওটুকুতে আঙুল তাক করা অসম্ভব। এই আয়তক্ষেত্রটা অদৃশ্য,
                       কিন্তু ছোঁয়ার জন্য ৩০px চওড়া ও পুরো লম্বা।
                    ⚠️ `<title>` আগের `<g>`-তেই থাকে, তাই টুলটিপও অটুট।
                  */}
                  <rect
                    x={PAD_X + b.hour * COL}
                    y={PAD_TOP}
                    width={COL}
                    height={BODY}
                    fill="transparent"
                    style={{ cursor: 'default' }}
                    onMouseEnter={() => setPick(b.hour)}
                    onClick={() => setPick(b.hour)}
                  />
                  <text
                    x={x + w / 2}
                    y={BASE + 14}
                    textAnchor="middle"
                    fontSize={9.5}
                    className="num fill-ink-3"
                  >
                    {b.hour}
                  </text>
                </g>
              );
            })}

            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={BASE}
              y2={BASE}
              className="stroke-line"
            />
          </svg>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
          <span>Numbers below = hour of the Dhaka day (0–23)</span>
          <span>
            Counted work this day{' '}
            <Duration seconds={data.totalActiveSec} className="text-ink-2" />
          </span>
        </div>
      </Card>

      {overFull && (
        <Caveat>
          Some hours hold <b>more than 60 minutes</b> — one person had two PCs
          running then, and that time is counted twice.
        </Caveat>
      )}
    </>
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
