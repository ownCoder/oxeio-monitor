import { useState } from 'react';

import { listAuditLog, type AuditLogRow } from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { DateRange } from '../../components/DatePicker';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { Table, type Column } from '../../components/Table';
import {
  formatCount,
  formatDateShort,
  formatDateTime,
  formatTime,
  monthStartOf,
  todayInDhaka,
  workDateOf,
} from '../../lib/format';
import { Chip, FilterChip, MiniButton, Notice } from './ui';

/**
 * E11 — audit log ভিউয়ার (owner-only)।
 *
 * ⭐ এই পর্দার আসল কাজ একটাই প্রশ্নের উত্তর দেওয়া: **কে কার স্ক্রিনশট
 *    দেখল।** নজরদারির যন্ত্রে সেই নজরদারির উপরেও একটা নজর থাকা দরকার,
 *    নইলে "কেউ আমার ছবি দেখেছে কি না" প্রশ্নটার কোনো উত্তরই থাকত না।
 *    তাই ওটাকে এক ক্লিকের ফিল্টার বানানো হয়েছে, ড্রপডাউনে লুকোনো নয়।
 *
 * ⚠️ লগ শুধু পড়া যায় — লেখা, মোছা বা সম্পাদনার কোনো পথ সার্ভারে নেই।
 *    যে লগ বদলানো যায়, সেটা আর প্রমাণ নয়।
 */

/** ⚠️ সার্ভারে যে যে `action` সত্যিই বসানো হয় — অনুমান নয়, সোর্স থেকে নেওয়া */
const ACTIONS: { value: string; label: string }[] = [
  { value: '', label: 'সব ঘটনা' },
  { value: 'view_screenshot', label: 'স্ক্রিনশট দেখা' },
  { value: 'payroll_view', label: 'বেতন দেখা' },
  { value: 'change_setting', label: 'সেটিংস বদল' },
  { value: 'revoke_device', label: 'ডিভাইস revoke' },
  { value: 'create_enrollment_code', label: 'এনরোলমেন্ট কোড' },
  { value: 'export_report', label: 'রিপোর্ট এক্সপোর্ট' },
  { value: 'create_portal_account', label: 'পোর্টাল অ্যাকাউন্ট' },
  { value: 'reset_password', label: 'পাসওয়ার্ড রিসেট' },
  { value: 'change_password', label: 'পাসওয়ার্ড বদল' },
  { value: 'login', label: 'লগইন' },
  { value: 'login_failed', label: 'ব্যর্থ লগইন' },
];

const ACTION_LABEL: Record<string, string> = Object.fromEntries(
  ACTIONS.filter((a) => a.value !== '').map((a) => [a.value, a.label]),
);

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'স্টাফ',
};

const PAGE_SIZE = 50;

/**
 * ⚠️ `from`/`to` এখানে **instant**, নিছক তারিখ নয় (`@IsISO8601()`)। ঢাকার
 *    অফসেটটা স্পষ্ট করে বসানো হয়: `?from=2026-08-10` লিখলে সার্ভার ওটাকে
 *    UTC মধ্যরাত ধরত, আর ঢাকার সকাল ৬টার আগের ঘটনাগুলো আগের দিনে পড়ে
 *    যেত — অর্থাৎ ভোরে কে কী দেখল সেটা খুঁজে পাওয়া যেত না।
 */
const DHAKA_OFFSET = '+06:00';

function dayStart(date: string): string {
  return `${date}T00:00:00.000${DHAKA_OFFSET}`;
}

/** ⚠️ সার্ভারে `lte` — inclusive। তাই দিনের শেষ মিলিসেকেন্ড পর্যন্ত। */
function dayEnd(date: string): string {
  return `${date}T23:59:59.999${DHAKA_OFFSET}`;
}

export function AuditTab() {
  const today = todayInDhaka();
  const [range, setRange] = useState({ from: monthStartOf(today), to: today });
  const [action, setAction] = useState('');
  const [user, setUser] = useState<{ id: number; name: string } | null>(null);
  const [page, setPage] = useState(1);

  const log = useApi(
    (signal) =>
      listAuditLog(
        {
          from: dayStart(range.from),
          to: dayEnd(range.to),
          ...(action === '' ? {} : { action }),
          ...(user === null ? {} : { userId: user.id }),
          page,
          pageSize: PAGE_SIZE,
        },
        signal,
      ),
    [range.from, range.to, action, user?.id, page],
  );

  /** ⚠️ ফিল্টার বদলালে পাতাও ১-এ ফেরা দরকার — নইলে ৩ নম্বর পাতায় থেকে
   *     নতুন ফিল্টারে কিছুই না পেয়ে মনে হতো "কোনো ঘটনা ঘটেনি" */
  const changeAction = (next: string): void => {
    setAction(next);
    setPage(1);
  };

  const rows = log.data?.rows ?? [];
  const total = log.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<AuditLogRow>[] = [
    {
      key: 'time',
      header: 'কখন',
      render: (row) => (
        // ⚠️ সময়টা ঢাকার — `formatTime()` অফসেটটা স্পষ্ট করে বসায়।
        //    `toLocaleTimeString()` হলে VPN-এ থাকা কেউ ভুল সময় দেখত, আর
        //    "কে কখন দেখল" প্রশ্নের উত্তরটাই বেঠিক হয়ে যেত।
        <span
          className="num whitespace-nowrap"
          title={formatDateTime(row.occurredAt)}
        >
          {formatDateShort(workDateOf(row.occurredAt))}{' '}
          {formatTime(row.occurredAt)}
        </span>
      ),
    },
    {
      key: 'user',
      header: 'কে',
      render: (row) => {
        const actor = row.user;
        // ⚠️ ইউজার মুছে গেলেও সারিটা থেকে যায় — লগ প্রমাণ, তাই কখনো
        //    ফাঁকা করে দেওয়া হয় না
        if (!actor) {
          return <span className="text-ink-3">মুছে ফেলা অ্যাকাউন্ট</span>;
        }

        return (
          <button
            type="button"
            onClick={() => {
              setUser({ id: actor.id, name: actor.fullName });
              setPage(1);
            }}
            title="শুধু এই ইউজারের ঘটনা দেখুন"
            className="min-w-0 text-left transition hover:text-brand-ink"
          >
            <span className="block truncate font-medium">{actor.fullName}</span>
            <span className="block truncate text-[11px] text-ink-3">
              {ROLE_LABEL[actor.role] ?? actor.role} · {actor.email}
            </span>
          </button>
        );
      },
    },
    {
      key: 'action',
      header: 'কী',
      // ⭐ লাল **শুধু** ব্যর্থ লগইনে। স্ক্রিনশট বা বেতন দেখাও লাল করে দিলে
      //    ওই ফিল্টারে গোটা টেবিলটাই লাল হয়ে যেত, আর তখন সত্যিকারের
      //    সমস্যাটা (কেউ বারবার ভুল পাসওয়ার্ড দিচ্ছে) আর চোখে পড়ত না।
      render: (row) => (
        <Chip tone={row.action === 'login_failed' ? 'attention' : 'counted'}>
          {ACTION_LABEL[row.action] ?? row.action}
        </Chip>
      ),
    },
    {
      key: 'target',
      header: 'কার / কীসের উপর',
      render: (row) =>
        row.targetType === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="num text-[12px]">
            {row.targetType}
            {row.targetId ? ` #${row.targetId}` : ''}
          </span>
        ),
    },
    {
      key: 'ip',
      header: 'IP',
      render: (row) => (
        <span className="num text-[12px] text-ink-3">
          {row.ipAddress ?? '—'}
        </span>
      ),
    },
    {
      key: 'meta',
      header: 'বিস্তারিত',
      render: (row) => <Meta meta={row.meta} />,
    },
  ];

  return (
    <div className="space-y-3">
      <Notice>
        এই লগ শুধু পড়া যায় — বদলানো বা মোছার কোনো পথ নেই। স্ক্রিনশট দেখা ও
        বেতন দেখা দুটোই এখানে লেখা থাকে, অর্থাৎ{' '}
        <strong>যে দেখছে, তার দেখাটাও দেখা হচ্ছে</strong>।
      </Notice>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <DateRange
            from={range.from}
            to={range.to}
            onChange={(next) => {
              setRange(next);
              setPage(1);
            }}
          />
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-ink-3">ঘটনা</span>
            <select
              value={action}
              onChange={(e) => changeAction(e.target.value)}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            >
              {ACTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ⭐ এই পেজের সবচেয়ে জরুরি প্রশ্নটা এক ক্লিক দূরে */}
        <MiniButton
          onClick={() => changeAction('view_screenshot')}
          title="শুধু স্ক্রিনশট দেখার ঘটনাগুলো"
        >
          কে কার স্ক্রিনশট দেখল
        </MiniButton>
      </div>

      {user && (
        <div className="flex flex-wrap gap-2">
          <FilterChip
            onClear={() => {
              setUser(null);
              setPage(1);
            }}
          >
            ইউজার: {user.name}
          </FilterChip>
        </div>
      )}

      {log.loading && !log.data && <Loading />}
      {log.error && <ErrorBox error={log.error} retry={log.reload} />}

      {!log.loading && !log.error && rows.length === 0 && (
        <Empty
          title="এই ছাঁকনিতে কোনো ঘটনা নেই"
          hint="তারিখের রেঞ্জটা বাড়িয়ে দেখুন, বা 'সব ঘটনা' বেছে নিন। নতুন সিস্টেমে প্রথম কয়েক দিন লগে শুধু লগইনই থাকে।"
        />
      )}

      {rows.length > 0 && (
        <Card
          padded={false}
          title={`${formatCount(total)}টি ঘটনা`}
          hint={`পাতা ${page} / ${lastPage} · নতুনগুলো আগে`}
          actions={
            <div className="flex gap-1.5">
              <MiniButton
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || log.loading}
              >
                ← আগের
              </MiniButton>
              <MiniButton
                onClick={() => setPage((p) => p + 1)}
                disabled={!log.data?.hasMore || log.loading}
              >
                পরের →
              </MiniButton>
            </div>
          }
        >
          <Table
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
          />
        </Card>
      )}
    </div>
  );
}

/**
 * `meta` যেকোনো আকারের JSON (সার্ভারে `Prisma.JsonValue`)।
 *
 * ⚠️ অন্ধভাবে render করলে React অবজেক্ট পেয়ে ছুড়ত ("Objects are not valid
 *    as a React child") — গোটা পেজটা সাদা হয়ে যেত, আর কারণটা পর্দায়
 *    দেখা যেত না। তাই সবসময় `JSON.stringify`।
 *
 * ⭐ ডিফল্টে বন্ধ: `view_screenshot`-এর meta-তে কার ছবি, কয়টা, কোন
 *    তারিখের — সবই থাকে, আর সেটা প্রতিটা সারিতে খুলে রাখলে টেবিলটা পড়াই
 *    যেত না।
 */
function Meta({ meta }: { meta: unknown }) {
  const [open, setOpen] = useState(false);

  if (meta === null || meta === undefined) {
    return <span className="text-ink-3">—</span>;
  }

  const text = JSON.stringify(meta, null, 2);

  if (!open) {
    return (
      <MiniButton onClick={() => setOpen(true)} title={text}>
        দেখুন
      </MiniButton>
    );
  }

  return (
    <div className="min-w-0">
      <pre className="num max-w-md overflow-x-auto rounded-md border border-line bg-paper px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2">
        {text}
      </pre>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-1 text-[11px] text-ink-3 transition hover:text-ink"
      >
        গুটিয়ে নিন
      </button>
    </div>
  );
}
