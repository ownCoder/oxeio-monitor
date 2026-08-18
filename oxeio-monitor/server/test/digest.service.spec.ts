import { TelegramChannel } from '../src/alerts/telegram.channel';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AlertMailer, SendOutcome } from '../src/alerts/alerts.mailer';
import { DigestJob } from '../src/digest/digest.job';
import { DigestService } from '../src/digest/digest.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ReportsService } from '../src/reports/reports.service';
import type {
  AttendanceReport,
  ReportMeta,
  SummaryReport,
} from '../src/reports/reports.types';

/**
 * F07 — ডাইজেস্টের **প্রতিশ্রুতি**গুলো, DB ছাড়াই।
 *
 * ⭐ এখানকার সবচেয়ে জরুরি টেস্ট একটাই বাক্য: **ডাইজেস্ট কখনো সার্ভার
 * নামাতে পারবে না।** একটা মৃত SMTP, একটা মুছে ফেলা work policy বা
 * ডাটাবেসের সাময়িক টাইমআউট — কোনোটার দামই "মনিটরিং বন্ধ" হতে পারে না।
 * cron কলব্যাক থেকে বেরিয়ে যাওয়া rejected promise Node-এ unhandled
 * rejection, আর সেটা গোটা প্রসেস ফেলে দেয়।
 */

const meta: ReportMeta = {
  from: '2026-08-01',
  to: '2026-08-11',
  requestedTo: '2026-08-11',
  clampedToToday: false,
  days: 11,
  generatedAt: '2026-08-11T12:30:00.000Z',
  excludedEmployees: [],
  monthTargetHours: {},
  /**
   * ⭐ কর্মী ১-এর জন্য "গতকাল পর্যন্ত ৬৪ ঘণ্টা হওয়ার কথা ছিল" — সার্ভারের
   * একটাই সংজ্ঞা থেকে আসা সংখ্যা (`elapsedWindow()`)। নিচের summary সারিতে
   * গোনা হয়েছে ৪০, তাই তিনি ২৪ ঘণ্টা পিছিয়ে।
   *
   * ⚠️ খালি রাখলে প্রত্যাশা ০ ধরা হতো আর কেউ "পিছিয়ে" থাকত না — অর্থাৎ
   * ডাইজেস্টের সবচেয়ে জরুরি তালিকাটা নীরবে খালি চলে যেত।
   */
  expectedHours: { 1: 64 },
  // ⚠️ এই নমুনা জগতে কোনো ছুটিই নেই, তাই খালি — "কোনো সম্ভাব্য তারিখ নেই"
  approximateHolidayDates: [],
};

const attendance: AttendanceReport = {
  meta,
  rows: [
    {
      employeeId: 1,
      empCode: 'OX-001',
      fullName: 'মামুনুর রশিদ',
      department: null,
      date: '2026-08-11',
      dayType: 'workday',
      status: 'worked',
      workedHours: 7.5,
      idleHours: 0.5,
      adjustmentHours: 0,
      creditedHours: 7.5,
      targetHours: 8,
    },
  ],
  totals: {
    employees: 1,
    rows: 1,
    workedHours: 7.5,
    creditedHours: 7.5,
    targetHours: 8,
    daysWithWork: 1,
  },
};

const summary: SummaryReport = {
  meta,
  groupBy: 'month',
  overtimeNote: 'x',
  rows: [
    {
      employeeId: 1,
      empCode: 'OX-001',
      fullName: 'মামুনুর রশিদ',
      bucket: '2026-08',
      bucketStart: '2026-08-01',
      bucketEnd: '2026-08-11',
      workdays: 9,
      daysWithWork: 8,
      workedHours: 40,
      adjustmentHours: 0,
      creditedHours: 40,
      targetHours: 72,
      shortfallHours: 32,
      overtimeHours: 0,
    },
  ],
};

interface Sent {
  to: readonly string[];
  subject: string;
  body: string;
}

function makeService(
  over: {
    outcome?: SendOutcome;
    env?: Record<string, string>;
    owners?: { email: string }[];
    reports?: Partial<ReportsService>;
  } = {},
): { service: DigestService; sent: Sent[]; calls: { from: string; to: string }[] } {
  const sent: Sent[] = [];
  const calls: { from: string; to: string }[] = [];

  const prisma = {
    user: {
      findMany: () =>
        Promise.resolve(over.owners ?? [{ email: 'owner@example.com' }]),
    },
    // ⚠️ "আজ কতগুলো PC চুপ ছিল" — টেলিগ্রামের এক লাইনের জন্য (১৮ আগস্ট)
    alert: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaService;

  const reports = {
    attendance: (q: { from: string; to: string }) => {
      calls.push({ from: q.from, to: q.to });
      return Promise.resolve(attendance);
    },
    summary: (q: { from: string; to: string }) => {
      calls.push({ from: q.from, to: q.to });
      return Promise.resolve(summary);
    },
    ...over.reports,
  } as unknown as ReportsService;

  const mailer = {
    send: (to: readonly string[], subject: string, body: string) => {
      sent.push({ to, subject, body });
      return Promise.resolve(over.outcome ?? 'sent');
    },
  } as unknown as AlertMailer;

  const config = {
    get: (key: string) => over.env?.[key],
  } as unknown as ConfigService;

  /**
   * ⚠️ টেলিগ্রাম কনফিগ করা নেই ধরে নেওয়া — এই ফাইলের টেস্টগুলো ইমেইলের
   *    আচরণ নিয়ে। টেলিগ্রামকে টেনে আনলে প্রতিটা দাবির অর্থ ঘোলাটে হতো।
   */
  const telegram = {
    send: () => Promise.resolve('not_configured' as const),
    // ⚠️ দৈনিক রিপোর্ট এখন `sendHtml()` দিয়ে যায় (monospace) — স্টাবে
    //    না থাকলে গোটা `runOnce()` ছুড়ে বসত
    sendHtml: () => Promise.resolve('not_configured' as const),
  } as unknown as TelegramChannel;

  return {
    service: new DigestService(prisma, reports, mailer, telegram, config),
    sent,
    calls,
  };
}

/** UTC ১২:৩০ = ঢাকার সন্ধ্যা ৬:৩০ — জবটা ঠিক এই সময়েই চলে */
const AT_6_30_PM = new Date('2026-08-11T12:30:00.000Z');

describe('DigestService — কোন রেঞ্জ চাওয়া হয়', () => {
  it('⭐ আজকের একদিনের F01 আর মাসের ১ তারিখ → আজকের F02', async () => {
    const { service, calls } = makeService();
    await service.runOnce(AT_6_30_PM);

    expect(calls).toEqual([
      { from: '2026-08-11', to: '2026-08-11' },
      { from: '2026-08-01', to: '2026-08-11' },
    ]);
  });

  it('⚠️ "আজ" মানে ঢাকার আজ — UTC-তে তখনো গতকাল হলেও', async () => {
    // UTC ১১ আগস্ট ২০:০০ = ঢাকার ১২ আগস্ট ভোর ২টা
    const { service, calls } = makeService();
    await service.runOnce(new Date('2026-08-11T20:00:00.000Z'));

    expect(calls[0]).toEqual({ from: '2026-08-12', to: '2026-08-12' });
    expect(calls[1]).toEqual({ from: '2026-08-01', to: '2026-08-12' });
  });
});

describe('DigestService — কার কাছে যায়', () => {
  it('ডিফল্টে সক্রিয় owner-দের ইমেইলে', async () => {
    const { service, sent } = makeService({
      owners: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
    });

    const result = await service.runOnce(AT_6_30_PM);

    expect(sent[0].to).toEqual(['a@x.com', 'b@x.com']);
    expect(result.recipients).toBe(2);
    expect(result.outcome).toBe('sent');
  });

  it('DIGEST_EMAIL_TO থাকলে সেটাই — কমা দিয়ে ভাগ, ফাঁকা বাদ', async () => {
    const { service, sent } = makeService({
      env: { DIGEST_EMAIL_TO: ' ops@x.com , , hr@x.com ' },
    });

    await service.runOnce(AT_6_30_PM);
    expect(sent[0].to).toEqual(['ops@x.com', 'hr@x.com']);
  });

  it('⚠️ ALERT_EMAIL_TO ব্যবহার করা হয় না — অ্যালার্ট আর ডাইজেস্ট আলাদা তালিকা', () => {
    const { service, sent } = makeService({
      env: { ALERT_EMAIL_TO: 'sysadmin@x.com' },
      owners: [{ email: 'owner@x.com' }],
    });

    return service.runOnce(AT_6_30_PM).then(() => {
      expect(sent[0].to).toEqual(['owner@x.com']);
    });
  });
});

describe('DigestService — SMTP না থাকলে', () => {
  it('⚠️ ক্র্যাশ নয়, আর পুরো সারাংশটা লগে যায়', async () => {
    const { service, sent } = makeService({ outcome: 'not_configured' });
    const warn = vi
      .spyOn(
        (service as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    const result = await service.runOnce(AT_6_30_PM);

    expect(result.outcome).toBe('not_configured');
    // ⭐ শুধু "পাঠানো গেল না" নয় — সংখ্যাগুলোও লগে থাকে, নইলে SMTP ঠিক
    //    করার দিন পেছনের দিনগুলো চিরতরে হারিয়ে যেত
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain(sent[0].body);
    warn.mockRestore();
  });

  it('পাঠানো ব্যর্থ হলেও ফলটা একটা মান, ব্যতিক্রম নয়', async () => {
    const { service } = makeService({ outcome: 'failed' });
    vi.spyOn(
      (service as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);

    await expect(service.runOnce(AT_6_30_PM)).resolves.toMatchObject({
      outcome: 'failed',
    });
  });
});

describe('DigestJob — কখনো throw করে না', () => {
  it('⭐ রিপোর্ট ৫০০ ছুড়লেও জব শান্তভাবে null ফেরায়', async () => {
    const { service } = makeService({
      reports: {
        attendance: () =>
          Promise.reject(new Error('No active work policy found')),
      } as Partial<ReportsService>,
    });

    const job = new DigestJob(service);
    vi.spyOn(
      (job as unknown as { logger: { error: (m: string, s?: string) => void } })
        .logger,
      'error',
    ).mockImplementation(() => undefined);

    await expect(job.runOnce(AT_6_30_PM)).resolves.toBeNull();
  });

  it('সফল হলে ফলটাই ফেরে', async () => {
    const { service } = makeService();
    const job = new DigestJob(service);

    await expect(job.runOnce(AT_6_30_PM)).resolves.toMatchObject({
      workDate: '2026-08-11',
      employees: 1,
      behind: 1,
    });
  });

  it('⚠️ টেস্টে শিডিউলার বন্ধ — `scheduled()` কিছুই করে না', async () => {
    const { service, sent } = makeService();
    const job = new DigestJob(service);

    // NODE_ENV=test, তাই SCHEDULING_ENABLED = false
    await job.scheduled();
    expect(sent).toHaveLength(0);
  });
});
