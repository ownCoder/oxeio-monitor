import { useCallback, useMemo, useState, type FormEvent } from 'react';

import { getGallery, type GalleryQuery } from '../api/screenshots';
import { useApi } from '../api/useApi';
import { Card } from '../components/Card';
import { DateRange } from '../components/DatePicker';
import { EmployeePicker } from '../components/EmployeePicker';
import { Button, Page } from '../components/Page';
import { Empty, ErrorBox, Loading } from '../components/States';
import { useAuth } from '../auth/AuthContext';
import { formatCount, formatDate, shiftWorkDate, todayInDhaka } from '../lib/format';
import { Lightbox } from './gallery/Lightbox';
import { ShotGrid } from './gallery/ShotGrid';
import { useFreshUrls } from './gallery/useFreshUrls';
import { seesEveryone } from '../api/auth';

/**
 * E06 · I07 · I08 · J05 — স্ক্রিনশট গ্যালারি (`/screenshots`)।
 *
 * ⭐ এই পেজে `@Roles` নেই — owner, manager আর স্টাফ তিনজনেই আসে। পার্থক্যটা
 * **স্কোপে**: স্টাফের জন্য সার্ভার সেশন থেকেই `employeeId` বসায়, তাই এখানে
 * স্টাফ-ফিল্টারটা **দেখানোই হয় না** (J05)। দেখালে দুটো ক্ষতি হতো — সহকর্মীদের
 * নামের তালিকা ফাঁস হতো (`GET /employees` তার জন্য ৪০৩), আর অন্যের আইডি
 * বেছে সে ৪০৩ খেত, অথচ কন্ট্রোলটা তো তাকেই দেখানো হয়েছিল।
 *
 * ⭐ I08 — পেজে একটা **স্থায়ী** নোট: স্ক্রিনশট দেখা হলে সেটা audit log-এ
 * থাকে। এটা লুকোনোর জিনিস নয়, স্বচ্ছতার প্রতিশ্রুতির অংশ — স্টাফ জানে যে
 * তাকে দেখা হচ্ছে, আর কে দেখল সেটাও লেখা থাকছে।
 */
export function GalleryPage() {
  const { user } = useAuth();
  // J05 — স্টাফ শুধু নিজেরটা পায়, বাছাবাছির কিছু নেই
  /**
   * ⚠️ নামটা `isEmployee` **থাকল**, কিন্তু সূত্রটা উল্টে গেছে: এখন প্রশ্ন
   * *"ইনি কি গোটা দল দেখেন না?"*। ২৫ আগস্টের আগে লেখা ছিল
   * `role === 'employee'`, তাই গবেষক রোল এলে তিনি **সবার ছবি** আর
   * বাছাবাছির ঘরটাও পেতেন — সার্ভার আটকাত, পর্দা নয়।
   */
  const isEmployee = !seesEveryone(user?.role);

  const [range, setRange] = useState(() => {
    const today = todayInDhaka();
    return { from: today, to: today };
  });
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [timeBand, setTimeBand] = useState<NonNullable<GalleryQuery['timeBand']>>('all');
  const [appDraft, setAppDraft] = useState('');
  const [app, setApp] = useState('');
  const [monitorDraft, setMonitorDraft] = useState('');
  const [monitorIndex, setMonitorIndex] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  /** `null` = লাইটবক্স বন্ধ */
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  /**
   * ⚠️ ক্যোয়ারিটা `useMemo`-তে — এটাই `useApi`-র dep **আর** `useFreshUrls`-এর
   *    রিসেট-সংকেত। প্রতি রেন্ডারে নতুন অবজেক্ট বানালে দুটোই অসীমবার চলত।
   *
   * ⚠️ স্টাফের ক্ষেত্রে `employeeId` পাঠানোই হয় না — নিজের আইডি পাঠালেও
   *    কাজ হতো, কিন্তু সেটা `/auth/me`-র আইডির উপর ভরসা করা। সার্ভার সেশন
   *    থেকে নেয়, সেটাই একমাত্র সত্য।
   */
  const query = useMemo<GalleryQuery>(
    () => ({
      fromDate: range.from,
      toDate: range.to,
      page,
      employeeId: isEmployee ? undefined : (employeeId ?? undefined),
      timeBand: timeBand === 'all' ? undefined : timeBand,
      app: app || undefined,
      monitorIndex,
    }),
    [range.from, range.to, page, employeeId, isEmployee, timeBand, app, monitorIndex],
  );

  const { data, error, loading, reload } = useApi(
    (signal) => getGallery(query, signal),
    [query],
  );
  const urls = useFreshUrls(query);

  const items = data?.items ?? [];
  const today = todayInDhaka();
  const hasFilters = range.from !== today || range.to !== today || employeeId !== null || timeBand !== 'all' || !!app || monitorIndex !== undefined;
  const activeFilterCount = Number(range.from !== today || range.to !== today)
    + Number(employeeId !== null)
    + Number(timeBand !== 'all')
    + Number(!!app)
    + Number(monitorIndex !== undefined);

  /** ফিল্টার বদলালে পাতা ১-এ ফেরা — নইলে "Page 3" খালি দেখাত */
  const changeRange = (next: { from: string; to: string }) => {
    const span = (Date.parse(next.to) - Date.parse(next.from)) / 86_400_000;
    if (span > 6) {
      setRange(next.from !== range.from
        ? { from: next.from, to: shiftWorkDate(next.from, 6) }
        : { from: shiftWorkDate(next.to, -6), to: next.to });
    } else {
      setRange(next);
    }
    setPage(1);
    setOpenIndex(null);
  };

  const changeTimeBand = (next: NonNullable<GalleryQuery['timeBand']>) => {
    setTimeBand(next);
    setPage(1);
    setOpenIndex(null);
  };

  const applyTextFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApp(appDraft.trim());
    setMonitorIndex(monitorDraft ? Number(monitorDraft) - 1 : undefined);
    setPage(1);
    setOpenIndex(null);
  };

  const clearFilters = () => {
    const today = todayInDhaka();
    setRange({ from: today, to: today });
    setEmployeeId(null);
    setTimeBand('all');
    setAppDraft('');
    setApp('');
    setMonitorDraft('');
    setMonitorIndex(undefined);
    setPage(1);
    setOpenIndex(null);
  };

  const changeEmployee = useCallback((next: number | null) => {
    setEmployeeId(next);
    setPage(1);
    setOpenIndex(null);
  }, []);

  const changePage = useCallback((next: number) => {
    setPage(next);
    setOpenIndex(null);
    // ⚠️ পাতা বদলে স্ক্রল নিচেই থাকলে মনে হতো কিছুই হয়নি
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <Page
      title="Screenshots"
      subtitle={
        data
          ? `${formatDate(range.from)}${range.to === range.from ? '' : ` – ${formatDate(range.to)}`} · ${formatCount(data.total)} ${
              data.total === 1 ? 'image' : 'images'
            }`
          : formatDate(range.to)
      }
      actions={
        <>
          {!isEmployee && (
            <EmployeePicker
              value={employeeId}
              onChange={changeEmployee}
              // ⚠️ `label`/`allLabel` স্পষ্ট করে দেওয়া — কম্পোনেন্টের ডিফল্ট
              //    দুটো এখনো বাংলা, আর সেগুলো অন্য মালিকের ফাইলে
              label="Staff"
              allowAll
              allLabel="Everyone"
              // ⚠️ চলে যাওয়া কর্মীর পুরোনো দিনও দেখতে হয় — নইলে তার
              //    স্ক্রিনশট থাকা সত্ত্বেও নামটাই বাছা যেত না
              includeInactive
            />
          )}
        </>
      }
    >
      <AuditNote isEmployee={isEmployee} />
      <div className="mb-4 rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-end gap-3">
          <DateRange from={range.from} to={range.to} onChange={changeRange} />
          <Button onClick={() => changeRange({ from: todayInDhaka(), to: todayInDhaka() })}>Today</Button>
          <Button onClick={() => {
            const day = shiftWorkDate(todayInDhaka(), -1);
            changeRange({ from: day, to: day });
          }}>Yesterday</Button>
          <Button onClick={() => changeRange({ from: shiftWorkDate(todayInDhaka(), -6), to: todayInDhaka() })}>Last 7 days</Button>
          <label className="block text-xs text-ink-3">Time (Dhaka)
            <select
              className="mt-1 block rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] text-ink"
              value={timeBand}
              onChange={(e) => changeTimeBand(e.target.value as NonNullable<GalleryQuery['timeBand']>)}
            >
              <option value="all">All day</option>
              <option value="00-06">00:00–05:59</option>
              <option value="06-12">06:00–11:59</option>
              <option value="12-18">12:00–17:59</option>
              <option value="18-24">18:00–23:59</option>
            </select>
          </label>
        </div>
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={applyTextFilters}>
          <label className="block text-xs text-ink-3">App contains
            <input
              className="mt-1 block rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] text-ink"
              value={appDraft}
              maxLength={80}
              placeholder="e.g. Photoshop"
              onChange={(e) => setAppDraft(e.target.value)}
            />
          </label>
          <label className="block text-xs text-ink-3">Monitor number
            <input
              className="mt-1 block w-28 rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] text-ink"
              type="number"
              min={1}
              max={32768}
              value={monitorDraft}
              placeholder="All"
              onChange={(e) => setMonitorDraft(e.target.value)}
            />
          </label>
          <Button type="submit">Apply</Button>
          <Button onClick={clearFilters}>Clear filters</Button>
        </form>
        {activeFilterCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3" aria-label="Active filters">
            <span className="text-xs font-semibold text-ink-2">Active filters · {activeFilterCount}</span>
            {(range.from !== today || range.to !== today) && (
              <FilterChip label={range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`} onRemove={() => changeRange({ from: today, to: today })} />
            )}
            {employeeId !== null && (
              <FilterChip label={`Staff #${employeeId}`} onRemove={() => changeEmployee(null)} />
            )}
            {timeBand !== 'all' && (
              <FilterChip label={`Time ${timeBand.replace('-', ':00–')}:00`} onRemove={() => changeTimeBand('all')} />
            )}
            {!!app && (
              <FilterChip label={`App: ${app}`} onRemove={() => { setApp(''); setAppDraft(''); setPage(1); setOpenIndex(null); }} />
            )}
            {monitorIndex !== undefined && (
              <FilterChip label={`Monitor ${monitorIndex + 1}`} onRemove={() => { setMonitorIndex(undefined); setMonitorDraft(''); setPage(1); setOpenIndex(null); }} />
            )}
            <button type="button" onClick={clearFilters} className="text-xs text-data hover:underline">Reset all</button>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-3">Up to 7 days. App and monitor filters apply when you press Apply.</p>
      </div>

      {loading && !data ? (
        <Loading label="Loading screenshots…" />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : items.length === 0 ? (
        <Empty
          title={hasFilters ? 'No screenshots match these filters' : 'No screenshots on this day'}
          hint={
            hasFilters
              ? 'Try a different date, time, app, monitor or staff member, or clear the filters.'
              : <>
                  Screenshots are taken only while someone is <b>working</b> — if
                  a person stayed idle all day, or the agent was down, the day
                  stays empty. On a weekly off or a holiday that is exactly what
                  you should see. Try another date.
                </>
          }
        />
      ) : (
        <>
          <ShotGrid
            items={items}
            urls={urls}
            // ⚠️ "Everyone" দেখা হলে নাম ছাড়া কোন ছবি কার বোঝার উপায় নেই
            showName={!isEmployee && employeeId === null}
            onOpen={setOpenIndex}
          />

          {data && data.totalPages > 1 && (
            <div className="mt-3">
              <Pager
                page={data.page}
                totalPages={data.totalPages}
                onChange={changePage}
              />
            </div>
          )}
        </>
      )}

      {/*
        ⭐ শর্তসাপেক্ষে mount — খোলা মানেই তৈরি, বন্ধ মানেই মুছে যাওয়া। তাই
        স্ক্রল-লক আর ফোকাস ফেরানোর হিসাব `useEffect`-এর cleanup-এই মিটে যায়।
        ⚠️ `openIndex` তালিকার বাইরে চলে যেতে পারে (রিফ্রেশে ছবি কমে গেলে),
           তাই আইটেমটা সত্যিই আছে কি না মিলিয়ে নেওয়া হয়।
      */}
      {openIndex !== null && items[openIndex] && (
        <Lightbox
          items={items}
          index={openIndex}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          urls={urls}
        />
      )}
    </Page>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove filter ${label}`}
      className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 text-xs text-ink-2 hover:border-data hover:text-ink"
    >
      <span>{label}</span><span aria-hidden="true">×</span>
    </button>
  );
}

/**
 * I08 — স্বচ্ছতার নোট। ⚠️ এটা `<Caveat>` নয়: caveat মানে "সংখ্যাটা সাবধানে
 * পড়ুন", আর এটা একটা **প্রতিশ্রুতি**। তাই সতর্কতার ⚠ নয়, সরু ব্র্যান্ড-রেখা।
 */
function AuditNote({ isEmployee }: { isEmployee: boolean }) {
  return (
    <p className="mb-3 rounded-lg border border-brand/30 bg-brand-bg px-3.5 py-2.5 text-xs text-ink-2">
      {/* ⚠️ বাক্যটা হুবহু এই — "Opening a screenshot is recorded in the audit
          log." <b> শুধু জোর দেয়, লেখাটা ভাঙে না */}
      Opening a screenshot is <b>recorded in the audit log</b> — who opened
      it, when, and whose screen it was.{' '}
      {isEmployee
        ? 'You can only see your own screenshots.'
        : 'Even opening this page writes a row.'}
    </p>
  );
}

function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <Button onClick={() => onChange(page - 1)} disabled={page <= 1}>
          ◀ Previous
        </Button>
        <Button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next ▶
        </Button>
        {/* ⚠️ `.num` শুধু সংখ্যার উপরে, শব্দের উপরে নয় — ওটা tabular-nums
            আনার জন্য, আর মনো ফন্টে গোটা বাক্য বসালে পট্টিটা বেঢপ দেখাত */}
        <span className="ml-auto text-xs text-ink-3">
          Page <span className="num">{formatCount(page)}</span> /{' '}
          <span className="num">{formatCount(totalPages)}</span>
        </span>
      </div>
    </Card>
  );
}
