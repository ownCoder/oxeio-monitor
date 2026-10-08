export type DailyPeriod = 'today' | 'yesterday' | 'days7' | 'days14' | 'days30' | 'month' | 'ytd' | 'year' | 'custom';

export const dailyPeriodOptions: ReadonlyArray<readonly [DailyPeriod, string]> = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['days7', '7 days'],
  ['days14', '14 days'], ['days30', '30 days'], ['month', 'This month'],
  ['ytd', 'Year to Date'], ['year', 'This Year'], ['custom', 'Custom'],
];

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const shiftDay = (today: string, days: number) => isoDate(new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000));

export function dhakaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function dailyPeriodRange(period: Exclude<DailyPeriod, 'custom'>, today = dhakaToday()): { from: string; to: string } {
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  switch (period) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const yesterday = shiftDay(today, -1); return { from: yesterday, to: yesterday }; }
    case 'days7': return { from: shiftDay(today, -6), to: today };
    case 'days14': return { from: shiftDay(today, -13), to: today };
    case 'days30': return { from: shiftDay(today, -29), to: today };
    case 'month': return { from: `${month}-01`, to: today };
    case 'ytd': return { from: `${year}-01-01`, to: today };
    case 'year': return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
}
