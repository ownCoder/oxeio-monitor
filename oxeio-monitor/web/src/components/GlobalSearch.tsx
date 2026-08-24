import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listEmployees, type EmployeeView } from '../api/admin';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import {
  formatDate,
  isValidWorkDate,
  shiftWorkDate,
  todayInDhaka,
  weekdayOf,
} from '../lib/format';
import { seesEveryone } from '../api/auth';

/**
 * E14 — হেডারের গ্লোবাল সার্চ। `/` চাপলে ফোকাস।
 *
 * ⭐ **সার্ভারে কল হয় সারা সেশনে একবার**, কি-স্ট্রোকে নয়। পনেরোজনের তালিকা
 * এতই ছোট যে সেটা একবার এনে ক্লায়েন্টে ফিল্টার করাই দ্রুততর — টাইপ করার
 * সময় প্রতিটা অক্ষরে একটা করে রিকোয়েস্ট গেলে ফলাফল এলোমেলো ক্রমে ফিরত
 * (debounce ছাড়া রেস), আর audit/অ্যাক্সেস লগও অকারণে ভরে যেত।
 *
 * ⭐ তালিকাটা আনা হয় **প্রথমবার বাক্সে ফোকাস পড়লে**, mount-এ নয়। হেডার
 * প্রতিটা পাতায় বসে; mount-এ আনলে যে কখনো সার্চ করে না তার জন্যও প্রতি
 * পেজ-লোডে একটা `GET /employees` যেত।
 *
 * ⚠️ `role = employee` হলে বাক্সটা **থাকেই না** (`return null`)। তার দেখার
 *    মতো অন্য কেউ নেই, আর `GET /employees` তার জন্য ৪০৩ — বাক্সটা দেখালে
 *    সে টাইপ করত আর প্রতিবার একটা ব্যর্থ রিকোয়েস্ট পেত। (J05-এর একই যুক্তি
 *    যেভাবে গ্যালারিতে স্টাফ-ফিল্টারটা লুকোনো আছে।)
 */
export function GlobalSearch() {
  const { user } = useAuth();
  // ⚠️ শর্তটা হ্যাঁ-তালিকা — `!== 'employee'` লিখলে গবেষকও গোটা দলের
  //    নামের উপর খোঁজার বাক্স পেতেন (২৫ আগস্ট)।
  if (!seesEveryone(user?.role)) return null;
  return <SearchBox />;
}

// ── খাঁটি অংশ (I/O নেই — এটুকুই DB বা DOM ছাড়া পরীক্ষা করা যায়) ─────────────

export interface ParsedQuery {
  /** `YYYY-MM-DD`, তারিখ না পেলে `null` */
  date: string | null;
  /** তারিখটা বাদ দেওয়ার পর যা থাকে — নাম/কোড খোঁজার অংশ */
  text: string;
  /** তারিখ পাওয়া গেছে, কিন্তু সেটা ঢাকার আজকের পরে */
  future: boolean;
}

/**
 * লেখাটা ভেঙে "একটা তারিখ + বাকি লেখা" বানায়।
 *
 * ⭐ দুটো একসাথে লেখা যায় — `রাসিদ 2026-08-01` মানে "রাসিদের ১ আগস্টের দিন"।
 * এটাই সবচেয়ে কাজের ব্যবহার, কারণ ম্যানেজার সাধারণত জানেন **কার** কোন দিন
 * দেখতে চান।
 *
 * ⚠️ পর্দার ভাষা ইংরেজি হলেও **নামগুলো বাংলাতেই থাকে** (DB-তে যেভাবে
 *    লেখা), তাই খোঁজার লেখাও বাংলা হবে। নিচের `fold()`-এর NFC নরমালাইজ
 *    সেই কারণেই টিকে আছে।
 */
export function parseSearchQuery(raw: string, today: string): ParsedQuery {
  const tokens = raw.trim().split(/\s+/).filter((t) => t !== '');

  let date: string | null = null;
  const rest: string[] = [];

  for (const token of tokens) {
    /**
     * ⚠️ **প্রথম তারিখটাই** নেওয়া হয়; দ্বিতীয়টা নাম হিসেবে খোঁজা হবে আর
     *    কিছুই মিলবে না। ইচ্ছাকৃত: এখানে তারিখের রেঞ্জ বলে কিছু নেই, আর
     *    `2026-08-01 2026-08-05` লিখলে চুপচাপ প্রথম দিনটা খুলে দিলে মনে
     *    হতো রেঞ্জটা কাজ করেছে। রেঞ্জ রিপোর্ট পাতার জিনিস।
     */
    if (date !== null) {
      rest.push(token);
      continue;
    }

    const asDate = parseDateToken(token, today);
    if (asDate !== null) date = asDate;
    else rest.push(token);
  }

  return {
    date,
    text: rest.join(' '),
    future: date !== null && date > today,
  };
}

/**
 * একটা শব্দ তারিখ কি না।
 *
 * ⭐ পর্দার ভাষা ইংরেজি, তাই `today` / `yesterday` চেনা হয় — কিন্তু বাংলা
 *    শব্দগুলোও **রেখে দেওয়া হলো**। যাঁরা এতদিন `গতকাল` লিখে অভ্যস্ত,
 *    তাঁদের কাছে ওটা হঠাৎ কাজ না করা নিছক ভাঙা মনে হতো, অথচ চিনে নিতে
 *    কারো কোনো ক্ষতি নেই।
 *
 * ⚠️ শুধু **"কাল"** নেওয়া হয় না — বাংলায় ওটা গতকাল *আর* আগামীকাল দুটোই
 *    বোঝায়। ভুল দিনের টাইমলাইন খুলে দেওয়ার চেয়ে শব্দটা না চেনা ভালো;
 *    না চিনলে ব্যবহারকারী তারিখটা লিখে দেবেন, আর ভুল দিনটা কেউ ধরতেই
 *    পারত না। ইংরেজিতেও একই কারণে **"tomorrow" নেই** — ভবিষ্যতের দিন
 *    এখানে দেখার কিছু নেই।
 */
function parseDateToken(token: string, today: string): string | null {
  // ⚠️ `toLowerCase()` — কেউ বাক্যের শুরুতে "Today" লিখলেও যেন চেনা যায়
  const word = token.toLowerCase();
  if (word === 'today' || token === 'আজ' || token === 'আজকে') return today;
  if (word === 'yesterday' || token === 'গতকাল') {
    return shiftWorkDate(today, -1);
  }

  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(token);
  if (m === null) return null;

  /**
   * ⭐ **চার অঙ্কের অংশটাই বছর** — তাই `2026-08-01` (ISO) আর `01/08/2026`
   * (ঢাকায় যেভাবে লেখা হয়) দুটোই চলে, আর কোনটা দিন কোনটা মাস তা নিয়ে
   * অনুমান করতে হয় না।
   * ⚠️ দুই অঙ্কের বছর (`01/08/26`) নেওয়া হয় না: তিনটে সংখ্যার কোনটা বছর
   *    সেটাই আর নিশ্চিত করে বলা যায় না, আর ভুল ধরলে অন্য একটা দিনের
   *    টাইমলাইন খুলে যেত — দেখতে নিখুঁত, শুধু ভুল দিনের।
   */
  let year: string;
  let month: string;
  let day: string;
  if (m[1].length === 4) [year, month, day] = [m[1], m[2], m[3]];
  else if (m[3].length === 4) [year, month, day] = [m[3], m[2], m[1]];
  else return null;

  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  // ⚠️ `2026-02-31` এখানেই আটকায় — `parseWorkDate` ফিরে এসে মিলিয়ে দেখে,
  //    নইলে `new Date()` চুপচাপ ৩ মার্চ বানিয়ে দিত
  return isValidWorkDate(iso) ? iso : null;
}

/**
 * ⚠️ **NFC নরমালাইজ করা হয়, কারণ লেখাটা বাংলা।** বাংলার `ো` আর `ৌ`
 *    ইউনিকোডে দুভাবে লেখা যায় — একটা কোডপয়েন্ট, বা দুটো জোড়া। কি-বোর্ড
 *    ভেদে দুরকমই আসে। নরমালাইজ না করলে "রোজিনা" টাইপ করে "রোজিনা"-কেই
 *    খুঁজে পাওয়া যেত না, আর পর্দায় দুটো লেখা **অবিকল এক** দেখাত — এই ভুল
 *    কেউ কোনোদিন ধরতে পারত না।
 */
function fold(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

/**
 * কতটা ভালো মিলল — ছোট মানে উপরে। না মিললে `null`।
 *
 * ⚠️ চলে যাওয়া কর্মীও তালিকায় থাকেন (তাঁর পুরোনো দিন দেখতে হয়), কিন্তু
 *    সবসময় active-দের **নিচে** — নইলে একই নামের বিদায়ী কর্মী উপরে বসে
 *    যেতেন আর Enter চেপে ভুল লোকের পাতায় পৌঁছানো যেত।
 */
function rankOf(emp: EmployeeView, needle: string): number | null {
  const code = fold(emp.empCode);
  const name = fold(emp.fullName);
  const email = emp.email === null ? '' : fold(emp.email);

  const words = name.split(/\s+/);

  let rank: number;
  if (code === needle) rank = 0;
  else if (code.startsWith(needle)) rank = 1;
  /**
   * ⚠️ ডাকনাম আগে, পদবি পরে। "রাসিদ" লিখলে **রাসিদুল ইসলাম** উপরে ওঠেন,
   *    **মামুনুর রাসিদ** তার নিচে — দুজনেই থাকেন, কিন্তু ক্রমটা অনুমেয়।
   *    দুটোকে এক ধাপে রাখলে টাই ভাঙত বর্ণানুক্রমে, আর Enter চেপে কার
   *    পাতায় পৌঁছাবেন সেটা নামের বানানের উপর নির্ভর করত — ব্যবহারকারীর
   *    চোখে নিছক এলোমেলো।
   */
  else if (words[0].startsWith(needle)) rank = 2;
  else if (words.some((word) => word.startsWith(needle))) rank = 3;
  else if (name.includes(needle)) rank = 4;
  else if (code.includes(needle)) rank = 5;
  else if (email !== '' && email.includes(needle)) rank = 6;
  else return null;

  return emp.status === 'inactive' ? rank + 10 : rank;
}

/** খালি `query` = সবাই (তারিখ-মাত্র খোঁজায় "কার দিন দেখবেন?") */
export function matchEmployees(
  rows: EmployeeView[],
  query: string,
  limit: number,
): EmployeeView[] {
  const needle = fold(query.trim());

  return rows
    .map((emp) => ({
      emp,
      rank:
        needle === '' ? (emp.status === 'inactive' ? 10 : 0) : rankOf(emp, needle),
    }))
    .filter((row): row is { emp: EmployeeView; rank: number } => row.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank || a.emp.fullName.localeCompare(b.emp.fullName, 'bn'),
    )
    .slice(0, limit)
    .map((row) => row.emp);
}

// ── বাক্সটা ─────────────────────────────────────────────────────────────────

/** ⚠️ মডিউল-স্তরে ধ্রুবক — প্রতি রেন্ডারে নতুন অ্যারে হলে `useMemo` অর্থহীন */
const NO_ROWS: EmployeeView[] = [];
const NOT_FETCHED = { rows: NO_ROWS, total: 0 };

function SearchBox() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  /** একবার ফোকাস পড়েছে — তার আগে নেটওয়ার্কে যাওয়াই হয় না */
  const [armed, setArmed] = useState(false);
  const [active, setActive] = useState(0);

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, error, loading } = useApi(
    (signal) =>
      armed ? listEmployees({ status: 'all' }, signal) : Promise.resolve(NOT_FETCHED),
    [armed],
  );

  // ⚠️ প্রতি রেন্ডারে নতুন করে গোনা, `useMemo`-তে নয় — ট্যাব সারারাত খোলা
  //    থাকলে মাঝরাতে "আজ" বদলায়, আর memo সেটা কোনোদিন জানত না
  const today = todayInDhaka();
  const parsed = useMemo(() => parseSearchQuery(query, today), [query, today]);

  const rows = data?.rows;
  const people = useMemo(() => {
    if (parsed.future) return NO_ROWS;
    if (parsed.text === '' && parsed.date === null) return NO_ROWS;
    // তারিখ-মাত্র খোঁজায় সবাইকে দেখানো হয় — "কার দিন দেখবেন?"
    return matchEmployees(rows ?? NO_ROWS, parsed.text, parsed.text === '' ? 20 : 8);
  }, [rows, parsed]);

  // ফলাফল বদলালে বাছাইটা উপরে ফেরে — নইলে ৫ নম্বর সারি বাছা অবস্থায় নতুন
  // তালিকায় দুটো ফল থাকলে Enter কিছুই করত না
  useEffect(() => setActive(0), [query]);

  const go = useCallback(
    (emp: EmployeeView) => {
      /**
       * ⭐ তারিখটা URL-এ যায় (`/staff/3?date=2026-08-01`) — `EmployeeDetailPage`
       * তারিখ ওখান থেকেই পড়ে, তাই লিঙ্কটা কাউকে পাঠালেও ঠিক ওই দিনটাই খোলে।
       */
      navigate(
        parsed.date !== null && !parsed.future
          ? `/staff/${emp.id}?date=${parsed.date}`
          : `/staff/${emp.id}`,
      );
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    },
    [navigate, parsed],
  );

  /**
   * `/` — যেকোনো জায়গা থেকে বাক্সে।
   *
   * ⚠️ কেউ অন্য কোনো ঘরে টাইপ করতে থাকলে তার `/` কেড়ে নেওয়া হয় না —
   *    নইলে সেটিংসে পথ লিখতে গিয়ে প্রতিবার ফোকাস লাফিয়ে হেডারে চলে যেত।
   * ⚠️ `preventDefault()` না দিলে ফায়ারফক্সের quick-find বারটাও খুলত।
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;

      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT')
      ) {
        return;
      }

      e.preventDefault();
      inputRef.current?.focus();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // বাইরে ক্লিক করলে বন্ধ। ⚠️ `mousedown`, `click` নয় — ফলাফলে ক্লিক করলে
  // যেন প্যানেলটা আঙুলের নিচ থেকে সরে না যায়।
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // ⚠️ নইলে ক্যারেট লেখার শুরু/শেষে লাফাত
      e.preventDefault();
      setOpen(true);
      if (people.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : people.length - 1;
      setActive((i) => (i + step) % people.length);
      return;
    }
    if (e.key === 'Enter' && active < people.length) {
      e.preventDefault();
      go(people[active]);
    }
  };

  const activeId =
    active < people.length ? `gs-opt-${people[active].id}` : undefined;

  return (
    <div ref={boxRef} className="relative order-last w-full sm:order-none sm:w-64">
      {/*
        ⚠️ ফোনে বাক্সটা হেডারের **নিচের সারিতে** নেমে যায় (`order-last
           w-full`)। একই সারিতে জোর করে রাখলে ৩৭৫px-এ লোগো, নাম আর লগআউট
           চেপে গিয়ে সবকটাই অপঠ্য হতো (E12)।
      */}
      <input
        ref={inputRef}
        type="search"
        value={query}
        role="combobox"
        aria-expanded={open}
        aria-controls="gs-list"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label="Search staff or a date"
        placeholder="Name, code or date  ( / )"
        onFocus={() => {
          setArmed(true);
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-white/20 bg-white/10 px-2.5 py-1.5 text-[13px] text-white placeholder:text-white/45 focus:border-brand focus:ring-2 focus:ring-brand/40 focus:outline-none"
      />

      {open && (
        <div className="absolute top-full right-0 left-0 z-40 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <Panel
            parsed={parsed}
            people={people}
            active={active}
            loading={loading && rows === undefined}
            error={error}
            onHover={setActive}
            onPick={go}
          />
        </div>
      )}
    </div>
  );
}

/**
 * ⭐ তিনটে অবস্থা এখানেও — লোড হচ্ছে · ভুল · **কিছু মিলল না**। শেষেরটা
 * ছাড়া টাইপ করে খালি বাক্স দেখে মনে হতো সার্চটাই ভেঙে গেছে।
 */
function Panel({
  parsed,
  people,
  active,
  loading,
  error,
  onHover,
  onPick,
}: {
  parsed: ParsedQuery;
  people: EmployeeView[];
  active: number;
  loading: boolean;
  error: Error | null;
  onHover: (index: number) => void;
  onPick: (emp: EmployeeView) => void;
}) {
  if (loading) return <Note>Loading the staff list…</Note>;

  if (error !== null) {
    return (
      <Note tone="brand">
        Couldn't load the staff list — try again in a moment.
      </Note>
    );
  }

  if (parsed.future) {
    return (
      <Note>
        <b>{formatDate(parsed.date ?? '')}</b> hasn't happened yet. Try today or
        any earlier day.
      </Note>
    );
  }

  if (parsed.text === '' && parsed.date === null) {
    return (
      <Note>
        Type a staff <b>name</b> or <b>code</b>. Add a date (
        <span className="num">2026-08-01</span>, <span className="num">01/08/2026</span>,{' '}
        <b>yesterday</b>) to open that day's timeline.
      </Note>
    );
  }

  if (people.length === 0) {
    return (
      <Note>
        Nothing matched. Try part of a name, an empCode or a date — people who
        have left show up here too.
      </Note>
    );
  }

  return (
    <>
      {parsed.date !== null && (
        <p className="border-b border-line px-3 py-2 text-[11.5px] text-ink-3">
          {/*
            ⚠️ `weekdayOf()` এখন `Mon` দেয়, তাই আগের মতো পরে "বার" জোড়া
               হয় না — জুড়লে "Monবার" বসত।
          */}
          {formatDate(parsed.date)} · {weekdayOf(parsed.date)} —{' '}
          {parsed.text === '' ? 'whose day?' : "that day's timeline"}
        </p>
      )}

      <ul id="gs-list" role="listbox" className="max-h-80 overflow-y-auto py-1">
        {people.map((emp, i) => (
          <li
            key={emp.id}
            id={`gs-opt-${emp.id}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(emp)}
            className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-[13px] ${
              i === active ? 'bg-brand-bg text-ink' : 'text-ink-2'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{emp.fullName}</span>
            {emp.status === 'inactive' && (
              <span className="flex-none text-[11px] text-ink-3">Inactive</span>
            )}
            <span className="num flex-none text-[11.5px] text-ink-3">
              {emp.empCode}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Note({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'brand';
}) {
  return (
    <p
      className={`px-3 py-2.5 text-xs ${
        tone === 'brand' ? 'text-brand-ink' : 'text-ink-3'
      }`}
    >
      {children}
    </p>
  );
}
