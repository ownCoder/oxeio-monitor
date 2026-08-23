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
  workday: 'Workday',
  weekly_off: 'Weekly off',
  holiday: 'Holiday',
} as const;

/**
 * ⚠️ `1st / 2nd / 3rd / 4th` — ইংরেজিতে "since day 5" যন্ত্রের মতো শোনায়,
 *    আর সরু কলামে মাসের নাম বসানোর জায়গা নেই (নিচে `partial` দেখুন)।
 *    11–13 আলাদা করে ধরা, নইলে "11st" হতো।
 */
function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;

  const ones = day % 10;
  if (ones === 1) return `${day}st`;
  if (ones === 2) return `${day}nd`;
  if (ones === 3) return `${day}rd`;
  return `${day}th`;
}

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
                Staff
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
                Counted
              </th>
              <th
                scope="col"
                title="How much should have been done by today"
                className="px-3 py-2 text-right font-medium text-ink-3"
              >
                Expected
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
                Behind / Ahead
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
                Monthly target
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
                             "since 5 August" লিখলে ঘাটতির সংখ্যাটাই কেটে যেত।
                        */}
                        {row.partial &&
                          ` · since the ${ordinal(Number(row.partial.from.slice(8, 10)))}`}
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
                Everyone
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
                {grid.totals.targetHoursInRange === null
                  ? '—'
                  : `${grid.totals.monthTargetEstimated ? '≈' : ''}${formatHoursAsDuration(grid.totals.targetHoursInRange)}`}
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
      /**
       * ⚠️ ফোনে ঘর বড় (২৬px), ডেস্কটপে আগের ১৮px — কারণ ফোনে **এই ঘরটাই
       *    একমাত্র দরজা**: হোভার নেই, তাই একটা দিনের হিসাব দেখার আর কোনো
       *    উপায় নেই (`CellDetail`-এর নোট দেখুন)। ১৮px ঘরে পিচ দাঁড়াত ২০px,
       *    অর্থাৎ আঙুলের নিচে দুটো দিন — আর ভুল ঘরে চাপ পড়লে নিচের প্যানেলে
       *    **অন্য দিনের** হিসাব খুলত। তারিখটা ওখানে লেখা থাকে বলে ধরা পড়ে,
       *    কিন্তু কেউ না তাকালে ধরা পড়ে না।
       * ⚠️ ৪৪px (সুপারিশকৃত সর্বনিম্ন) দেওয়া হয়নি — ৩১টা কলামে ওটা ১৩৬৪px,
       *    অর্থাৎ প্রতিটা সারি পড়তে তিন পর্দা টানতে হতো। ২৬px-এ পিচ ২৮px,
       *    ভুল-ছোঁয়া অনেক কমে আর গ্রিডটা এক-দুই টানেই পার হয়।
       * ⭐ ডেস্কটপ এক পিক্সেলও বদলায়নি — ওখানে হোভারই যথেষ্ট।
       */
      className={`block size-[26px] rounded-[3px] transition focus:outline-none focus:ring-2 focus:ring-brand/40 sm:size-[18px] ${look} ${
        selected ? 'outline outline-2 outline-offset-1 outline-ink' : ''
      }`}
    />
  );
}

function cellLabel(cell: DayCell, fullName: string): string {
  const when = `${fullName} · ${formatDate(cell.date)} (${weekdayOf(cell.date)})`;

  if (cell.kind === 'future') return `${when} · day has not arrived yet`;
  if (cell.kind === 'outside') return `${when} · outside their time here`;

  const type = cell.dayType ? DAY_TYPE_LABEL[cell.dayType] : '';
  const target =
    cell.targetHours > 0
      ? `target ${formatHoursAsDuration(cell.targetHours)}`
      : 'no target';

  return `${when} · ${type} · counted ${formatHoursAsDuration(cell.creditedHours)} · ${target}`;
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
        Tap any cell — that day's full breakdown appears here.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line bg-paper px-4 py-2.5 text-xs">
      <span className="font-semibold text-ink">{row.fullName}</span>
      <span className="num text-ink-2">
        {formatDate(cell.date)} · {weekdayOf(cell.date)}
      </span>

      {cell.kind === 'future' && (
        <span className="text-ink-3">This day has not arrived yet</span>
      )}
      {cell.kind === 'outside' && (
        <span className="text-ink-3">They were not with the office that day</span>
      )}

      {cell.kind === 'day' && (
        <>
          <span className="text-ink-3">
            {cell.dayType ? DAY_TYPE_LABEL[cell.dayType] : ''}
          </span>
          <Field label="Worked" value={<Hours hours={cell.workedHours} />} />
          {cell.adjustmentHours !== 0 && (
            <Field
              label="Owner adjustment"
              value={
                <span className="num">
                  {cell.adjustmentHours > 0 ? '+' : '−'}
                  {formatHoursAsDuration(Math.abs(cell.adjustmentHours))}
                </span>
              }
            />
          )}
          <Field
            label="Counted"
            value={<Hours hours={cell.creditedHours} className="font-semibold" />}
          />
          <Field
            label="Target"
            value={
              cell.targetHours > 0 ? (
                <Hours hours={cell.targetHours} tone="muted" />
              ) : (
                <span className="text-ink-3">None</span>
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
    return <span className="num text-ink-3">On track</span>;
  }

  const behind = hours < 0;
  const amount = formatHoursAsDuration(Math.abs(hours));

  // ⚠️ সরু কলামে `−`/`+` চিহ্নটা অনেকের চোখেই পড়ে না, তাই ওখানে কথায় লেখা
  return (
    <span className={`num ${behind ? 'font-semibold text-brand-ink' : 'text-ink'}`}>
      {compact ? `${behind ? 'Behind' : 'Ahead'} ${amount}` : `${behind ? '−' : '+'}${amount}`}
    </span>
  );
}

function MonthTarget({ row }: { row: EmployeeGridRow }) {
  if (row.targetHoursInRange === null) {
    return (
      <span
        className="num text-ink-3"
        title="This person's target for these dates cannot be worked out yet"
      >
        —
      </span>
    );
  }

  /**
   * ⚠️⚠️ **০ আর "নেই" এক কথা নয়** — আর ০ এখন সত্যিই ঘটতে পারে।
   *
   * আগে এই ঘরে বসত পলিসির ফ্ল্যাট ২০৮, যা কখনো ০ হতো না। এখন সংখ্যাটা
   * অফিস-ডে ধরে গোনা, তাই পুরো সময়টা ছুটিতে থাকলে বা মাসের একেবারে শেষে
   * যোগ দিলে ০ আসে — বৈধভাবেই।
   *
   * ⭐ ProgressBar-এ পাঠালে `max={0}` হয়ে পর্দায় দাঁড়াত **"0h 0m, ০%"**,
   * অর্থাৎ "উনি ব্যর্থ" — অথচ আসল কথা ওঁর কোনো টার্গেটই ছিল না।
   */
  if (row.targetHoursInRange === 0) {
    return (
      <span
        className="num text-ink-3"
        title="No office days for this person in these dates — on leave throughout, or joined at the very end"
      >
        No target
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-end gap-2">
      <ProgressBar
        value={row.creditedHours}
        max={row.targetHoursInRange}
        className="w-14"
        ariaLabel="This month"
      />
      <span
        className="num text-ink-3"
        title={
          row.monthTargetEstimated
            ? 'The month is not over — the target drops if a new holiday is declared on a remaining day'
            : undefined
        }
      >
        {row.monthTargetEstimated ? '≈' : ''}
        {formatHoursAsDuration(row.targetHoursInRange)}
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
        Less
        {RAMP.map((tone) => (
          <i key={tone} className={`size-3 rounded-[3px] ${tone}`} />
        ))}
        Day's target met
      </span>

      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] bg-brand-bg ring-1 ring-brand/25 ring-inset" />
        Workday, <span className="num">0</span> hours
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] border border-line" style={OFF_PATTERN} />
        Weekly off / holiday
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] bg-ink/45 ring-1 ring-brand ring-inset" />
        Worked on a day off
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] border border-dashed border-line" />
        Not here yet
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded-[3px] border border-dotted border-line/60 opacity-50" />
        Outside their time here
      </span>
    </div>
  );
}
