import { useState, type CSSProperties, type ReactNode } from 'react';

import { ProgressBar } from '../../components/ProgressRing';
import { PersonCell } from '../../components/Table';
import { Hours } from '../../components/Duration';
import { formatDate, formatHoursAsDuration, weekdayOf } from '../../lib/format';
import {
  PACE_EPSILON,
  type DayCell,
  type EmployeeGridRow,
  type MonthGrid,
} from './heatmap';

/**
 * E07 — স্টাফ × তারিখ হিটম্যাপ।
 *
 * ⭐ রঙের গভীরতা = ওই দিনের গোনা হওয়া ঘণ্টা, কিন্তু ⚠️ **রঙ দিয়েই সব
 *   বোঝানো যায় না**: রঙান্ধতা, ছোট পর্দা, প্রিন্ট — তিনটেই রঙকে অকেজো
 *   করে দেয়। তাই প্রতিটা ঘর একটা `<button>`:
 *     · মাউসে hover → `title`-এ সংখ্যা
 *     · আঙুলে tap / কিবোর্ডে Enter → নিচের পটিতে পুরো হিসাব
 *   ঘরগুলো `<div>` রাখলে ফোনে সংখ্যাটা দেখারই কোনো উপায় থাকত না।
 *
 * ⚠️ **লাল খুব মেপে**: শুধু কর্মদিবসে শূন্য ঘণ্টা (হালকা `brand-bg`) আর
 *    পিছিয়ে থাকার কলামে (`brand-ink`)। ছুটির দিনে ০ ঘণ্টা ফাঁকি নয় — ওখানে
 *    লাল বসালে প্রতি শুক্রবার গোটা পর্দা লাল হয়ে যেত আর লাল রঙের মানেই
 *    হারিয়ে যেত।
 */

/**
 * ধূসর → কালো র‍্যাম্প, `level` ১…৪-এর জন্য (`level` ০ = কোনো ঘণ্টাই নেই,
 * সেটার আলাদা চেহারা)।
 * ⚠️ হার্ডকোড রং নয় — ব্র্যান্ড টোকেনের উপর অস্বচ্ছতা (index.css দ্রষ্টব্য)।
 */
const RAMP = ['bg-ink/20', 'bg-ink/45', 'bg-ink/70', 'bg-ink'] as const;

/**
 * ছুটির দিনের তির্যক দাগ।
 * ⭐ দাগটা টোকেন (`--color-line`) থেকেই রং নেয়, তাই থিম বদলালে সাথে বদলায়।
 *   সলিড ধূসর বসালে সেটা র‍্যাম্পের মাঝের ধাপের মতোই দেখাত — অর্থাৎ "ছুটি"
 *   আর "আধা দিন কাজ" এক দেখাত।
 */
const OFF_PATTERN: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, var(--color-line) 0 2px, transparent 2px 5px)',
};

const DAY_TYPE_LABEL = {
  workday: 'কর্মদিবস',
  weekly_off: 'সাপ্তাহিক ছুটি',
  holiday: 'সরকারি ছুটি',
} as const;

export function HeatGrid({
  grid,
  today,
}: {
  grid: MonthGrid;
  /** ঢাকার আজ — কলামটা আলাদা করে চেনানোর জন্য */
  today: string;
}) {
  // ⚠️ শুধু চাবি রাখা হয়, ঘরের অবজেক্ট নয় — মাস বদলালে পুরোনো অবজেক্ট
  //    ধরে রাখলে নতুন গ্রিডের সাথে না মেলা এক টুকরো তথ্য পর্দায় বসে থাকত।
  const [picked, setPicked] = useState<{ employeeId: number; date: string } | null>(
    null,
  );

  const pickedRow = grid.rows.find((r) => r.employeeId === picked?.employeeId);
  const pickedCell = pickedRow?.cells.find((c) => c.date === picked?.date);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium text-ink-3"
              >
                স্টাফ
              </th>

              {grid.days.map((date) => (
                <th
                  key={date}
                  scope="col"
                  title={`${formatDate(date)} · ${weekdayOf(date)}`}
                  className={`num px-0 py-2 text-center text-[10px] font-semibold ${
                    date === today
                      ? 'text-brand-ink'
                      : grid.officeOffDays.has(date) || grid.futureDays.has(date)
                        ? 'text-ink-3/60'
                        : 'text-ink-3'
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </th>
              ))}

              <th scope="col" className="px-3 py-2 pl-5 text-right font-medium text-ink-3">
                হয়েছে
              </th>
              <th
                scope="col"
                title="এ পর্যন্ত যতটুকু হওয়ার কথা ছিল"
                className="px-3 py-2 text-right font-medium text-ink-3"
              >
                হওয়ার কথা
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
                পিছিয়ে / এগিয়ে
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
                মাসের টার্গেট
              </th>
            </tr>
          </thead>

          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.employeeId} className="border-b border-line/70 last:border-0">
                {/*
                  ⭐ পিছিয়ে/এগিয়ে সংখ্যাটা **এই জমে থাকা কলামেই** আবার লেখা।
                     ৩১টা দিনের কলামের পর ডানদিকের সংখ্যাগুলো ছোট পর্দায়
                     স্ক্রল না করলে দেখাই যায় না — অথচ পর্দার একমাত্র প্রশ্নের
                     উত্তরটা ওখানেই। দুবার লেখা হচ্ছে জেনেই লেখা।
                  ⚠️ ফোনে সরু, ডেস্কটপে চওড়া — জমে থাকা কলাম বেশি জায়গা নিলে
                     ছোট পর্দায় হিটম্যাপের জন্য কিছুই বাঁচত না। সেই জায়গা
                     বাঁচাতেই empCode এখানে লেখা হয় না; কোড ও ডিপার্টমেন্ট
                     সারির `title`-এ আছে।
                */}
                <td
                  title={`${row.fullName} · ${row.empCode}${row.department ? ` · ${row.department}` : ''}`}
                  className="sticky left-0 z-10 w-36 max-w-36 border-r border-line bg-surface px-3 py-1 sm:w-52 sm:max-w-52"
                >
                  <PersonCell
                    fullName={row.fullName}
                    note={
                      <>
                        <Pace hours={row.paceHours} compact />
                        {/*
                          ⚠️ এখানে `formatDateShort()` নয়। গোটা গ্রিডটাই এক
                             মাসের, তাই মাসের নাম বাড়তি — আর সরু কলামে
                             "5 আগস্ট থেকে" লিখলে ঘাটতির সংখ্যাটাই কেটে যেত।
                        */}
                        {row.partial &&
                          ` · ${Number(row.partial.from.slice(8, 10))} তারিখ থেকে`}
                      </>
                    }
                  />
                </td>

                {row.cells.map((cell) => (
                  <td key={cell.date} className="p-px">
                    <Cell
                      cell={cell}
                      fullName={row.fullName}
                      selected={
                        picked?.employeeId === row.employeeId &&
                        picked.date === cell.date
                      }
                      onPick={() =>
                        setPicked((prev) =>
                          prev?.employeeId === row.employeeId &&
                          prev.date === cell.date
                            ? null
                            : { employeeId: row.employeeId, date: cell.date },
                        )
                      }
                    />
                  </td>
                ))}

                <td className="px-3 py-1 pl-5 text-right font-semibold">
                  <Hours hours={row.creditedHours} />
                </td>
                <td className="px-3 py-1 text-right">
                  <Hours hours={row.expectedHours} tone="muted" />
                </td>
                <td className="px-3 py-1 text-right">
                  <Pace hours={row.paceHours} />
                </td>
                <td className="px-3 py-1 text-right">
                  <MonthTarget row={row} />
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot className="border-t border-line bg-paper font-medium">
            <tr>
              <td className="sticky left-0 z-10 border-r border-line bg-paper px-3 py-2 text-[12px] text-ink-2">
                সবাই মিলে
              </td>
              <td colSpan={grid.days.length} />
              <td className="px-3 py-2 pl-5 text-right">
                <Hours hours={grid.totals.creditedHours} />
              </td>
              <td className="px-3 py-2 text-right">
                <Hours hours={grid.totals.expectedHours} tone="muted" />
              </td>
              <td className="px-3 py-2 text-right">
                <Pace hours={grid.totals.creditedHours - grid.totals.expectedHours} />
              </td>
              <td className="num px-3 py-2 text-right text-ink-3">
                {grid.totals.monthTargetHours === null
                  ? '—'
                  : `${grid.totals.monthTargetEstimated ? '≈' : ''}${formatHoursAsDuration(grid.totals.monthTargetHours)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <CellDetail row={pickedRow ?? null} cell={pickedCell ?? null} />
      <Legend />
    </div>
  );
}

// ── একটা ঘর ─────────────────────────────────────────────────────────────────

function Cell({
  cell,
  fullName,
  selected,
  onPick,
}: {
  cell: DayCell;
  fullName: string;
  selected: boolean;
  onPick: () => void;
}) {
  const label = cellLabel(cell, fullName);
  const off = cell.kind === 'day' && cell.dayType !== 'workday';
  const worked = cell.creditedHours > 0;

  // ⭐ চারটে আলাদা অবস্থা, চারটে আলাদা চেহারা — একটাও রঙের গভীরতার উপর
  //   নির্ভর করে না, তাই রঙ না বুঝলেও পার্থক্যটা টের পাওয়া যায়।
  let look = '';
  let style: CSSProperties | undefined;

  if (cell.kind === 'future') {
    look = 'border border-dashed border-line';
  } else if (cell.kind === 'outside') {
    look = 'border border-dotted border-line/60 opacity-50';
  } else if (off && !worked) {
    // ⚠️ ছুটির দিনে ০ ঘণ্টা = ফাঁকি নয়। এখানে কোনো লাল নেই, কোনো র‍্যাম্প নেই।
    look = 'border border-line';
    style = OFF_PATTERN;
  } else if (!off && !worked) {
    // কর্মদিবসে কিছুই হয়নি — একমাত্র জায়গা যেখানে ঘরে লালের ছোঁয়া
    look = 'bg-brand-bg ring-1 ring-brand/25 ring-inset';
  } else {
    // ⚠️ `level` এখানে সবসময় ১…৪ (০ হলে উপরের শাখাতেই ধরা পড়ত), তাই −১।
    // ছুটির দিনে কাজ হলে র‍্যাম্পের উপরে সরু ব্র্যান্ড-লাল রেখা (সলিড নয়)
    look = `${RAMP[cell.level - 1]} ${off ? 'ring-1 ring-brand ring-inset' : ''}`;
  }

  return (
    <button
      type="button"
      onClick={onPick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      style={style}
      className={`block size-[18px] rounded-[3px] transition focus:outline-none focus:ring-2 focus:ring-brand/40 ${look} ${
        selected ? 'outline outline-2 outline-offset-1 outline-ink' : ''
      }`}
    />
  );
}

function cellLabel(cell: DayCell, fullName: string): string {
  const when = `${fullName} · ${formatDate(cell.date)} (${weekdayOf(cell.date)})`;

  if (cell.kind === 'future') return `${when} · দিনটা এখনো আসেনি`;
  if (cell.kind === 'outside') return `${when} · কর্মকালের বাইরে`;

  const type = cell.dayType ? DAY_TYPE_LABEL[cell.dayType] : '';
  const target =
    cell.targetHours > 0
      ? `টার্গেট ${formatHoursAsDuration(cell.targetHours)}`
      : 'কোনো টার্গেট নেই';

  return `${when} · ${type} · গোনা হয়েছে ${formatHoursAsDuration(cell.creditedHours)} · ${target}`;
}

// ── বেছে নেওয়া ঘরের পুরো হিসাব (ফোনে এটাই একমাত্র উপায়) ────────────────────

function CellDetail({
  row,
  cell,
}: {
  row: EmployeeGridRow | null;
  cell: DayCell | null;
}) {
  // ⚠️ উচ্চতা সবসময় একই — নইলে ঘরে চাপ দিলে গোটা গ্রিডটা লাফিয়ে উঠত আর
  //    আঙুলের নিচের ঘরটাই সরে যেত।
  if (!row || !cell) {
    return (
      <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
        কোনো ঘরে চাপ দিন — ওই দিনের পুরো হিসাব এখানে আসবে।
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line bg-paper px-4 py-2.5 text-xs">
      <span className="font-semibold text-ink">{row.fullName}</span>
      <span className="num text-ink-2">
        {formatDate(cell.date)} · {weekdayOf(cell.date)}
      </span>

      {cell.kind === 'future' && <span className="text-ink-3">দিনটা এখনো আসেনি</span>}
      {cell.kind === 'outside' && (
        <span className="text-ink-3">ওই দিনে ইনি অফিসে ছিলেন না</span>
      )}

      {cell.kind === 'day' && (
        <>
          <span className="text-ink-3">
            {cell.dayType ? DAY_TYPE_LABEL[cell.dayType] : ''}
          </span>
          <Field label="কাজ" value={<Hours hours={cell.workedHours} />} />
          {cell.adjustmentHours !== 0 && (
            <Field
              label="owner-এর সংশোধন"
              value={
                <span className="num">
                  {cell.adjustmentHours > 0 ? '+' : '−'}
                  {formatHoursAsDuration(Math.abs(cell.adjustmentHours))}
                </span>
              }
            />
          )}
          <Field
            label="গোনা হয়েছে"
            value={<Hours hours={cell.creditedHours} className="font-semibold" />}
          />
          <Field
            label="টার্গেট"
            value={
              cell.targetHours > 0 ? (
                <Hours hours={cell.targetHours} tone="muted" />
              ) : (
                <span className="text-ink-3">নেই</span>
              )
            }
          />
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="text-ink-3">
      {label} <span className="text-ink">{value}</span>
    </span>
  );
}

// ── পিছিয়ে / এগিয়ে ──────────────────────────────────────────────────────────

/**
 * ⭐ এই একটা কলামই পর্দার আসল উত্তর — "কে পিছিয়ে আছে"।
 * ⚠️ `credited − expected`, `worked − expected` নয় (§ ২.১-ঙ) — নইলে owner-এর
 *    দেওয়া সংশোধন এখানে উধাও হয়ে যেত আর ঠিক করা ঘাটতি আবার ঘাটতি দেখাত।
 */
function Pace({ hours, compact = false }: { hours: number; compact?: boolean }) {
  if (Math.abs(hours) <= PACE_EPSILON) {
    return <span className="num text-ink-3">সমান</span>;
  }

  const behind = hours < 0;
  const amount = formatHoursAsDuration(Math.abs(hours));

  // ⚠️ সরু কলামে `−`/`+` চিহ্নটা অনেকের চোখেই পড়ে না, তাই ওখানে কথায় লেখা
  return (
    <span className={`num ${behind ? 'font-semibold text-brand-ink' : 'text-ink'}`}>
      {compact ? `${behind ? 'পিছিয়ে' : 'এগিয়ে'} ${amount}` : `${behind ? '−' : '+'}${amount}`}
    </span>
  );
}

function MonthTarget({ row }: { row: EmployeeGridRow }) {
  if (row.monthTargetHours === null) {
    return (
      <span
        className="num text-ink-3"
        title="মাসের সাপ্তাহিক ছুটির দিনটা এখনো আসেনি, তাই পুরো মাসের টার্গেট এখনই বলা যাচ্ছে না"
      >
        —
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-end gap-2">
      <ProgressBar
        value={row.creditedHours}
        max={row.monthTargetHours}
        className="w-14"
      />
      <span
        className="num text-ink-3"
        title={
          row.monthTargetEstimated
            ? 'মাস এখনো শেষ হয়নি — বাকি দিনে নতুন ছুটি ঘোষণা হলে টার্গেট কমবে'
            : undefined
        }
      >
        {row.monthTargetEstimated ? '≈' : ''}
        {formatHoursAsDuration(row.monthTargetHours)}
      </span>
    </span>
  );
}

// ── রঙের ব্যাখ্যা ───────────────────────────────────────────────────────────

/**
 * ⚠️ বাদ দেবেন না। র‍্যাম্পের পাঁচটা ধূসর নিজে থেকে কিছুই বলে না — "কালো
 *    মানে দিনের টার্গেট পূর্ণ" কথাটা কোথাও লেখা না থাকলে সবাই নিজের মতো
 *    অর্থ বানিয়ে নিত।
 */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-[11px] text-ink-3">
      <span className="flex items-center gap-1.5">
        কম
        {RAMP.map((tone) => (
          <i key={tone} className={`size-3 rounded-[3px] ${tone}`} />
        ))}
        দিনের টার্গেট পূর্ণ
      </span>

      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] bg-brand-bg ring-1 ring-brand/25 ring-inset" />
        কর্মদিবস, <span className="num">0</span> ঘণ্টা
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] border border-line" style={OFF_PATTERN} />
        সাপ্তাহিক / সরকারি ছুটি
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] bg-ink/45 ring-1 ring-brand ring-inset" />
        ছুটির দিনে কাজ
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] border border-dashed border-line" />
        এখনো আসেনি
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] border border-dotted border-line/60 opacity-50" />
        কর্মকালের বাইরে
      </span>
    </div>
  );
}
