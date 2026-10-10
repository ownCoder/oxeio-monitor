import {describe,expect,it} from 'vitest';
import {chartBarHeight,chartMaximum} from '../src/pages/targets/daily-chart-scale';

describe('daily output chart scale',()=>{
 it('fits a day with more skips than completions inside the chart',()=>{
  const maximum=chartMaximum([{completed:1,skipped:7}]);
  expect(maximum).toBe(7);
  expect(chartBarHeight(7,maximum)).toBe(100);
  expect(chartBarHeight(1,maximum)).toBeCloseTo(100/7);
 });

 it('uses the largest value across all days and never exceeds chart height',()=>{
  const maximum=chartMaximum([{completed:4,skipped:2},{completed:1,skipped:9}]);
  expect(maximum).toBe(9);
  expect(chartBarHeight(4,maximum)).toBeCloseTo(400/9);
  expect(chartBarHeight(10,maximum)).toBe(100);
  expect(chartBarHeight(0,maximum)).toBe(0);
  expect(chartMaximum([])).toBe(1);
 });
});
