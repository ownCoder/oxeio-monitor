import { describe, expect, it } from 'vitest';
import {
  parseSalesCsv,
  reportRange,
  validDay,
} from '../src/production/production.rules';
import { heartbeatUrl } from '../src/production/monitor.service';
const header = 'period,live_asin,units,royalty,currency\n';
describe('production inputs', () => {
  it('normalizes BOM, CRLF, quoted monthly totals and refunds without floating point rounding', () => {
    expect(
      parseSalesCsv(
        '\uFEFF' + header + '"2026-09","b012345678",-2,-12.3,usd\r\n',
      ),
    ).toEqual([
      {
        period: '2026-09',
        liveAsin: 'B012345678',
        units: -2,
        royalty: '-12.30',
        currency: 'USD',
      },
    ]);
  });
  it.each([
    '2026-13,B012345678,1,1,USD',
    '2026-09,B012345678,1,1.234,USD',
    '2026-09,B012345678,1e3,1,USD',
    '2026-09,=cmd,1,1,USD',
    '"2026-09,B012345678,1,1,USD',
    '"2026-09"x,B012345678,1,1,USD',
  ])('rejects invalid CSV %s', (row) =>
    expect(() => parseSalesCsv(header + row)).toThrow(),
  );
  it('blocks duplicates but permits separate currencies', () => {
    const row = '2026-09,B012345678,1,1,USD';
    expect(() =>
      parseSalesCsv(header + row + '\n' + row.toLowerCase()),
    ).toThrow(/Duplicate/);
    expect(
      parseSalesCsv(header + row + '\n' + row.replace('USD', 'EUR')),
    ).toHaveLength(2);
  });
  it('rejects empty/oversized input', () => {
    expect(() => parseSalesCsv(header)).toThrow();
    expect(() => parseSalesCsv('a'.repeat(1000001))).toThrow();
    expect(() =>
      parseSalesCsv(
        header +
          Array.from(
            { length: 2001 },
            (_, n) => `2026-09,B${String(n).padStart(9, '0')},1,1,USD`,
          ).join('\n'),
      ),
    ).toThrow();
  });
  it('validates actual calendar dates and inclusive Dhaka boundaries', () => {
    expect(() => validDay('2026-02-30')).toThrow();
    expect(() => reportRange('2026-09-03', '2026-09-02')).toThrow();
    expect(() => reportRange('2024-01-01', '2026-01-01')).toThrow();
    const range = reportRange('2026-09-01', '2026-09-01');
    expect(range.start.toISOString()).toBe('2026-08-31T18:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-09-01T18:00:00.000Z');
  });
  it('only accepts fixed HTTPS heartbeat provider UUID URLs', () => {
    const good = 'https://hc-ping.com/12345678-1234-1234-1234-123456789abc';
    expect(heartbeatUrl(good)).toBe(good);
    for (const bad of [
      undefined,
      'http://localhost',
      good + '?x=y',
      good + '/fail',
      good.replace('hc-ping.com', 'hc-ping.com.evil.test'),
      good.replace('https', 'http'),
    ])
      expect(heartbeatUrl(bad)).toBeNull();
  });
});
