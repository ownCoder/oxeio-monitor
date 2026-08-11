import { useMemo, useState, type ReactNode } from 'react';

import { getAttendanceReport, reportXlsxUrl } from '../api/reports';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, Stat, StatRow } from '../components/Card';
import { MonthPicker } from '../components/DatePicker';
import { Button, Page, SectionHead } from '../components/Page';
import { Caveat, Empty, ErrorBox, Loading } from '../components/States';
import { ErrorNote } from '../components/Field';
import { useXlsxDownload } from '../lib/download';
import {
  formatDate,
  formatHoursAsDuration,
  formatMonth,
  monthEndOf,
  monthKeyOf,
  todayInDhaka,
} from '../lib/format';
import { HeatGrid } from './monthly/HeatGrid';
import { buildMonthGrid, type GridSort } from './monthly/heatmap';

/**
 * E07 — মাসিক অগ্রগতি (`/monthly`)।
 *
 * ⭐ এটাই মালিকের সবচেয়ে বেশি দেখা পর্দা, আর এর একটাই প্রশ্ন:
 *   **মাস শেষ হওয়ার আগেই কার ঘাটতি হচ্ছে?** তাই পাতাটা উত্তরটাকেই উপরে
 *   রাখে — সবচেয়ে পিছিয়ে থাকা মানুষটা প্রথম সারিতে, আর "পিছিয়ে আছেন"
 *   সংখ্যাটা টাইলের সারিতে। হিটম্যাপটা ব্যাখ্যা, উত্তর নয়।
 *
 * ⚠️ **ডেটা `GET /reports/attendance` থেকে, এবং ওটা আজ পর্যন্ত ছেঁটে দেয়**
 *   (`meta.clampedToToday`)। ফলে "এ পর্যন্ত হওয়ার কথা" আর "মাসের টার্গেট"
 *   দুটো আলাদা সংখ্যা, আর দুটোই দেখাতে হয়। শুধু ২০৮ দেখালে ১১ তারিখে
 *   সবাইকে ভয়ংকর পিছিয়ে মনে হতো; শুধু "এ পর্যন্ত" দেখালে মাসটা কোথায়
 *   যাচ্ছে বোঝা যেত না।
 *
 * ⚠️ রিপোর্ট owner + manager দুজনেরই (§ ৪.৩), তাই এখানে owner-only কিছু
 *   নেই — টাকার কোনো ফিল্ডও এই endpoint-এ নেই। স্টাফ ঢুকলে ৪০৩ পেত, তাই
 *   তাকে রিকোয়েস্টটা করতেই দেওয়া হয় না (নিচে দেখুন)।
 */
export function MonthlyPage() {
  const { user } = useAuth();

  // ⭐ স্টাফের জন্য এই পর্দাটা সহকর্মীদের তালিকা — ৪০৩ ধরার আগেই থামানো
  //   ভালো, নইলে প্রতিবার ঢুকলে সার্ভারে একটা অর্থহীন কল যেত।
  if (user?.role === 'employee') {
    return (
      <Page title="Monthly">
        <Empty
          title="You don't have access"
          hint="Everyone's monthly hours are for the owner and managers only."
        />
      </Page>
    );
  }

  return <MonthlyBoard />;
}

function MonthlyBoard() {
  const today = todayInDhaka();
  const [month, setMonth] = useState(() => monthKeyOf(today));
  const [sort, setSort] = useState<GridSort>('pace');
  const download = useXlsxDownload();

  const from = `${month}-01`;
  const to = monthEndOf(from);

  // ⚠️ পুরো মাস চাওয়া হয়, ছাঁটাইটা সার্ভারের কাজ। নিজে থেকে `to = আজ`
  //    বসালে `meta.clampedToToday` কখনো সত্যি হতো না, আর "৩১ তারিখ পর্যন্ত
  //    চেয়েছিলাম, পেলাম ১১ পর্যন্ত" কথাটা বলার সুযোগই থাকত না।
  const { data, error, loading, reload } = useApi(
    (signal) => getAttendanceReport({ from, to }, signal),
    [from, to],
  );

  /**
   * ⚠️ ক্যালেন্ডারের মাসটা `month` state থেকে নয়, **`data.meta.from` থেকে**।
   *    মাস বদলানোর পর `useApi` নতুন ডেটা আনা শুরু করার আগে এক ফ্রেমের জন্য
   *    পুরোনো রেসপন্স হাতে থাকে; state ধরে নিলে ওই ফ্রেমে সেপ্টেম্বরের
   *    ক্যালেন্ডারে আগস্টের সারি বসত — সব ঘর ফাঁকা, যেন ডেটা হারিয়ে গেছে।
   *    গ্রিড সবসময় তার নিজের ডেটার মাসই আঁকে।
   */
  const grid = useMemo(
    () => (data ? buildMonthGrid(data, monthKeyOf(data.meta.from), sort) : null),
    [data, sort],
  );

  const actions = (
    <>
      <MonthPicker value={month} onChange={setMonth} max={monthKeyOf(today)} />
      {/*
        F05 — ⚠️ আগে এখানে সাধারণ `<a href download>` ছিল, আর সেটা দুটো
        কারণে বদলানো হয়েছে:
          ১· **৪০৩/৪০০ এলে ব্রাউজার নীরবে একটা JSON ফাইল `.xlsx` নামে
             সেভ করত।** কেউ Excel-এ খুলে "ফাইলটা নষ্ট" দেখত, অথচ আসল
             ঘটনা ছিল "অনুমতি নেই"।
          ২· রিপোর্ট পেজে ঠিক এই কাজটাই fetch দিয়ে হয় — একই বোতাম দুই
             পাতায় দুই রকম আচরণ করলে কোনটা সত্যি বোঝার উপায় থাকত না।
        এখন দুজনেই `useXlsxDownload()` — URL এখনো `reportXlsxUrl()`-ই বানায়।
      */}
      <Button
        onClick={() =>
          download.start(
            reportXlsxUrl('attendance', { from, to }),
            `oxeio-attendance-${from}_${to}.xlsx`,
          )
        }
        disabled={download.busy}
        title="The file is built on the server first, then downloads"
      >
        {download.busy ? 'Preparing…' : 'Excel'}
      </Button>
    </>
  );

  return (
    <Page
      title="Monthly"
      subtitle={
        // ⚠️ মাসের নামও ডেটার `meta` থেকে — পর্দার প্রতিটা সংখ্যা যেন একই
        //    রেসপন্সের কথা বলে (উপরের `grid`-এর নোট দেখুন)
        data
          ? `${formatMonth(monthKeyOf(data.meta.from))} · counted from ${formatDate(data.meta.from)} to ${formatDate(data.meta.to)}`
          : formatMonth(month)
      }
      actions={actions}
    >
      {/* ⚠️ ডাউনলোডের ভুলটা দেখানোই এই বদলের পুরো কারণ — লুকিয়ে ফেললে
             আগের `<a>`-এর নীরব ব্যর্থতাই ফিরে আসত */}
      {download.error && (
        <div className="mb-3">
          <ErrorNote>{download.error}</ErrorNote>
        </div>
      )}

      {loading && !data ? (
        <Loading label="Loading the month…" />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !grid || grid.rows.length === 0 ? (
        <Empty
          title={`Nothing counted in ${formatMonth(month)} yet`}
          hint="Have staff been added, and is the agent installed on their computers? Hours start adding up from the day after the agent runs."
        />
      ) : (
        <div className="space-y-4">
          <StatRow>
            <Stat label="Staff" value={grid.totals.employees} />
            <Stat
              label="Counted so far"
              value={formatHoursAsDuration(grid.totals.creditedHours)}
            />
            <Stat
              label="Expected so far"
              value={formatHoursAsDuration(grid.totals.expectedHours)}
              tone="muted"
            />
            {/*
              ⚠️ এক পর্দায় একটাই লাল টাইল — এটাই সেটা। বাকি সব ধূসর/কালো,
                 নইলে লাল রঙের মানেই হারিয়ে যেত।
            */}
            <Stat
              label="Behind"
              value={grid.totals.behind}
              unit={`/${grid.totals.employees}`}
              tone={grid.totals.behind > 0 ? 'attention' : 'muted'}
            />
            <Stat
              label="Everyone's monthly target"
              value={
                grid.totals.monthTargetHours === null
                  ? '—'
                  : `${grid.totals.monthTargetEstimated ? '≈' : ''}${formatHoursAsDuration(grid.totals.monthTargetHours)}`
              }
              tone="muted"
            />
          </StatRow>

          <div>
            <SectionHead
              title="Staff × date"
              // ⚠️ "darker" লেখা যাবে না — র‍্যাম্পটা `--color-ink`-এর উপর
              //    অস্বচ্ছতা, আর `ink` লাইট থিমে কালো, ডার্কে সাদা। অর্থাৎ
              //    ডার্কে ঘণ্টা বাড়লে ঘর **উজ্জ্বল** হয়, গাঢ় নয় — লেখাটা
              //    ঠিক উল্টো বলত। থিম-নিরপেক্ষ শব্দই একমাত্র নিরাপদ।
              hint="The stronger a cell, the more hours were counted that day"
              actions={
                <SortToggle value={sort} onChange={setSort} />
              }
            />

            <Card padded={false}>
              <HeatGrid grid={grid} today={today} />
            </Card>

            {/*
              ⭐ মকআপের বাক্যটা — এটাই পুরো নিয়মের সারাংশ (§ ২.১-খ)।
              ⚠️ সংখ্যা ইংরেজি অঙ্কে (10, 6), বাংলা অঙ্কে নয়।
            */}
            <p className="mt-3 text-xs text-ink-3">
              <b className="font-semibold text-ink-2">Hours</b> are counted, not
              days. <span className="num">10</span> hours one day and{' '}
              <span className="num">6</span> the next is fine — what matters is
              reaching the month's total target.
            </p>

            <Notices
              clamped={data?.meta.clampedToToday ?? false}
              requestedTo={data?.meta.requestedTo ?? to}
              coveredTo={data?.meta.to ?? to}
              estimated={grid.totals.monthTargetEstimated}
              excluded={data?.meta.excludedEmployees ?? []}
            />
          </div>
        </div>
      )}
    </Page>
  );
}

/**
 * ⚠️ তিনটে বাক্যই **লুকোনো যাবে না** — তিনটেই "সংখ্যাটা যা দেখাচ্ছে তার
 *    চেয়ে কম নিশ্চিত" বলে। না বললে ছেঁটে দেওয়া রেঞ্জ দেখে সবাইকে পিছিয়ে
 *    থাকা মনে হতো, আর বাদ পড়া কর্মীরা নীরবে অদৃশ্য থাকতেন।
 */
function Notices({
  clamped,
  requestedTo,
  coveredTo,
  estimated,
  excluded,
}: {
  clamped: boolean;
  requestedTo: string;
  coveredTo: string;
  estimated: boolean;
  excluded: string[];
}) {
  const notes: ReactNode[] = [];

  if (clamped) {
    notes.push(
      <>
        The month is not over yet. Data was requested up to{' '}
        {formatDate(requestedTo)}, but only {formatDate(coveredTo)} is covered —
        so “Expected so far” is the target up to today, not for the whole month.
      </>,
    );
  }

  if (estimated) {
    notes.push(
      <>
        A monthly target marked <span className="num">≈</span> is an estimate —
        it drops if a new public holiday is declared on any of the remaining
        days.
      </>,
    );
  }

  if (excluded.length > 0) {
    notes.push(
      <>
        {excluded.length} people are missing from this count —{' '}
        {excluded.join(', ')}. They are inactive, but their last working day is
        not on file, so no target could be set for them.
      </>,
    );
  }

  if (notes.length === 0) return null;

  return (
    <>
      {notes.map((note, i) => (
        <Caveat key={i}>{note}</Caveat>
      ))}
    </>
  );
}

/**
 * সাজানোর ক্রম।
 * ⚠️ সরু আউটলাইন লাল = ব্র্যান্ড (বাছাই করা ট্যাব), সলিড লাল নয় — এটা ভুল
 *    নয়, শুধু একটা পছন্দ।
 */
function SortToggle({
  value,
  onChange,
}: {
  value: GridSort;
  onChange: (next: GridSort) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11.5px] text-ink-3">Sort</span>
      <Tab active={value === 'pace'} onClick={() => onChange('pace')}>
        Shortfall first
      </Tab>
      <Tab active={value === 'name'} onClick={() => onChange('name')}>
        Name
      </Tab>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition focus:outline-none focus:ring-2 focus:ring-brand/30 ${
        active
          ? 'border-brand bg-surface text-brand-ink'
          : 'border-line bg-surface text-ink-3 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
