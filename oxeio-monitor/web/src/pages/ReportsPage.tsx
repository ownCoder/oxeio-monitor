import { useState, type ReactNode } from 'react';

import { reportXlsxUrl, type GroupBy } from '../api/reports';
import { useAuth } from '../auth/AuthContext';
import { DateRange, MonthPicker } from '../components/DatePicker';
import { EmployeePicker } from '../components/EmployeePicker';
import { ErrorNote } from '../components/Field';
import { Button, Page } from '../components/Page';
import { Empty } from '../components/States';
import { Tabs, type TabItem } from '../components/Tabs';
import { useXlsxDownload } from '../lib/download';
import { formatDate, formatMonth, thisMonthRange, todayInDhaka } from '../lib/format';
import { AttendanceTab } from './reports/AttendanceTab';
import { PayrollTab } from './reports/PayrollTab';
import { ProductivityTab } from './reports/ProductivityTab';
import { SummaryTab } from './reports/SummaryTab';
import { MAX_REPORT_DAYS, rangeDays } from './reports/shared';

/**
 * F01 · F02 · F03 · F04 · F05 · F08 — রিপোর্ট।
 *
 * প্রবাহ: রেঞ্জ বাছুন (F08) → ধরন বাছুন → টেবিল → Excel (F05)।
 *
 * ⭐⚠️ **পে-রোল ট্যাবটা ম্যানেজার দেখতেই পান না।** `TABS` তালিকাটাই
 *    `user.role === 'owner'` দিয়ে ছাঁকা হয়। ৪০৩ ধরে "অনুমতি নেই" দেখানো
 *    যথেষ্ট নয় — তাহলেও ট্যাবের নামটা থেকে যেত, আর **বেতনের ব্যবস্থাটা যে
 *    আছে** সেটুকুই ফাঁস হয়ে যেত (§ ৪.৩, ADR-023)।
 *
 * ⭐ রেঞ্জ, স্টাফ, groupBy — সব নিয়ন্ত্রণ এই পেজে থাকে, ট্যাবগুলোতে নয়।
 *    তাই ট্যাব বদলালে বাছাই করা তারিখটা হারায় না, আর ডাউনলোডের লিঙ্কটা
 *    ঠিক যা পর্দায় দেখা যাচ্ছে তারই — দুটো আলাদা হয়ে যাওয়ার পথ নেই।
 */

type TabId = 'attendance' | 'summary' | 'productivity' | 'payroll';

interface TabDef extends TabItem<TabId> {
  /** ⭐ পে-রোল ছাড়া বাকি সব owner + manager দুজনেরই */
  ownerOnly?: boolean;
}

const TABS: TabDef[] = [
  { id: 'attendance', label: 'Attendance' },
  { id: 'summary', label: 'Summary' },
  { id: 'productivity', label: 'Apps & sites' },
  { id: 'payroll', label: 'Payroll', ownerOnly: true },
];

/** সার্ভারের ডিফল্টও ২৫ — এক রাখা হয়েছে যাতে পর্দা আর Excel এক কথা বলে */
const TOP_LIMITS = [25, 50, 100, 200];

export function ReportsPage() {
  const { user } = useAuth();

  /**
   * ⭐ স্টাফের জন্য `/reports/*` **আর** `/employees` — দুটোই ৪০৩
   *   (দুটোতেই ক্লাস-লেভেল `@Roles(owner, manager)`)। গার্ড না দিলে
   *   ঠিকানা টাইপ করে আসা স্টাফ প্রতিবার দুটো নিশ্চিত-ব্যর্থ রিকোয়েস্ট
   *   পাঠাত, আর পর্দায় সহকর্মীদের বাছার ড্রপডাউনসহ পুরো রিপোর্টের
   *   কাঠামোটা দেখত — শুধু ভেতরের সংখ্যাগুলো ছাড়া। `MonthlyPage` ও
   *   `SettingsPage` এই একই ছাঁচেই থামায়।
   */
  if (user?.role === 'employee') {
    return (
      <Page title="Reports">
        <Empty
          title="You don't have access"
          hint="Reports and exports are for the owner and managers only."
        />
      </Page>
    );
  }

  return <ReportsBoard isOwner={user?.role === 'owner'} />;
}

function ReportsBoard({ isOwner }: { isOwner: boolean }) {
  const tabs = TABS.filter((tab) => !tab.ownerOnly || isOwner);

  const [tab, setTab] = useState<TabId>('attendance');
  // ⚠️ `new Date().toISOString().slice(0,10)` নয় — ঢাকায় রাত ১২টা–ভোর ৬টায়
  //    ওটা আগের তারিখ দিত, আর রিপোর্ট এক দিন পিছিয়ে খুলত।
  const [range, setRange] = useState(() => thisMonthRange());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const [limit, setLimit] = useState(TOP_LIMITS[0]);
  const [month, setMonth] = useState(() => todayInDhaka().slice(0, 7));

  const download = useXlsxDownload();

  const isPayroll = tab === 'payroll';
  const days = rangeDays(range.from, range.to);
  // ⚠️ সার্ভার ৩৭০ দিনের বেশি নেয় না। আগেই ধরে ফেলা হয় যাতে একটা
  //    নিশ্চিত-ব্যর্থ রিকোয়েস্ট পাঠাতেই না হয় — বড় রেঞ্জে ওটা কয়েক
  //    সেকেন্ড অপেক্ষার পর ৪০০ হতো।
  const tooLong = !isPayroll && days > MAX_REPORT_DAYS;

  const startDownload = (): void => {
    // ⚠️ `isPayroll` দিয়ে নয়, সরাসরি তুলনা — এতে TypeScript নিজেই নিশ্চিত
    //    করে যে `reportXlsxUrl()`-এ কখনো `'payroll'` যাবে না। ওই endpoint
    //    সার্ভারে নেই-ই।
    if (tab === 'payroll') return;

    const query = {
      from: range.from,
      to: range.to,
      employeeId: employeeId ?? undefined,
      groupBy: tab === 'summary' ? groupBy : undefined,
      limit: tab === 'productivity' ? limit : undefined,
    };
    download.start(
      reportXlsxUrl(tab, query),
      `oxeio-${tab}-${range.from}_${range.to}.xlsx`,
    );
  };

  return (
    <Page
      title="Reports"
      subtitle={
        isPayroll
          ? `${formatMonth(month)} — monthly payroll hours`
          : `${formatDate(range.from)} — ${formatDate(range.to)} · ${days} days`
      }
      actions={
        // ⚠️ পে-রোলের কোনো Excel endpoint সার্ভারে নেই — বোতামটা দেখালে
        //    ওটা নিশ্চিতভাবে ৪০৪ দিত।
        !isPayroll && (
          <Button
            onClick={startDownload}
            disabled={download.busy || tooLong}
            tone="primary"
            title="The file is built on the server first — a long range takes a moment"
          >
            {download.busy ? 'Preparing…' : 'Download Excel'}
          </Button>
        )
      }
    >
      <Tabs
        items={tabs}
        active={tab}
        label="Report type"
        onChange={(next) => {
          setTab(next);
          // আগের ট্যাবের ডাউনলোড-ভুলটা নতুন ট্যাবে ঝুলিয়ে রাখা যায় না
          download.clear();
        }}
      />

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {isPayroll ? (
          <MonthPicker value={month} onChange={setMonth} />
        ) : (
          <>
            <DateRange
              from={range.from}
              to={range.to}
              onChange={setRange}
            />
            <EmployeePicker
              value={employeeId}
              onChange={setEmployeeId}
              allowAll
              allLabel="Everyone"
              // ⚠️ চলে যাওয়া কর্মীর পুরোনো মাসও রিপোর্টে লাগে, তাই
              //    নিষ্ক্রিয়দেরও তালিকায় রাখা হয়
              includeInactive
            />

            {tab === 'summary' && (
              <SelectField
                label="Group by"
                value={groupBy}
                onChange={(next) => setGroupBy(next as GroupBy)}
                options={[
                  { value: 'month', label: 'Month' },
                  { value: 'week', label: 'Week' },
                ]}
              />
            )}

            {tab === 'productivity' && (
              <SelectField
                label="Top how many"
                value={String(limit)}
                onChange={(next) => setLimit(Number(next))}
                options={TOP_LIMITS.map((n) => ({
                  value: String(n),
                  label: String(n),
                }))}
              />
            )}
          </>
        )}
      </div>

      {download.error && (
        <div className="mt-3">
          <ErrorNote>{download.error}</ErrorNote>
        </div>
      )}

      <div className="mt-4">
        {tooLong ? (
          <RangeTooLong days={days} />
        ) : tab === 'attendance' ? (
          <AttendanceTab
            from={range.from}
            to={range.to}
            employeeId={employeeId}
          />
        ) : tab === 'summary' ? (
          <SummaryTab
            from={range.from}
            to={range.to}
            employeeId={employeeId}
            groupBy={groupBy}
          />
        ) : tab === 'productivity' ? (
          <ProductivityTab
            from={range.from}
            to={range.to}
            employeeId={employeeId}
            limit={limit}
          />
        ) : (
          // ⭐ এখানে পৌঁছানোর একমাত্র পথ owner-এর বাছাই করা ট্যাব
          <PayrollTab month={month} />
        )}
      </div>
    </Page>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] text-ink-3">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * ⚠️ এটা "ভুল হয়েছে" নয়, তাই সলিড লাল নয় — শুধু একটা সীমা। রিকোয়েস্টটা
 *    পাঠানোই হয় না, তাই ব্যবহারকারীকে অপেক্ষাও করতে হয় না।
 */
function RangeTooLong({ days }: { days: number }): ReactNode {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-2">That range is too long</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-3">
        One report covers at most <span className="num">{MAX_REPORT_DAYS}</span>{' '}
        days; you asked for <span className="num">{days}</span>. Move the start
        date closer.
      </p>
    </div>
  );
}
