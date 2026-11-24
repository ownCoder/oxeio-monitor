import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import {
  TELEGRAM_RETRY_AFTER_CAP_MS,
  telegramRetryWaitMs,
  type TelegramChannel,
} from '../src/alerts/telegram.channel';
import type { PrismaService } from '../src/prisma/prisma.service';
import { DesignDoneNoticeService } from '../src/targets/design-done-notice.service';
import {
  designDoneMessage,
  designDoneTelegramEnabled,
  designUndoneMessage,
  formatTimeTaken,
  noticeForLatest,
  type DesignNoticeFacts,
} from '../src/targets/design-done-notice.rules';

const started = new Date('2026-11-24T08:18:00.000Z');
const doneAt = new Date('2026-11-24T09:42:00.000Z');

const facts: DesignNoticeFacts = {
  designerName: 'Karim Hossain',
  markedByName: 'Karim Hossain',
  asin: 'B0TEST1234',
  jobNumber: 1000042,
  startedAt: started,
  completedAt: doneAt,
  at: doneAt,
};

describe('noticeForLatest', () => {
  it('fires on the first transition to done', () => {
    expect(noticeForLatest(['assigned', 'started', 'completed'])).toBe('done');
  });

  it('does not fire on other updates', () => {
    for (const latest of [
      'started',
      'updated',
      'skipped',
      'checked',
      'uploaded',
      'returned',
    ]) {
      expect(noticeForLatest(['assigned', latest])).toBe('none');
    }
    expect(noticeForLatest(['assigned', 'completed', 'updated'])).toBe('none');
  });

  it('does not fire a second done after undo and redo', () => {
    expect(noticeForLatest(['assigned', 'completed', 'undone'])).toBe('undone');
    expect(
      noticeForLatest(['assigned', 'completed', 'undone', 'completed']),
    ).toBe('none');
    expect(
      noticeForLatest([
        'assigned',
        'completed',
        'undone',
        'completed',
        'undone',
      ]),
    ).toBe('none');
  });

  it('fires again after the design is returned and assigned', () => {
    expect(
      noticeForLatest([
        'assigned',
        'completed',
        'returned',
        'assigned',
        'completed',
      ]),
    ).toBe('done');
  });
});

describe('design done message', () => {
  it('names the designer, the design, the time taken and Dhaka time', () => {
    const text = designDoneMessage(facts);
    expect(text.startsWith('oXeio Monitoring\n')).toBe(true);
    expect(text).toContain('✅ ডিজাইন শেষ');
    expect(text).toContain('ডিজাইনার: Karim Hossain');
    expect(text).toContain('ডিজাইন: #1000042 · B0TEST1234');
    expect(text).toContain('সময় লেগেছে: 1h 24m');
    expect(text).toContain('শেষ হয়েছে: 24 Nov 2026, 15:42 (ঢাকা)');
    expect(text).not.toContain('চিহ্ন দিয়েছেন');
  });

  it('omits time taken when work was never started', () => {
    expect(formatTimeTaken(null, doneAt)).toBeNull();
    expect(designDoneMessage({ ...facts, startedAt: null })).not.toContain(
      'সময় লেগেছে',
    );
  });

  it('says who marked it when that is not the designer', () => {
    const text = designDoneMessage({ ...facts, markedByName: 'Owner' });
    expect(text).toContain('ডিজাইনার: Karim Hossain');
    expect(text).toContain('চিহ্ন দিয়েছেন: Owner');
  });

  it('undo note is not a second done alert', () => {
    const text = designUndoneMessage({
      ...facts,
      at: new Date('2026-11-24T09:50:00.000Z'),
    });
    expect(text).toContain('↩️ ডিজাইন আবার খোলা');
    expect(text).toContain('খোলা হয়েছে: 24 Nov 2026, 15:50 (ঢাকা)');
    expect(text).not.toContain('ডিজাইন শেষ');
  });
});

describe('designDoneTelegramEnabled', () => {
  it('defaults on, and a stored setting wins over env', () => {
    expect(designDoneTelegramEnabled(undefined, null)).toBe(true);
    expect(designDoneTelegramEnabled('', undefined)).toBe(true);
    expect(designDoneTelegramEnabled('false', null)).toBe(false);
    expect(designDoneTelegramEnabled('false', { enabled: true })).toBe(true);
    expect(designDoneTelegramEnabled('true', { enabled: false })).toBe(false);
    expect(designDoneTelegramEnabled('false', { enabled: 'no' })).toBe(false);
  });
});

describe('telegramRetryWaitMs', () => {
  it('waits retry_after on 429 and ignores other statuses', () => {
    expect(telegramRetryWaitMs(500, '', null)).toBeNull();
    expect(
      telegramRetryWaitMs(
        429,
        JSON.stringify({ parameters: { retry_after: 5 } }),
        null,
      ),
    ).toBe(5_000);
    expect(telegramRetryWaitMs(429, 'not-json', '12')).toBe(12_000);
    expect(
      telegramRetryWaitMs(
        429,
        JSON.stringify({ parameters: { retry_after: 3600 } }),
        null,
      ),
    ).toBe(TELEGRAM_RETRY_AFTER_CAP_MS);
  });
});

interface EventRow {
  id: number;
  action: string;
  recordedAt: Date;
}

function serviceFor(options: {
  events: EventRow[];
  env?: string;
  stored?: unknown;
  send?: (text: string) => Promise<'sent' | 'failed' | 'not_configured'>;
}) {
  const sent: string[] = [];
  const prisma = {
    setting: {
      findUnique: async () =>
        options.stored === undefined ? null : { value: options.stored },
    },
    designTargetEvent: { findMany: async () => options.events },
    designTarget: {
      findUnique: async () => ({
        asin: 'B0TEST1234',
        jobNumber: 1000042,
        startedAt: started,
        completedAt: doneAt,
        assignedTo: { fullName: 'Karim Hossain' },
        completedBy: { fullName: 'Karim Hossain' },
      }),
    },
  };
  const telegram = {
    sendRespectingRetryAfter: async (text: string) => {
      sent.push(text);
      return options.send ? options.send(text) : 'sent';
    },
  };
  const svc = new DesignDoneNoticeService(
    prisma as unknown as PrismaService,
    { get: () => options.env } as unknown as ConfigService,
    telegram as unknown as TelegramChannel,
  );
  return { svc, sent };
}

const completed = [
  { id: 1, action: 'assigned', recordedAt: started },
  { id: 2, action: 'completed', recordedAt: doneAt },
];

describe('DesignDoneNoticeService', () => {
  it('sends one message when the design first becomes done', async () => {
    const { svc, sent } = serviceFor({ events: completed });
    await svc.notify(7);
    await svc.notify(7);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('✅ ডিজাইন শেষ');
    expect(sent[0]).toContain('Karim Hossain');
    expect(sent[0]).toContain('#1000042 · B0TEST1234');
  });

  it('does not send when the latest change is not a completion', async () => {
    const { svc, sent } = serviceFor({
      events: [
        { id: 1, action: 'assigned', recordedAt: started },
        { id: 2, action: 'started', recordedAt: started },
        { id: 3, action: 'updated', recordedAt: doneAt },
      ],
    });
    await svc.notify(7);
    expect(sent).toEqual([]);
  });

  it('sends an undone note once and no second done after redo', async () => {
    const undone = serviceFor({
      events: [
        ...completed,
        {
          id: 3,
          action: 'undone',
          recordedAt: new Date('2026-11-24T09:50:00.000Z'),
        },
      ],
    });
    await undone.svc.notify(7);
    await undone.svc.notify(7);
    expect(undone.sent).toHaveLength(1);
    expect(undone.sent[0]).toContain('ডিজাইন আবার খোলা');
    expect(undone.sent[0]).not.toContain('ডিজাইন শেষ');

    const redo = serviceFor({
      events: [
        ...completed,
        {
          id: 3,
          action: 'undone',
          recordedAt: new Date('2026-11-24T09:50:00.000Z'),
        },
        {
          id: 4,
          action: 'completed',
          recordedAt: new Date('2026-11-24T10:05:00.000Z'),
        },
      ],
    });
    await redo.svc.notify(7);
    expect(redo.sent).toEqual([]);
  });

  it('stays quiet when the flag is off, even on a real completion', async () => {
    const { svc, sent } = serviceFor({ events: completed, env: 'false' });
    await svc.notify(7);
    expect(sent).toEqual([]);
  });

  it('does not reject the save path when Telegram throws', async () => {
    const { svc } = serviceFor({
      events: completed,
      send: async () => {
        throw new Error('socket hang up');
      },
    });
    await expect(svc.notify(7)).resolves.toBeUndefined();
  });
});
