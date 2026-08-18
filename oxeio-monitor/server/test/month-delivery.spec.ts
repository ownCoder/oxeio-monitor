import { afterEach, describe, expect, it, vi } from 'vitest';

import { TelegramChannel } from '../src/alerts/telegram.channel';
import {
  monthCaption,
  monthRange,
  monthReportName,
} from '../src/reports/month-delivery.rules';
import {
  TELEGRAM_CAPTION_MAX,
  TELEGRAM_DOCUMENT_MAX_BYTES,
} from '../src/ops/ops.constants';

/**
 * **R26 — মাস বন্ধ হলে হিসাবের ফাইল নিজে থেকে যায়।**
 *
 * দুটো স্তর আলাদা করে পরীক্ষা করা হয়: খাঁটি নিয়ম (রেঞ্জ · ক্যাপশন · নাম),
 * আর টেলিগ্রামে ফাইল তোলার আসল অনুরোধটা (`fetch` স্টাব করে)।
 */

describe('monthRange — মাসের প্রথম ও শেষ দিন', () => {
  it('৩১ দিনের মাস', () => {
    expect(monthRange('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('৩০ দিনের মাস', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  /** ⚠️⚠️ ৩০/৩১ ধরে নিলে ফেব্রুয়ারিতে দু-দিনের ঘণ্টা নীরবে বাদ পড়ত */
  it('ফেব্রুয়ারি — সাধারণ ও অধিবর্ষ', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28');
    expect(monthRange('2028-02').to).toBe('2028-02-29');
  });

  it('ডিসেম্বর বছর পেরোয় না', () => {
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('ভুল মাস নিলে থামে', () => {
    expect(() => monthRange('2026-13')).toThrow(RangeError);
    expect(() => monthRange('2026-1')).toThrow(RangeError);
    expect(() => monthRange('not-a-month')).toThrow(RangeError);
  });
});

describe('monthCaption — টেলিগ্রামে যা লেখা যায়', () => {
  const caption = monthCaption({
    orgName: 'oXeio',
    yearMonth: '2026-07',
    people: 12,
    totalHours: 2416.7,
  });

  it('মাস, লোকসংখ্যা আর মোট ঘণ্টা থাকে', () => {
    expect(caption).toContain('2026-07');
    expect(caption).toContain('12 staff');
    expect(caption).toContain('2417 hours');
  });

  /**
   * ⚠️⚠️ সবচেয়ে জরুরি পাহারা — ক্যাপশনে **কারো নাম নেই**। বার্তা
   * টেলিগ্রামের সার্ভারে জমে থাকে; নাম-ধরে হিসাব থাকে সংযুক্ত ফাইলে।
   */
  it('কোনো কর্মীর নাম যায় না', () => {
    const c = monthCaption({
      orgName: 'oXeio',
      yearMonth: '2026-07',
      people: 3,
      totalHours: 100,
    });
    expect(c).not.toMatch(/[A-Z][a-z]+ [A-Z][a-z]+/); // "Rakib Hasan" ধাঁচ
  });

  it('ক্যাপশন টেলিগ্রামের সীমার ভেতরে', () => {
    expect(caption.length).toBeLessThan(TELEGRAM_CAPTION_MAX);
  });
});

describe('monthReportName', () => {
  it('তারিখসহ ASCII নাম', () => {
    expect(monthReportName('2026-07', 'xlsx')).toBe(
      'oxeio-summary-2026-07-01_2026-07-31.xlsx',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TelegramChannel.sendDocument — আসল অনুরোধটা
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ এই স্যুটে আগে কেউ `fetch` স্টাব করেনি — চ্যানেলগুলো টেস্টে
 * `not_configured` হয়ে থেমে যেত বলে দরকার পড়েনি। ফাইল আপলোডের **আকৃতিটাই**
 * এখানে আসল জিনিস, তাই এখানে স্টাব করা হয়।
 */
function channelWith(settings: { botToken: string; chatId: string } | null) {
  const channel = Object.create(TelegramChannel.prototype) as TelegramChannel;
  Object.assign(channel, {
    logger: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
  });
  vi.spyOn(channel, 'resolve').mockResolvedValue(settings);
  return channel;
}

const ok = () => new Response('{"ok":true}', { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TelegramChannel.sendDocument', () => {
  it('multipart হিসেবে যায়, আর ঠিক নাম-ক্যাপশন নিয়ে', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const channel = channelWith({ botToken: 'TOKEN', chatId: '42' });
    const outcome = await channel.sendDocument(
      {
        bytes: Buffer.from('hello'),
        filename: 'oxeio-summary-2026-07-01_2026-07-31.xlsx',
        contentType: 'application/vnd.ms-excel',
      },
      'July is closed',
    );

    expect(outcome).toBe('sent');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sendDocument');

    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('chat_id')).toBe('42');
    expect(body.get('caption')).toBe('July is closed');

    const file = body.get('document') as File;
    expect(file.name).toBe('oxeio-summary-2026-07-01_2026-07-31.xlsx');
    expect(file.size).toBe(5);
  });

  /**
   * ⚠️⚠️ **এটাই সবচেয়ে দামি টেস্ট।** হাতে `content-type` বসালে `fetch`-এর
   * তৈরি করা `boundary` হারিয়ে যায় আর Telegram প্রতিবার ৪০০ দেয় — দেখতে
   * লাগে টোকেনের সমস্যা। পাশের `send()`-এ হেডারটা আছে, তাই ভুলটা
   * কপি-পেস্টে ফিরে আসা খুব সহজ।
   */
  it('কোনো headers বসানো হয় না (boundary যেন না হারায়)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const channel = channelWith({ botToken: 'TOKEN', chatId: '42' });
    await channel.sendDocument({ bytes: Buffer.from('x'), filename: 'a.xlsx' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toBeUndefined();
  });

  it('কনফিগার করা না থাকলে কিছুই পাঠানো হয় না', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const channel = channelWith(null);
    const outcome = await channel.sendDocument({
      bytes: Buffer.from('x'),
      filename: 'a.xlsx',
    });

    expect(outcome).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** ⚠️ আগে মাপা, তারপর পাঠানো — নইলে পুরো আপলোড খরচ করে তবে জানা যেত */
  it('৫০ MB-র বেশি হলে চেষ্টাই করা হয় না', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const channel = channelWith({ botToken: 'TOKEN', chatId: '42' });
    const big = {
      bytes: Buffer.alloc(TELEGRAM_DOCUMENT_MAX_BYTES + 1),
      filename: 'huge.xlsx',
    };

    expect(await channel.sendDocument(big)).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('লম্বা ক্যাপশন ছেঁটে দেওয়া হয়', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const channel = channelWith({ botToken: 'TOKEN', chatId: '42' });
    await channel.sendDocument(
      { bytes: Buffer.from('x'), filename: 'a.xlsx' },
      'ক'.repeat(TELEGRAM_CAPTION_MAX + 500),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const caption = (init.body as FormData).get('caption') as string;
    expect(caption.length).toBe(TELEGRAM_CAPTION_MAX);
  });

  /** ⚠️ খালি ক্যাপশন **পাঠানোই হয় না** — খালি স্ট্রিংয়ে Telegram ৪০০ দেয় */
  it('ক্যাপশন না থাকলে ঘরটাই বসে না', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const channel = channelWith({ botToken: 'TOKEN', chatId: '42' });
    await channel.sendDocument({ bytes: Buffer.from('x'), filename: 'a.xlsx' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get('caption')).toBeNull();
  });

  /** ⚠️ উদ্ধৃতি/নিউলাইন multipart-এর হেডারই ভেঙে দিত */
  it('ফাইলের নাম ছেঁকে নেওয়া হয়', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const channel = channelWith({ botToken: 'TOKEN', chatId: '42' });
    await channel.sendDocument({
      bytes: Buffer.from('x'),
      filename: 'বেতন "2026".xlsx\n',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const file = (init.body as FormData).get('document') as File;
    expect(file.name).toBe('2026.xlsx');
  });

  it('সার্ভার না নিলে failed, কিন্তু throw নয়', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 400 })),
    );

    const channel = channelWith({ botToken: 'TOKEN', chatId: '42' });
    expect(
      await channel.sendDocument({ bytes: Buffer.from('x'), filename: 'a.xlsx' }),
    ).toBe('failed');
  });

  it('নেটওয়ার্ক ভাঙলেও throw নয়', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const channel = channelWith({ botToken: 'TOKEN', chatId: '42' });
    expect(
      await channel.sendDocument({ bytes: Buffer.from('x'), filename: 'a.xlsx' }),
    ).toBe('failed');
  });
});
