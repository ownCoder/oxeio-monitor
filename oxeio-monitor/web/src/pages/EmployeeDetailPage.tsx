import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { getEmployee } from '../api/admin';
import { useApi } from '../api/useApi';
import { DatePicker } from '../components/DatePicker';
import { Button, Page } from '../components/Page';
import { Empty, ErrorBox, Loading } from '../components/States';
import {
  formatDate,
  isValidWorkDate,
  todayInDhaka,
  weekdayOf,
} from '../lib/format';
import { HourlyChart } from './employee/HourlyChart';
import { ScoreCard } from './employee/ScoreCard';
import { TimelineBar } from './employee/TimelineBar';
import { TopUsage } from './employee/TopUsage';

/**
 * E04 · E05 · D07 · D08 — একজন কর্মীর একটা দিন (`/staff/:id`)।
 *
 * ⭐ তারিখটা **URL-এ** থাকে (`/staff/3?date=2026-08-09`)। ফলে ম্যানেজার
 * লিঙ্কটা কাউকে পাঠালে সে ঠিক ওই দিনটাই দেখে — "কোন তারিখের কথা বলছেন?"
 * প্রশ্নটাই আর ওঠে না। `replace: true` দেওয়া, নইলে ◀ ▶ পাঁচবার চাপলে
 * ব্যাক বোতামে পাঁচবার পিছোতে হতো।
 *
 * ⭐ চারটে অংশ **আলাদা করে** ডেটা আনে। একটা endpoint ব্যর্থ হলে বা ৪০৩
 * দিলে বাকি তিনটে দেখা যায় — একটা বড় try/catch হলে একটামাত্র ভুলে গোটা
 * পাতা সাদা হয়ে যেত।
 *
 * ⚠️ চারটে endpoint-ই owner + manager (`role = employee` ৪০৩ পাবে, আর
 * `<ErrorBox>` তখন "অনুমতি নেই" দেখায়)। এই পাতায় owner-only কিছু নেই —
 * বেতন এখানে দেখানোই হয় না, চাওয়াও হয় না।
 *
 * ⚠️ J08 (ঘণ্টা-সংশোধনের তালিকা) এখানে নেই: সার্ভারে
 * `GET /employees/:id/time-adjustments` বলে কোনো রুট নেই। `time_adjustments`
 * টেবিলটা schema-তে আছে ও payroll-এর হিসাবে ব্যবহার হয়, কিন্তু পড়ার কোনো
 * API নেই। বানানো endpoint ধরে UI লিখলে পাতাটা নীরবে খালি দেখাত।
 */
export function EmployeeDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  /** রিফ্রেশ বোতাম — চারটে অংশকেই আবার আনতে বলে */
  const [nonce, setNonce] = useState(0);

  const employeeId = Number(id);
  const validId = Number.isInteger(employeeId) && employeeId > 0;

  const today = todayInDhaka();
  const raw = params.get('date');
  // ⚠️ URL-এ যা-ই থাকুক, অবৈধ বা ভবিষ্যতের তারিখ সার্ভারে পাঠানো হয় না —
  //    ৪০০ দেখানোর চেয়ে চুপচাপ আজকের দিনে ফিরে আসা ভালো
  const date = raw && isValidWorkDate(raw) && raw <= today ? raw : today;

  const {
    data: employee,
    error,
    loading,
    reload,
  } = useApi(
    (signal) =>
      validId
        ? getEmployee(employeeId, signal)
        : // ⚠️ NaN পাঠালে সার্ভারের ParseIntPipe ৪০০ দিত — নেটওয়ার্কেই যাওয়া হয় না
          Promise.reject(new Error('স্টাফের ঠিকানাটা ঠিক নয়')),
    [employeeId, validId, nonce],
  );

  const setDate = (next: string): void => {
    setParams({ date: next }, { replace: true });
  };

  if (!validId) {
    return (
      <Page title="স্টাফের দিন">
        <Empty
          title="ঠিকানাটা ঠিক নয়"
          hint="এই পাতার ঠিকানা `/staff/3` ধরনের হওয়ার কথা। লাইভ বোর্ড থেকে কারো কার্ডে ক্লিক করে আসুন।"
        />
      </Page>
    );
  }

  // ⭐ কর্মীই না পাওয়া গেলে নিচের চারটে অংশও একই ৪০৪/৪০৩ দেখাত — চারটে
  //    এরর বাক্স পরপর সাজিয়ে রাখার চেয়ে একটাই যথেষ্ট।
  if (loading && !employee) {
    return (
      <Page title="স্টাফের দিন">
        <Loading />
      </Page>
    );
  }

  if (error || !employee) {
    return (
      <Page title="স্টাফের দিন">
        <ErrorBox error={error} retry={reload} />
      </Page>
    );
  }

  return (
    <Page
      title={employee.fullName}
      subtitle={
        <>
          <span className="num">{employee.empCode}</span>
          {employee.designation ? ` · ${employee.designation}` : ''}
          {employee.department ? ` · ${employee.department}` : ''}
          {' — '}
          <span className="num">{formatDate(date)}</span>, {weekdayOf(date)}
          {date === today ? ' (আজ)' : ''}
          {employee.status === 'inactive' ? ' · নিষ্ক্রিয় কর্মী' : ''}
        </>
      }
      actions={
        <>
          <DatePicker
            value={date}
            onChange={setDate}
            max={today}
            withArrows
          />
          <Button
            onClick={() => setNonce((n) => n + 1)}
            title="পাতার সব অংশ আবার আনা হবে"
          >
            রিফ্রেশ
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <TimelineBar employeeId={employeeId} date={date} nonce={nonce} />
        <HourlyChart employeeId={employeeId} date={date} nonce={nonce} />
        <ScoreCard employeeId={employeeId} date={date} nonce={nonce} />
        <TopUsage employeeId={employeeId} date={date} nonce={nonce} />
      </div>
    </Page>
  );
}
