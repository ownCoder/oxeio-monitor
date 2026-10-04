import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * WORK_TIMEZONE — the work-day zone is configurable, Asia/Dhaka by default.
 *
 * The offset is read from `process.env` when `dhaka-time.ts` is imported
 * (the `@Cron` options need it before Nest exists), so each case here
 * re-imports the modules under a stubbed env instead of calling a setter.
 *
 * Two promises are checked:
 *  1. With nothing set, every value is exactly what it was when the offset
 *     was the constant 360 — the rest of the suite already runs that way.
 *  2. A negative offset (America/Sao_Paulo, UTC−3) cuts days at its own
 *     midnight, including across month and year boundaries. Before, the
 *     Brazilian work day turned over at 15:00 local time.
 */

async function load(timeZone?: string) {
  vi.resetModules();
  if (timeZone === undefined) vi.stubEnv('WORK_TIMEZONE', '');
  else vi.stubEnv('WORK_TIMEZONE', timeZone);

  return {
    time: await import('../src/agent/util/dhaka-time'),
    alerts: await import('../src/alerts/alerts.rules'),
    summary: await import('../src/summary/summary.math'),
    ops: await import('../src/ops/ops.rules'),
    scheduling: await import('../src/summary/scheduling'),
    digest: await import('../src/digest/digest.math'),
    pdf: await import('../src/reports/reports.pdf.text'),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const at = (iso: string): Date => new Date(iso);
const day = (d: Date): string => d.toISOString().slice(0, 10);

describe('fixedOffsetMinutes', () => {
  it('reads the offset of zones without DST', async () => {
    const { time } = await load();
    expect(time.fixedOffsetMinutes('Asia/Dhaka')).toBe(360);
    expect(time.fixedOffsetMinutes('America/Sao_Paulo')).toBe(-180);
    expect(time.fixedOffsetMinutes('Asia/Kolkata')).toBe(330);
    expect(time.fixedOffsetMinutes('UTC')).toBe(0);
  });

  it('refuses a zone with DST, in either hemisphere', async () => {
    const { time } = await load();
    expect(() => time.fixedOffsetMinutes('Europe/London')).toThrow(/daylight/);
    expect(() => time.fixedOffsetMinutes('Australia/Sydney')).toThrow(
      /daylight/,
    );
  });

  it('refuses Sao Paulo in a year it still had DST', async () => {
    const { time } = await load();
    // Brazil dropped DST in 2019 — the check is about the rules, not the name
    expect(() => time.fixedOffsetMinutes('America/Sao_Paulo', 2018)).toThrow(
      /daylight/,
    );
  });

  it('refuses an unknown name', async () => {
    const { time } = await load();
    expect(() => time.fixedOffsetMinutes('Mars/Olympus')).toThrow(/IANA/);
  });

  it('a DST zone in WORK_TIMEZONE stops the import, not a silent fallback', async () => {
    await expect(load('Europe/Berlin')).rejects.toThrow(/daylight/);
  });
});

describe('default (WORK_TIMEZONE unset) — unchanged', () => {
  it('is Asia/Dhaka, +360, +06:00', async () => {
    const { time, scheduling } = await load();
    expect(time.WORK_TIMEZONE).toBe('Asia/Dhaka');
    expect(time.LOCAL_OFFSET_MIN).toBe(360);
    expect(time.DHAKA_OFFSET_MIN).toBe(360);
    expect(time.LOCAL_OFFSET_ISO).toBe('+06:00');
    expect(time.WORK_TIMEZONE_LABEL).toBe('Dhaka');
    expect(scheduling.JOB_TIMEZONE).toBe('Asia/Dhaka');
  });

  it('the Dhaka day still turns at 18:00 UTC', async () => {
    const { time } = await load();
    expect(day(time.workDateOf(at('2026-08-11T17:59:59Z')))).toBe('2026-08-11');
    expect(day(time.workDateOf(at('2026-08-11T18:00:00Z')))).toBe('2026-08-12');
    expect(time.localMidnightOf(at('2026-08-12T03:00:00Z')).toISOString()).toBe(
      '2026-08-11T18:00:00.000Z',
    );
  });

  it('human-facing text still says Dhaka', async () => {
    const { pdf } = await load();
    expect(pdf.dhakaStamp(at('2026-08-11T12:30:00Z'))).toBe(
      '2026-08-11 18:30 (Asia/Dhaka)',
    );
  });
});

describe('America/Sao_Paulo (UTC−3)', () => {
  const SP = 'America/Sao_Paulo';

  it('exposes −180 and -03:00', async () => {
    const { time, scheduling } = await load(SP);
    expect(time.LOCAL_OFFSET_MIN).toBe(-180);
    expect(time.LOCAL_OFFSET_ISO).toBe('-03:00');
    expect(time.WORK_TIMEZONE_LABEL).toBe('Sao Paulo');
    expect(scheduling.JOB_TIMEZONE).toBe(SP);
  });

  it('the day turns at 00:00 local = 03:00 UTC, not at 15:00 local', async () => {
    const { time } = await load(SP);
    expect(day(time.workDateOf(at('2026-08-11T02:59:59Z')))).toBe('2026-08-10');
    expect(day(time.workDateOf(at('2026-08-11T03:00:00Z')))).toBe('2026-08-11');
    // 15:00 local, where the Dhaka offset used to cut the day
    expect(day(time.workDateOf(at('2026-08-11T18:00:00Z')))).toBe('2026-08-11');
    expect(
      time.sameWorkDate(at('2026-08-11T03:00:00Z'), at('2026-08-12T02:59:59Z')),
    ).toBe(true);
  });

  it('local midnight is a real instant 3 hours after UTC midnight', async () => {
    const { time } = await load(SP);
    const noon = at('2026-08-11T15:00:00Z');
    expect(time.localMidnightOf(noon).toISOString()).toBe(
      '2026-08-11T03:00:00.000Z',
    );
    expect(time.nextLocalMidnight(noon).toISOString()).toBe(
      '2026-08-12T03:00:00.000Z',
    );
  });

  it('rolls over months and years at local midnight', async () => {
    const { time } = await load(SP);
    // 31 Aug 23:30 local
    expect(day(time.workDateOf(at('2026-09-01T02:30:00Z')))).toBe('2026-08-31');
    // 31 Dec 23:59 local — still last year
    expect(day(time.workDateOf(at('2027-01-01T02:59:00Z')))).toBe('2026-12-31');
    expect(day(time.workDateOf(at('2027-01-01T03:00:00Z')))).toBe('2027-01-01');
    expect(time.localMidnightOf(at('2027-01-01T01:00:00Z')).toISOString()).toBe(
      '2026-12-31T03:00:00.000Z',
    );
    expect(time.dhakaPathParts(at('2027-01-01T02:59:58Z'))).toEqual({
      year: '2026',
      month: '12',
      day: '31',
      hhmmss: '235958',
    });
  });

  it('hours and clocks are local', async () => {
    const { time, summary, alerts } = await load(SP);
    const t = at('2026-08-11T10:05:00Z'); // 07:05 local
    expect(time.dhakaHourOf(t)).toBe(7);
    expect(summary.dhakaHourOf(t)).toBe(7);
    expect(alerts.dhakaHourOf(t)).toBe(7);
    expect(alerts.dhakaMinuteOfDay(t)).toBe(7 * 60 + 5);
    expect(time.dhakaClock(at('2026-08-11T21:30:00Z'))).toBe('18:30');
    // just after local midnight: hour 0, not 21 of the day before
    expect(time.dhakaHourOf(at('2026-08-11T03:10:00Z'))).toBe(0);
  });

  it('the weekly off day is the local weekday', async () => {
    const { alerts } = await load(SP);
    // Fri 14 Aug 2026, 22:00 local = Sat 01:00 UTC
    expect(alerts.dhakaIsoWeekday(at('2026-08-15T01:00:00Z'))).toBe(5);
    const input = {
      officeFrom: '09:00',
      officeTo: '18:00',
      weeklyOffDay: 5,
      isHoliday: false,
    };
    // Fri 10:00 local — off day
    expect(
      alerts.isOfficeOpen({ ...input, now: at('2026-08-14T13:00:00Z') }),
    ).toBe(false);
    // Thu 10:00 local — open; Thu 08:59 local — not yet
    expect(
      alerts.isOfficeOpen({ ...input, now: at('2026-08-13T13:00:00Z') }),
    ).toBe(true);
    expect(
      alerts.isOfficeOpen({ ...input, now: at('2026-08-13T11:59:00Z') }),
    ).toBe(false);
  });

  it('the no-activity alert window (18–22) is local', async () => {
    const { alerts } = await load(SP);
    expect(alerts.isNoActivityWindow(at('2026-08-11T21:00:00Z'))).toBe(true); // 18:00
    expect(alerts.isNoActivityWindow(at('2026-08-12T01:00:00Z'))).toBe(false); // 22:00
    expect(alerts.isNoActivityWindow(at('2026-08-11T15:00:00Z'))).toBe(false); // 12:00
  });

  it('backup names carry the local date and parse back to the same instant', async () => {
    const { ops } = await load(SP);
    const now = at('2027-01-01T02:30:00Z'); // 31 Dec 23:30 local
    const name = ops.backupFileName(now);
    expect(name).toContain('2026-12-31-2330');
    expect(ops.parseBackupName(name)?.toISOString()).toBe(now.toISOString());
  });

  it('report stamps and the digest name the configured zone', async () => {
    const { pdf, digest } = await load(SP);
    expect(pdf.dhakaStamp(at('2026-08-11T21:30:00Z'))).toBe(
      '2026-08-11 18:30 (America/Sao_Paulo)',
    );
    const body = digest.digestBody(
      digest.buildDigest({
        workDate: '2026-08-11',
        monthFrom: '2026-08-01',
        monthTo: '2026-08-11',
        today: [],
        month: [],
        expectedHours: {},
      }),
      'oXeio',
    );
    expect(body).toContain('2026-08-11 (Sao Paulo)');
  });
});
