import { afterEach, describe, expect, it } from 'vitest';

import {
  dhakaHourNow,
  formatDateTime,
  formatTime,
  setWorkTimeZone,
  thisMonthRange,
  todayInDhaka,
  workDateOf,
  workOffsetIso,
  workOffsetMs,
  workTimeZone,
  workTimeZoneLabel,
} from '../src/lib/format';

/**
 * The work-day zone comes from the server (`GET /auth/time-zone`, called in
 * `main.tsx` before the first render). These tests check that:
 *  1. without that answer every helper is exactly what it was with the
 *     hardcoded UTC+6 — `format.spec.ts` already runs that way;
 *  2. a negative offset (America/Sao_Paulo, UTC−3) cuts days at its own
 *     midnight, across month and year boundaries.
 */

const DHAKA = { timeZone: 'Asia/Dhaka', utcOffsetMinutes: 360 };
const SAO_PAULO = { timeZone: 'America/Sao_Paulo', utcOffsetMinutes: -180 };

afterEach(() => setWorkTimeZone(DHAKA));

describe('default — Asia/Dhaka, as before', () => {
  it('is Dhaka, +6 h', () => {
    expect(workTimeZone()).toBe('Asia/Dhaka');
    expect(workTimeZoneLabel()).toBe('Dhaka');
    expect(workOffsetMs()).toBe(6 * 3_600_000);
    expect(workOffsetIso()).toBe('+06:00');
  });

  it('the day still turns at 18:00 UTC', () => {
    expect(todayInDhaka(new Date('2026-08-11T17:59:00Z'))).toBe('2026-08-11');
    expect(todayInDhaka(new Date('2026-08-11T18:00:00Z'))).toBe('2026-08-12');
    expect(formatTime('2026-08-11T12:30:00Z')).toBe('18:30');
  });
});

describe('America/Sao_Paulo (UTC−3)', () => {
  it('exposes −3 h', () => {
    setWorkTimeZone(SAO_PAULO);
    expect(workTimeZone()).toBe('America/Sao_Paulo');
    expect(workTimeZoneLabel()).toBe('Sao Paulo');
    expect(workOffsetMs()).toBe(-3 * 3_600_000);
    expect(workOffsetIso()).toBe('-03:00');
  });

  it('the day turns at 00:00 local = 03:00 UTC', () => {
    setWorkTimeZone(SAO_PAULO);
    expect(todayInDhaka(new Date('2026-08-11T02:59:00Z'))).toBe('2026-08-10');
    expect(todayInDhaka(new Date('2026-08-11T03:00:00Z'))).toBe('2026-08-11');
    // 15:00 local — where the Dhaka offset used to turn the day
    expect(workDateOf('2026-08-11T18:00:00Z')).toBe('2026-08-11');
  });

  it('clocks and hours are local', () => {
    setWorkTimeZone(SAO_PAULO);
    expect(formatTime('2026-08-11T21:30:00Z')).toBe('18:30');
    expect(dhakaHourNow(new Date('2026-08-11T10:05:00Z'))).toBe(7);
    expect(dhakaHourNow(new Date('2026-08-11T03:10:00Z'))).toBe(0);
    expect(formatDateTime('2026-08-12T02:30:00Z')).toBe(
      '11 August 2026, 23:30',
    );
  });

  it('month and year roll over at local midnight', () => {
    setWorkTimeZone(SAO_PAULO);
    // 31 Dec 23:59 local
    expect(thisMonthRange(new Date('2027-01-01T02:59:00Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(thisMonthRange(new Date('2027-01-01T03:00:00Z'))).toEqual({
      from: '2027-01-01',
      to: '2027-01-01',
    });
  });

  it('ignores a malformed answer and keeps the previous zone', () => {
    setWorkTimeZone({ timeZone: 'Broken', utcOffsetMinutes: Number.NaN });
    expect(workTimeZone()).toBe('Asia/Dhaka');
    expect(workOffsetMs()).toBe(6 * 3_600_000);
  });
});
