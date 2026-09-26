import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { UPLOAD_QUEUE_FROM } from '../targets/targets.rules';

export const QUEUES = [
  'unstarted',
  'in_progress',
  'to_check',
  'to_fix',
  'to_upload',
  'to_live',
] as const;
export type Queue = (typeof QUEUES)[number];
export const WAIT_FIELD = {
  unstarted: 'assignedAt',
  in_progress: 'startedAt',
  to_check: 'completedAt',
  to_fix: 'errorFoundAt',
  to_upload: 'completedAt',
  to_live: 'uploadedAt',
} as const;
export function queueWhere(queue: Queue): Prisma.DesignTargetWhereInput {
  const completedAt = {
    not: null,
    gte: new Date(`${UPLOAD_QUEUE_FROM}T00:00:00+06:00`),
  };
  switch (queue) {
    case 'unstarted':
      return { status: 'assigned', startedAt: null };
    case 'in_progress':
      return { status: 'assigned', startedAt: { not: null } };
    case 'to_check':
      return { completedAt, checkedAt: null };
    case 'to_fix':
      return { errorFoundAt: { not: null }, fixedAt: null };
    case 'to_upload':
      return { completedAt, uploadedAt: null };
    case 'to_live':
      return { uploadedAt: { not: null }, liveAt: null };
  }
}

export function validDay(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new BadRequestException('Use YYYY-MM-DD.');
  const date = new Date(`${day}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  ) {
    throw new BadRequestException('Invalid calendar date.');
  }
  return new Date(`${day}T00:00:00+06:00`);
}

export function reportRange(from: string, to: string) {
  const start = validDay(from),
    end = new Date(validDay(to).getTime() + 86400000);
  if (end <= start || end.getTime() - start.getTime() > 366 * 86400000) {
    throw new BadRequestException('Choose a range of at most 366 days.');
  }
  return { start, end };
}

export interface SaleInput {
  period: string;
  liveAsin: string;
  units: number;
  royalty: string;
  currency: string;
}

/** A bounded RFC4180-style reader; commas, quoted fields and CRLF are supported. */
export function parseSalesCsv(text: string): SaleInput[] {
  if (text.length > 1_000_000)
    throw new BadRequestException('CSV is too large (maximum 1 MB).');
  const records: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field.trim());
      field = '';
      closed = false;
      if (c !== ',') {
        if (row.some(Boolean)) records.push(row);
        row = [];
        if (c === '\r' && input[i + 1] === '\n') i++;
      }
    } else {
      if (closed || c === '"')
        throw new BadRequestException('Malformed quoted CSV field.');
      field += c;
    }
  }
  if (quoted) throw new BadRequestException('Unclosed CSV quote.');
  row.push(field.trim());
  if (row.some(Boolean)) records.push(row);
  if (
    records.shift()?.join(',').toLowerCase() !==
    'period,live_asin,units,royalty,currency'
  ) {
    throw new BadRequestException(
      'Use the template columns: period,live_asin,units,royalty,currency.',
    );
  }
  if (!records.length || records.length > 2000)
    throw new BadRequestException('Import 1–2,000 monthly product rows.');
  const keys = new Set<string>();
  return records.map((r, index) => {
    const [period, asin, units, royalty, currencyRaw] = r;
    const currency = currencyRaw?.toUpperCase(),
      liveAsin = asin?.toUpperCase();
    if (
      r.length !== 5 ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
      !/^[A-Z0-9]{10}$/.test(liveAsin) ||
      !/^-?\d{1,8}$/.test(units) ||
      !/^-?\d{1,10}(\.\d{1,2})?$/.test(royalty) ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      throw new BadRequestException(
        `Invalid data at CSV row ${index + 2}. Use monthly totals and currency codes.`,
      );
    }
    const key = `${period}:${liveAsin}:${currency}`;
    if (keys.has(key))
      throw new BadRequestException(
        `Duplicate product/month/currency at row ${index + 2}.`,
      );
    keys.add(key);
    const [whole, fraction = ''] = royalty.split('.');
    return {
      period,
      liveAsin,
      units: Number(units),
      royalty: `${whole}.${fraction.padEnd(2, '0')}`,
      currency,
    };
  });
}
