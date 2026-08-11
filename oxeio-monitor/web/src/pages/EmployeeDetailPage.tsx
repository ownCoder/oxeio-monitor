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
 * `<ErrorBox>` তখন "You don't have access" দেখায়)। এই পাতায় owner-only কিছু
 * নেই — বেতন এখানে দেখানোই হয় না, চাওয়াও হয় না।
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
          Promise.reject(new Error("That staff link isn't valid")),
    [employeeId, validId, nonce],
  );

  const setDate = (next: string): void => {
    setParams({ date: next }, { replace: true });
  };

  if (!validId) {
    return (
      <Page title="Staff member">
        <Empty
          title="That link isn't valid"
          hint="This page's address should look like `/staff/3`. Open it by clicking someone's card on the Live Board."
        />
      </Page>
    );
  }

  // ⭐ কর্মীই না পাওয়া গেলে নিচের চারটে অংশও একই ৪০৪/৪০৩ দেখাত — চারটে
  //    এরর বাক্স পরপর সাজিয়ে রাখার চেয়ে একটাই যথেষ্ট।
  if (loading && !employee) {
    return (
      <Page title="Staff member">
        <Loading />
      </Page>
    );
  }

  if (error || !employee) {
    return (
      <Page title="Staff member">
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
          {date === today ? ' (Today)' : ''}
          {/*
            ⚠️ এখানে "Inactive", "Idle" নয়। অভিধানে নিষ্ক্রিয় → Idle, কিন্তু
               ওটা লাইভ বোর্ডের **এই মুহূর্তের অবস্থা**। এখানকার `status`
               কর্মীর রেকর্ড চালু আছে কি না — কেউ চাকরি ছেড়ে গেলে "Idle"
               লেখা হতো, আর ম্যানেজার ভাবত লোকটা এখন বসে আছে।
          */}
          {employee.status === 'inactive' ? ' · Inactive staff' : ''}
        </>
      }
      actions={
        <>
          {/*
            ⚠️ `label` স্পষ্ট করে পাঠানো — `<DatePicker>`-এর ডিফল্ট লেবেলটা
               অন্য ফাইলে, আর সেটা বদলানোর আগেই এই পাতাটা যেন পুরো ইংরেজি থাকে।
          */}
          <DatePicker
            value={date}
            onChange={setDate}
            label="Date"
            max={today}
            withArrows
          />
          <Button
            onClick={() => setNonce((n) => n + 1)}
            title="Reloads every section on this page"
          >
            Refresh
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
