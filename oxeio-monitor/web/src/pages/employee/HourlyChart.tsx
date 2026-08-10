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
 * (কালো = গোনা হওয়া কাজ) লাইব্রেরির ডিফল্ট প্যালেটের সাথে লড়ত।
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
        title="ঘণ্টাভিত্তিক কাজ"
        hint="শুধু গোনা হওয়া সময় · ঢাকার ঘড়ি ধরে 24টা ঘণ্টা"
      />

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !data || data.buckets.length === 0 || data.totalActiveSec === 0 ? (
        <Empty
          title="এই দিনে গোনা হওয়ার মতো কোনো কাজ নেই"
          hint="নিষ্ক্রিয় বা লক থাকা সময় এই চার্টে আসে না। উপরের টাইমলাইনে ধূসর দাগ থাকলে PC চলছিল, কিন্তু কাজ গোনা হয়নি।"
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

  return (
    <>
      <Card padded={false}>
        {/* ⚠️ চওড়া চার্ট **নিজের ফ্রেমে** স্ক্রল করে, পুরো পাতা নয় (E12) */}
        <div className="overflow-x-auto p-4">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block w-full min-w-[620px]"
            role="img"
            aria-label={`ঘণ্টাভিত্তিক কাজ — মোট ${formatDuration(data.totalActiveSec)}`}
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
              60মি
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
          <span>নিচের সংখ্যা = ঢাকার ঘণ্টা (0–23)</span>
          <span>
            দিনের মোট গোনা কাজ{' '}
            <Duration seconds={data.totalActiveSec} className="text-ink-2" />
          </span>
        </div>
      </Card>

      {overFull && (
        <Caveat>
          কোনো কোনো ঘণ্টায় <b>60 মিনিটের বেশি</b> জমেছে — ওই সময়ে একজনেরই
          দুটো PC চলেছে, আর সময়টা দুবার গোনা হয়েছে।
        </Caveat>
      )}
    </>
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
