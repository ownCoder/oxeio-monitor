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
  const isEmployee = user?.role === 'employee';

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

  /** ফিল্টার বদলালে পাতা ১-এ ফেরা — নইলে "পাতা ৩" খালি দেখাত */
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
      title="স্ক্রিনশট"
      subtitle={
        data
          ? `${formatDate(data.date)} · ${formatCount(data.total)}টি ছবি`
          : formatDate(date)
      }
      actions={
        <>
          {!isEmployee && (
            <EmployeePicker
              value={employeeId}
              onChange={changeEmployee}
              allowAll
              allLabel="সবাই"
              // ⚠️ চলে যাওয়া কর্মীর পুরোনো দিনও দেখতে হয় — নইলে তার
              //    স্ক্রিনশট থাকা সত্ত্বেও নামটাই বাছা যেত না
              includeInactive
            />
          )}
          <DatePicker value={date} onChange={changeDate} withArrows />
        </>
      }
    >
      <AuditNote isEmployee={isEmployee} />

      {loading && !data ? (
        <Loading label="স্ক্রিনশট আসছে…" />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : items.length === 0 ? (
        <Empty
          title="এই দিনে কোনো স্ক্রিনশট নেই"
          hint={
            <>
              স্ক্রিনশট ওঠে শুধু <b>কাজের সময়ে</b> — কেউ সারাদিন নিষ্ক্রিয়
              থাকলে বা এজেন্ট বন্ধ থাকলে ওই দিনের ঘর খালিই থাকে। ছুটির দিন
              হলে এটাই স্বাভাবিক। অন্য একটা তারিখ বেছে দেখুন।
            </>
          }
        />
      ) : (
        <>
          <ShotGrid
            items={items}
            urls={urls}
            // ⚠️ "সবাই" দেখা হলে নাম ছাড়া কোন ছবি কার বোঝার উপায় নেই
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
      স্ক্রিনশট দেখা হলে সেটা <b>audit log-এ থাকে</b> — কে, কখন, কার ছবি
      দেখল।{' '}
      {isEmployee
        ? 'আপনি শুধু নিজের স্ক্রিনশটই দেখতে পান।'
        : 'আপনি এই পাতাটা খুললেও একটা সারি লেখা হয়।'}
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
          ◀ আগের পাতা
        </Button>
        <Button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
        >
          পরের পাতা ▶
        </Button>
        {/* ⚠️ `.num` শুধু সংখ্যার উপরে — মনো ফন্টে বাংলা গ্লিফ নেই */}
        <span className="ml-auto text-xs text-ink-3">
          পাতা <span className="num">{formatCount(page)}</span> /{' '}
          <span className="num">{formatCount(totalPages)}</span>
        </span>
      </div>
    </Card>
  );
}
