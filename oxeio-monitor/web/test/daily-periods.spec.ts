import {describe,expect,it} from 'vitest';
import {dailyPeriodRange,dhakaToday} from '../src/pages/targets/daily-periods';

describe('daily dashboard periods',()=>{
 it('uses Dhaka calendar day on either side of UTC midnight',()=>{
  expect(dhakaToday(new Date('2026-10-07T17:59:59Z'))).toBe('2026-10-07');
  expect(dhakaToday(new Date('2026-10-07T18:00:00Z'))).toBe('2026-10-08');
 });
 it('uses inclusive rolling days and crosses month/year boundaries',()=>{
  expect(dailyPeriodRange('yesterday','2026-01-01')).toEqual({from:'2025-12-31',to:'2025-12-31'});
  expect(dailyPeriodRange('days7','2026-10-08')).toEqual({from:'2026-10-02',to:'2026-10-08'});
  expect(dailyPeriodRange('days14','2026-10-08')).toEqual({from:'2026-09-25',to:'2026-10-08'});
  expect(dailyPeriodRange('days30','2026-03-01')).toEqual({from:'2026-01-31',to:'2026-03-01'});
 });
 it('keeps month-to-date, year-to-date and whole year distinct',()=>{
  expect(dailyPeriodRange('month','2026-10-08')).toEqual({from:'2026-10-01',to:'2026-10-08'});
  expect(dailyPeriodRange('ytd','2026-10-08')).toEqual({from:'2026-01-01',to:'2026-10-08'});
  expect(dailyPeriodRange('year','2026-10-08')).toEqual({from:'2026-01-01',to:'2026-12-31'});
  expect(dailyPeriodRange('year','2028-10-08')).toEqual({from:'2028-01-01',to:'2028-12-31'});
 });
});
