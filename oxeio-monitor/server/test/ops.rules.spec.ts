import { describe, expect, it } from 'vitest';

import {
  BACKUP_CRITICAL_DAYS,
  BACKUP_KEEP_MIN,
  BACKUP_STALE_HOURS,
} from '../src/ops/ops.constants';
import {
  backupAlertText,
  backupFileName,
  backupVerdict,
  backupsToDelete,
  healthVerdict,
  isBackupFile,
  isPartFile,
  listBackups,
  orphanSidecars,
  parseBackupName,
  parsePgUrl,
  safeHostname,
  stalePartFiles,
  telegramLine,
  telegramMessage,
  type BackupState,
  type HealthFacts,
} from '../src/ops/ops.rules';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** ঢাকার একটা নির্দিষ্ট মুহূর্ত — UTC+6, কোনো DST নেই */
function dhaka(iso: string): Date {
  return new Date(`${iso}+06:00`);
}

/** `now` থেকে n দিন আগের রাত ২:৩০-এর ব্যাকআপের নাম */
function nightlyName(now: Date, daysAgo: number): string {
  return backupFileName(new Date(now.getTime() - daysAgo * DAY));
}

// ════════════════════════════════════════════════════════════════════════════
// ১. নাম — ঘোরানোর নিয়ম এটার উপরেই দাঁড়ানো
// ════════════════════════════════════════════════════════════════════════════

describe('ব্যাকআপের নাম', () => {
  it('তারিখ ঢাকার সময়ে, UTC-তে নয়', () => {
    // UTC-তে ১০ তারিখ রাত ৮:৩০ = ঢাকায় ১১ তারিখ রাত ২:৩০
    expect(backupFileName(new Date('2026-08-10T20:30:00Z'))).toBe(
      'oxeio-2026-08-11-0230.dump.enc',
    );
  });

  it('একই দিনে দুবার চালালে দুটো আলাদা নাম (ঘণ্টা-মিনিট আছে)', () => {
    const a = backupFileName(dhaka('2026-08-11T02:30:00'));
    const b = backupFileName(dhaka('2026-08-11T14:05:00'));
    expect(a).not.toBe(b);
  });

  it('নাম → সময় → নাম, ঘুরে এসে একই', () => {
    const at = dhaka('2026-08-11T02:30:00');
    const name = backupFileName(at);
    expect(parseBackupName(name)?.getTime()).toBe(at.getTime());
  });

  it('⚠️ অন্য কোনো ফাইল কখনোই ব্যাকআপ বলে গোনা হয় না', () => {
    for (const name of [
      'README-restore.txt',
      'oxeio-2026-08-11-0230.dump.enc.sha256',
      'before-migration.dump',
      'oxeio-2026-08-11.dump.enc',
      'oxeio-2026-08-11-0230.dump',
      'notes.txt',
      '',
    ]) {
      expect(isBackupFile(name), name).toBe(false);
    }
  });

  it('⚠️ আজেবাজে তারিখ (মাস ১৩) regex পেরোলেও বাতিল', () => {
    expect(parseBackupName('oxeio-2026-13-45-0230.dump.enc')).toBeNull();
  });

  it('.part চেনা যায়, আর সেটা ব্যাকআপ নয়', () => {
    const part = 'oxeio-2026-08-11-0230.dump.enc.part';
    expect(isPartFile(part)).toBe(true);
    expect(isBackupFile(part)).toBe(false);
  });

  it('তালিকা নতুন থেকে পুরোনো ক্রমে', () => {
    const now = dhaka('2026-08-11T02:30:00');
    const names = [nightlyName(now, 5), nightlyName(now, 0), nightlyName(now, 2)];
    expect(listBackups(names).map((f) => f.name)).toEqual([
      nightlyName(now, 0),
      nightlyName(now, 2),
      nightlyName(now, 5),
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ২. ⭐ ঘোরানো — ভুল হলে শেষ ভালো কপিটাই যেত
// ════════════════════════════════════════════════════════════════════════════

describe('পুরোনো ব্যাকআপ ঘোরানো', () => {
  const now = dhaka('2026-08-11T03:00:00');

  it('৩০ দিনের চেয়ে পুরোনোগুলো যায়, নতুনগুলো থাকে', () => {
    const names = [0, 5, 29, 31, 60].map((d) => nightlyName(now, d));
    expect(backupsToDelete(names, now, 30)).toEqual([
      nightlyName(now, 31),
      nightlyName(now, 60),
    ]);
  });

  it('⭐ সব পুরোনো হলেও সবচেয়ে নতুন দুটো কখনো মোছে না', () => {
    // ব্যাকআপ ৪০ দিন ধরে ব্যর্থ — সরল বয়স-নিয়ম এখানে ডিস্ক খালি করে দিত
    const names = [40, 50, 60, 70].map((d) => nightlyName(now, d));
    const doomed = backupsToDelete(names, now, 30);

    expect(doomed).toEqual([nightlyName(now, 60), nightlyName(now, 70)]);
    expect(doomed).toHaveLength(names.length - BACKUP_KEEP_MIN);
  });

  it('⚠️ চেনা যায় না এমন ফাইল ছোঁয়াই হয় না', () => {
    const names = [
      'README-restore.txt',
      'before-migration.dump',
      nightlyName(now, 90),
      nightlyName(now, 91),
      nightlyName(now, 92),
    ];
    expect(backupsToDelete(names, now, 30)).toEqual([nightlyName(now, 92)]);
  });

  it('ভবিষ্যতের তারিখ (ঘড়ি পিছিয়ে গেলে) রক্ষা পায়', () => {
    const names = [
      backupFileName(new Date(now.getTime() + 2 * DAY)),
      nightlyName(now, 40),
      nightlyName(now, 41),
    ];
    // ভবিষ্যতেরটা + ৪০ দিনেরটা = keepMin দুটো, বাকি একটা যায়
    expect(backupsToDelete(names, now, 30)).toEqual([nightlyName(now, 41)]);
  });

  it('কিছুই না থাকলে কিছুই মোছে না', () => {
    expect(backupsToDelete([], now, 30)).toEqual([]);
  });

  it('⚠️ অনাথ .sha256 যায়, কিন্তু কারো নিজের রাখা .sha256 নয়', () => {
    const live = nightlyName(now, 1);
    const gone = nightlyName(now, 40);
    const half = nightlyName(now, 0);

    expect(
      orphanSidecars([
        live,
        live + '.sha256', // ব্যাকআপটা আছে — থাকবে
        gone + '.sha256', // ব্যাকআপ নেই — অনাথ
        half + '.sha256', // ব্যাকআপটা এখনো লেখা হচ্ছে (.part) — থাকবে
        half + '.part',
        'notes.sha256', // আমাদের নয় — ছোঁয়া হবে না
      ]),
    ).toEqual([gone + '.sha256']);
  });

  it('⚠️ চলতি .part ফাইল মোছা হয় না, শুধু পড়ে থাকাগুলো', () => {
    const running = {
      name: 'oxeio-2026-08-11-0230.dump.enc.part',
      mtime: new Date(now.getTime() - 60_000),
    };
    const abandoned = {
      name: 'oxeio-2026-08-01-0230.dump.enc.part',
      mtime: new Date(now.getTime() - 20 * HOUR),
    };
    const notOurs = {
      name: 'something.part',
      mtime: new Date(now.getTime() - 20 * HOUR),
    };

    expect(stalePartFiles([running, abandoned, notOurs], now)).toEqual([
      abandoned.name,
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ৩. ⭐ G04 — কখন বলব, আর কখন চুপ থাকব
// ════════════════════════════════════════════════════════════════════════════

const okState = (now: Date): BackupState => ({
  configured: true,
  lastAttemptAt: new Date(now.getTime() - HOUR),
  lastOutcome: 'ok',
  lastSuccessAt: new Date(now.getTime() - HOUR),
  consecutiveFailures: 0,
  lastCopyOutcome: 'ok',
  observedSince: new Date(now.getTime() - 30 * DAY),
});

describe('G04 — ব্যাকআপ অ্যালার্ট', () => {
  const now = dhaka('2026-08-11T09:00:00');

  it('⭐ সফল হলে কিচ্ছু বলে না', () => {
    expect(backupVerdict(okState(now), now)).toBeNull();
  });

  it('BACKUP_PASSPHRASE নেই — সবচেয়ে জোরে বলার মতো অবস্থা', () => {
    const verdict = backupVerdict({ ...okState(now), configured: false }, now);
    expect(verdict?.problem).toBe('not_configured');
    expect(backupAlertText(verdict!).title).toContain('BACKUP_PASSPHRASE');
  });

  it('একরাতের ব্যর্থতা = সতর্কতা', () => {
    const verdict = backupVerdict(
      {
        ...okState(now),
        lastOutcome: 'failed',
        consecutiveFailures: 1,
        lastSuccessAt: new Date(now.getTime() - 30 * HOUR),
      },
      now,
    );
    expect(verdict?.problem).toBe('failed');
    expect(verdict?.severity).toBe('warning');
  });

  it(`⭐ টানা ${BACKUP_CRITICAL_DAYS} দিন ব্যর্থ = গুরুতর`, () => {
    const verdict = backupVerdict(
      {
        ...okState(now),
        lastOutcome: 'failed',
        consecutiveFailures: BACKUP_CRITICAL_DAYS,
        lastSuccessAt: new Date(now.getTime() - 2 * DAY - HOUR),
      },
      now,
    );
    expect(verdict?.severity).toBe('critical');
    expect(verdict?.daysSinceSuccess).toBe(2);
  });

  it('শেষ চেষ্টা সফল, কিন্তু অনেক আগে — জবটা আর চলছেই না', () => {
    const verdict = backupVerdict(
      {
        ...okState(now),
        lastAttemptAt: new Date(now.getTime() - 40 * HOUR),
        lastSuccessAt: new Date(now.getTime() - 40 * HOUR),
      },
      now,
    );
    expect(verdict?.problem).toBe('stale');
  });

  it(`⚠️ ${BACKUP_STALE_HOURS} ঘণ্টার ভেতরের সফল ব্যাকআপ বাসি নয়`, () => {
    const fresh = new Date(now.getTime() - (BACKUP_STALE_HOURS - 1) * HOUR);
    expect(
      backupVerdict({ ...okState(now), lastAttemptAt: fresh, lastSuccessAt: fresh }, now),
    ).toBeNull();
  });

  it('⚠️ সদ্য চালু হওয়া সার্ভার প্রথম মিনিটেই চেঁচায় না', () => {
    const fresh: BackupState = {
      configured: true,
      lastAttemptAt: null,
      lastOutcome: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      lastCopyOutcome: null,
      observedSince: new Date(now.getTime() - 10 * 60_000),
    };
    expect(backupVerdict(fresh, now)).toBeNull();
  });

  it('কিন্তু দুদিন পেরিয়ে গেলেও একটাও ব্যাকআপ না হলে গুরুতর', () => {
    const never: BackupState = {
      configured: true,
      lastAttemptAt: null,
      lastOutcome: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      lastCopyOutcome: null,
      observedSince: new Date(now.getTime() - 3 * DAY),
    };
    const verdict = backupVerdict(never, now);
    expect(verdict?.problem).toBe('never');
    expect(verdict?.severity).toBe('critical');
  });

  it('⭐ ডাম্প ঠিক আছে কিন্তু এক্সটার্নাল ড্রাইভে যায়নি — এটাও ব্যর্থতা', () => {
    const verdict = backupVerdict(
      { ...okState(now), lastCopyOutcome: 'failed' },
      now,
    );
    expect(verdict?.problem).toBe('copy_failed');
    expect(verdict?.severity).toBe('warning');
  });

  it('কপি কনফিগারই না করা থাকলে (null) সেটা ব্যর্থতা নয়', () => {
    expect(
      backupVerdict({ ...okState(now), lastCopyOutcome: null }, now),
    ).toBeNull();
  });

  it('⚠️ প্রতিটা problem-এর জন্য শিরোনাম আছে', () => {
    const problems = [
      'not_configured',
      'failed',
      'never',
      'stale',
      'copy_failed',
    ] as const;

    for (const problem of problems) {
      const text = backupAlertText({
        problem,
        severity: 'warning',
        hoursSinceSuccess: 30,
        daysSinceSuccess: 1,
      });
      expect(text.title.length, problem).toBeGreaterThan(0);
      expect(text.detail.length, problem).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ৪. K04 — হেলথ verdict
// ════════════════════════════════════════════════════════════════════════════

const healthy: HealthFacts = {
  dbUp: true,
  diskUsedPct: 42,
  backup: null,
  activeDevices: 15,
  silentDevices: 0,
  pendingAlerts: 0,
};

describe('K04 — হেলথ verdict', () => {
  it('সব ঠিক হলে ok, কোনো সমস্যা নেই', () => {
    expect(healthVerdict(healthy)).toEqual({ status: 'ok', problems: [] });
  });

  it('DB না থাকলে down, আর বাকি কিছু বলার দরকার নেই', () => {
    const verdict = healthVerdict({ ...healthy, dbUp: false, diskUsedPct: 99 });
    expect(verdict.status).toBe('down');
    expect(verdict.problems).toHaveLength(1);
  });

  it('⭐ রাতে সবার PC বন্ধ থাকলেও হেলথ সবুজই থাকে', () => {
    const evening = { ...healthy, silentDevices: 15, activeDevices: 15 };
    expect(healthVerdict(evening).status).toBe('ok');
  });

  it('ডিস্ক ৮০% পেরোলে degraded', () => {
    expect(healthVerdict({ ...healthy, diskUsedPct: 83 }).status).toBe('degraded');
  });

  it('ডিস্কের তথ্য পড়া না গেলেও সেটা একটা সমস্যা', () => {
    const verdict = healthVerdict({ ...healthy, diskUsedPct: null });
    expect(verdict.status).toBe('degraded');
    expect(verdict.problems[0]).toMatch(/disk/i);
  });

  it('ব্যাকআপের verdict থাকলে হেলথেও সেটাই দেখায়', () => {
    const verdict = healthVerdict({
      ...healthy,
      backup: {
        problem: 'stale',
        severity: 'critical',
        hoursSinceSuccess: 70,
        daysSinceSuccess: 2,
      },
    });
    expect(verdict.status).toBe('degraded');
    expect(verdict.problems.join(' ')).toContain('Backup');
  });

  it('অ্যালার্ট জমে গেলে dispatcher আটকে থাকার খবর', () => {
    expect(healthVerdict({ ...healthy, pendingAlerts: 500 }).status).toBe(
      'degraded',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ৫. ⭐ G08 — টেলিগ্রামে কী যাবে (আর কী যাবে না)
// ════════════════════════════════════════════════════════════════════════════

describe('G08 — টেলিগ্রামের বার্তা', () => {
  const now = dhaka('2026-08-11T10:20:00');

  it('টাইপের লেবেল, হোস্টনেম আর কতক্ষণ আগে — এটুকুই', () => {
    const line = telegramLine(
      {
        type: 'agent_down',
        severity: 'warning',
        hostname: 'PC-07',
        createdAt: new Date(now.getTime() - 20 * 60_000),
      },
      now,
    );
    expect(line).toContain('Agent silent');
    expect(line).toContain('PC-07');
    expect(line).toContain('20 min ago');
  });

  it('⭐ কর্মীর নাম, ডোমেইন বা টাকার অঙ্ক পাঠানোর কোনো পথই নেই', () => {
    // ইনপুটে title/detail বলে কিছু নেওয়াই হয় না — allowlist, denylist নয়
    const message = telegramMessage(
      [
        {
          type: 'no_activity_today',
          severity: 'warning',
          hostname: null,
          createdAt: now,
        },
      ],
      now,
    );
    expect(message).not.toContain('facebook');
    expect(message).not.toContain('৳');
    expect(message).toContain('no work all day');
  });

  it('⚠️ হোস্টনেমের বাঁকা অক্ষর ছেঁকে ফেলা হয়', () => {
    expect(safeHostname('PC-07')).toBe('PC-07');
    expect(safeHostname('<b>রহিম</b>-PC')).toBe('bb-PC');
    expect(safeHostname('   ')).toBeNull();
    expect(safeHostname(null)).toBeNull();
    expect(safeHostname('x'.repeat(80))).toHaveLength(32);
  });

  it('অচেনা টাইপেও ভাঙে না', () => {
    const line = telegramLine(
      { type: 'কিছু-একটা', severity: 'info', createdAt: now },
      now,
    );
    expect(line).toContain('Alert');
  });

  it('একাধিক হলে হেডারে সংখ্যা, তারপর প্রতি লাইনে একটা', () => {
    const message = telegramMessage(
      [
        { type: 'agent_down', severity: 'warning', hostname: 'PC-01', createdAt: now },
        { type: 'disk_critical', severity: 'critical', createdAt: now },
      ],
      now,
    );
    expect(message).toContain('2 alerts');
    expect(message.split('\n').filter((l) => l.startsWith('🔴') || l.startsWith('🟡'))).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ৬. DATABASE_URL — pg_dump-এর আর্গুমেন্ট
// ════════════════════════════════════════════════════════════════════════════

describe('DATABASE_URL ভাঙা', () => {
  it('সাধারণ URL', () => {
    expect(parsePgUrl('postgresql://oxeio:secret@db.local:5433/oxeio?schema=public')).toEqual({
      host: 'db.local',
      port: '5433',
      user: 'oxeio',
      password: 'secret',
      database: 'oxeio',
    });
  });

  it('⚠️ percent-encoded পাসওয়ার্ড ডিকোড হয় — নইলে রোজ auth ব্যর্থ হতো', () => {
    expect(parsePgUrl('postgres://us%40er:p%40ss%3Aword@localhost/oxeio')).toMatchObject({
      user: 'us@er',
      password: 'p@ss:word',
    });
  });

  it('পোর্ট না থাকলে ৫৪৩২', () => {
    expect(parsePgUrl('postgres://u:p@localhost/oxeio')?.port).toBe('5432');
  });

  it('আজেবাজে বা অন্য স্কিমের URL-এ null', () => {
    expect(parsePgUrl('mysql://u:p@localhost/x')).toBeNull();
    expect(parsePgUrl('একদম-URL-নয়')).toBeNull();
    expect(parsePgUrl('postgres://u:p@localhost/')).toBeNull();
    expect(parsePgUrl(undefined)).toBeNull();
  });
});
