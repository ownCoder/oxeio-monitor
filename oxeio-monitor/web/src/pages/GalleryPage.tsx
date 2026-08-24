import { useCallback, useMemo, useState } from 'react';

import { getGallery, type GalleryQuery } from '../api/screenshots';
import { useApi } from '../api/useApi';
import { Card } from '../components/Card';
import { DatePicker } from '../components/DatePicker';
import { EmployeePicker } from '../components/EmployeePicker';
import { Button, Page } from '../components/Page';
import { Empty, ErrorBox, Loading } from '../components/States';
import { useAuth } from '../auth/AuthContext';
import { formatCount, formatDate, todayInDhaka } from '../lib/format';
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

  const [date, setDate] = useState(() => todayInDhaka());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
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
      date,
      page,
      employeeId: isEmployee ? undefined : (employeeId ?? undefined),
    }),
    [date, page, employeeId, isEmployee],
  );

  const { data, error, loading, reload } = useApi(
    (signal) => getGallery(query, signal),
    [query],
  );
  const urls = useFreshUrls(query);

  const items = data?.items ?? [];

  /** ফিল্টার বদলালে পাতা ১-এ ফেরা — নইলে "Page 3" খালি দেখাত */
  const changeDate = useCallback((next: string) => {
    setDate(next);
    setPage(1);
    setOpenIndex(null);
  }, []);

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
          ? `${formatDate(data.date)} · ${formatCount(data.total)} ${
              data.total === 1 ? 'image' : 'images'
            }`
          : formatDate(date)
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
          <DatePicker
            label="Date"
            value={date}
            onChange={changeDate}
            withArrows
          />
        </>
      }
    >
      <AuditNote isEmployee={isEmployee} />

      {loading && !data ? (
        <Loading label="Loading screenshots…" />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : items.length === 0 ? (
        <Empty
          title="No screenshots on this day"
          hint={
            <>
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
