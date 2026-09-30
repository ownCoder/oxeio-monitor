import { parseWorkDate } from './gallery.math';

export const TIME_BANDS = ['all', '00-06', '06-12', '12-18', '18-24'] as const;
export type TimeBand = (typeof TIME_BANDS)[number];

export interface GalleryWindow {
  from: Date;
  to: Date;
  days: Date[];
}

/** Work dates are UTC-midnight dates, while capture instants use Dhaka UTC+6. */
export function galleryWindow(fromDate: string, toDate: string): GalleryWindow | null {
  const from = parseWorkDate(fromDate);
  const to = parseWorkDate(toDate);
  if (!from || !to) return null;
  const span = (to.getTime() - from.getTime()) / 86_400_000;
  if (!Number.isInteger(span) || span < 0 || span > 6) return null;
  return {
    from,
    to,
    days: Array.from({ length: span + 1 }, (_, i) => new Date(from.getTime() + i * 86_400_000)),
  };
}

export function captureWindow(day: Date, band: Exclude<TimeBand, 'all'>) {
  const [start, end] = band.split('-').map(Number);
  const dhakaMidnight = day.getTime() - 6 * 3_600_000;
  return {
    workDate: day,
    capturedAt: {
      gte: new Date(dhakaMidnight + start * 3_600_000),
      lt: new Date(dhakaMidnight + end * 3_600_000),
    },
  };
}
