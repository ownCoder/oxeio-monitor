import { describe, expect, it } from 'vitest';

import type { Digest, DigestRow } from '../src/digest/digest.math';
import {
  asPreBlock,
  escapeHtml,
  hm,
  telegramDigest,
} from '../src/digest/digest.telegram';

/**
 * **দৈনিক রিপোর্ট, টেলিগ্রামের চেহারা** *(১৮ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ এই ফাইলের সবচেয়ে জরুরি টেস্ট দুটো: **কেউ যেন নীরবে বাদ না পড়ে**
 * (সংখ্যা না মিললে সেটা দেখতে "এজেন্ট ভাঙা"-র মতো লাগে), আর **ঘণ্টা ধরে
 * সাজানো নয়** — নইলে বার্তাটা রোজ সন্ধ্যায় একটা লিডারবোর্ড হয়ে উঠত।
 */

const EXTRAS = { silentPcs: 0, atTime: '18:30' };

function row(over: Partial<DigestRow> = {}): DigestRow {
  return {
    employeeId: 1,
    empCode: 'OX-01',
    fullName: 'One',
    todayHours: 8,
    todayTargetHours: 8,
    offToday: false,
    idleToday: false,
    monthHours: 100,
    expectedHours: 100,
    paceHours: 0,
    behind: false,
    ...over,
  };
}

function digestOf(rows: DigestRow[], over: Partial<Digest> = {}): Digest {
  return {
    workDate: '2026-08-18',
    monthFrom: '2026-08-01',
    monthTo: '2026-08-18',
    rows,
    behind: rows.filter((r) => r.behind),
    idle: rows.filter((r) => r.idleToday),
    totals: {
      employees: rows.length,
      workedToday: rows.filter((r) => r.todayHours > 0).length,
      hoursToday: rows.reduce((sum, r) => sum + r.todayHours, 0),
    },
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════

describe('hm — ঘণ্টা-মিনিট', () => {
  /** ⚠️ দশমিক ঘণ্টা কেউ ফোনে দেখে মিনিটে রূপান্তর করেন না */
  it('দশমিক ঘণ্টা মিনিটে', () => {
    expect(hm(7.02)).toBe('7h 01m');
    expect(hm(8)).toBe('8h 00m');
    expect(hm(0)).toBe('0h 00m');
  });

  /** ⚠️ চিহ্নটা কলার বসায় (− না +), তাই এখানে সবসময় ধনাত্মক */
  it('ঋণাত্মক মান পরম হিসেবে', () => {
    expect(hm(-2.5)).toBe('2h 30m');
  });

  it('৬০ মিনিটে গোল হলে ঘণ্টায় ওঠে', () => {
    expect(hm(7.999)).toBe('8h 00m');
  });
});

describe('escapeHtml', () => {
  /**
   * ⚠️⚠️ বার্তাটা `parse_mode: HTML`-এ যায়। নামে একটা `&` বা `<` থাকলে
   * Telegram গোটা কলটাই ৪০০ করত — অর্থাৎ **সেদিনের রিপোর্টই যেত না**।
   */
  it('তিনটে বিপজ্জনক অক্ষর', () => {
    expect(escapeHtml('Ali & <b>Co</b>')).toBe(
      'Ali &amp; &lt;b&gt;Co&lt;/b&gt;',
    );
  });

  it('মোড়কের ভেতরে escape হয়ে বসে', () => {
    expect(asPreBlock('a & b')).toBe('<pre>a &amp; b</pre>');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('telegramDigest', () => {
  /**
   * ⚠️⚠️ **সবচেয়ে জরুরি টেস্ট — কেউ যেন হারিয়ে না যায়।** উপরে "১৩ জন"
   * লেখা থাকলে নিচে তেরোটা নামই থাকতে হবে, ছুটির লোকজন সহ। না থাকলে
   * ফাঁকটা দেখতে হুবহু "এজেন্ট কাজ করছে না"-র মতো লাগত।
   */
  it('প্রত্যেকের নাম কোনো না কোনো দলে থাকে', () => {
    const rows = [
      row({ empCode: 'OX-01', fullName: 'Met', todayHours: 8 }),
      row({ empCode: 'OX-02', fullName: 'Under', todayHours: 5 }),
      row({ empCode: 'OX-03', fullName: 'Nothing', todayHours: 0, idleToday: true }),
      row({ empCode: 'OX-04', fullName: 'Resting', offToday: true, todayHours: 0, todayTargetHours: 0 }),
    ];

    const text = telegramDigest(digestOf(rows), 'oXeio', EXTRAS);

    for (const r of rows) expect(text).toContain(r.fullName);
    expect(text).toContain('4 worked');
  });

  it('টার্গেট ছোঁয়া আর না-ছোঁয়া আলাদা দলে', () => {
    const text = telegramDigest(
      digestOf([
        row({ fullName: 'Met', todayHours: 8.5 }),
        row({ fullName: 'Short', todayHours: 6 }),
      ]),
      'oXeio',
      EXTRAS,
    );

    expect(text).toContain('MET THE TARGET · 1');
    expect(text).toContain('UNDER TARGET · 1');
    // ⭐ ঘাটতিটা লেখা থাকে, নইলে পাঠককে মাথায় বিয়োগ করতে হতো
    expect(text).toContain('−2h 00m');
  });

  /**
   * ⚠️⚠️ **ঠিক টার্গেটে থাকা মানে ছুঁয়েছেন।** `>` লিখলে যিনি কাঁটায়
   * কাঁটায় ৮ ঘণ্টা করেছেন তিনি রোজ "পিছিয়ে" তালিকায় পড়তেন — আর সেটা
   * এমন একটা ভুল যেটা মানুষ ব্যক্তিগতভাবে নেয়।
   */
  it('কাঁটায় কাঁটায় টার্গেট = ছুঁয়েছেন', () => {
    const text = telegramDigest(
      digestOf([row({ fullName: 'Exact', todayHours: 8, todayTargetHours: 8 })]),
      'oXeio',
      EXTRAS,
    );

    expect(text).toContain('MET THE TARGET · 1');
    expect(text).not.toContain('UNDER TARGET');
  });

  /** ⚠️ খালি দল দেখানো হয় না — রোজ চারটে খালি শিরোনাম আবার সেই দেয়াল */
  it('খালি দলের শিরোনাম বসে না', () => {
    const text = telegramDigest(
      digestOf([row({ fullName: 'Met', todayHours: 8 })]),
      'oXeio',
      EXTRAS,
    );

    expect(text).not.toContain('NO WORK TODAY');
    expect(text).not.toContain('OFF TODAY');
    expect(text).not.toContain('BEHIND');
  });

  /**
   * ⚠️⚠️ **ক্রম কখনো ঘণ্টা ধরে নয়** — `Digest.rows` কর্মী-কোডের ক্রমে
   * আসে, আর সেটাই অক্ষত থাকে। ঘণ্টার ক্রমে সাজালে বার্তাটা রোজ সন্ধ্যায়
   * একটা **লিডারবোর্ড** হয়ে উঠত (README-র "কখনোই নয়")।
   */
  it('দলের ভেতরে ক্রম কর্মী-কোড ধরে, ঘণ্টা ধরে নয়', () => {
    const text = telegramDigest(
      digestOf([
        row({ empCode: 'OX-01', fullName: 'Alpha', todayHours: 2 }),
        row({ empCode: 'OX-02', fullName: 'Bravo', todayHours: 7 }),
        row({ empCode: 'OX-03', fullName: 'Charlie', todayHours: 4 }),
      ]),
      'oXeio',
      EXTRAS,
    );

    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Bravo'));
    expect(text.indexOf('Bravo')).toBeLessThan(text.indexOf('Charlie'));
  });

  it('মাসে পিছিয়ে থাকলে গোনা ও প্রত্যাশা দুটোই লেখা', () => {
    const text = telegramDigest(
      digestOf([
        row({
          fullName: 'Behind',
          todayHours: 8,
          behind: true,
          paceHours: -12.5,
          monthHours: 96,
          expectedHours: 108.5,
        }),
      ]),
      'oXeio',
      EXTRAS,
    );

    expect(text).toContain('BEHIND FOR THE MONTH · 1');
    expect(text).toContain('−12h 30m');
    expect(text).toContain('96h 00m of 108h 30m');
    // ⚠️ ব্যাখ্যাটা ছাড়া সংখ্যাটা ভুল বোঝা যায়
    expect(text).toContain("excludes today's target");
  });

  /**
   * ⭐ `agent_down`-এর গোটা টেলিগ্রাম উপস্থিতি এই এক লাইন — আগে দিনে
   * ৩৯টা আলাদা বার্তা যেত।
   */
  it('চুপ থাকা PC এক লাইনে, আর শূন্য হলে লাইনটাই নেই', () => {
    const rows = [row({ fullName: 'A', todayHours: 8 })];

    expect(
      telegramDigest(digestOf(rows), 'oXeio', { ...EXTRAS, silentPcs: 3 }),
    ).toContain('3 PCs went silent');

    expect(
      telegramDigest(digestOf(rows), 'oXeio', { ...EXTRAS, silentPcs: 1 }),
    ).toContain('1 PC went silent');

    expect(telegramDigest(digestOf(rows), 'oXeio', EXTRAS)).not.toContain(
      'silent',
    );
  });

  /**
   * ⚠️ **লাইন ছোট রাখা** — সরু ফোনে ভাঁজ পড়লে কলামগুলোই ভেঙে যেত, আর
   * তখন monospace রাখার পুরো কারণটাই বৃথা।
   */
  it('কোনো লাইন ৪০ অক্ষরের বেশি নয়', () => {
    const text = telegramDigest(
      digestOf([
        row({ fullName: 'Sk Nasif Iqbal Shovon', todayHours: 7.02 }),
        row({ empCode: 'OX-02', fullName: 'Sahariar Ahmed (Ali)', todayHours: 5.62 }),
      ]),
      'oXeio Monitoring',
      { silentPcs: 2, atTime: '18:30' },
    );

    for (const line of text.split('\n')) {
      expect(line.length, line).toBeLessThanOrEqual(40);
    }
  });

  /** ⚠️ কোনো কর্মী না থাকলেও ক্র্যাশ নয় — মাসের শেষে সবাই নিষ্ক্রিয় হতে পারেন */
  it('কেউ না থাকলেও বার্তা তৈরি হয়', () => {
    const text = telegramDigest(digestOf([]), 'oXeio', EXTRAS);
    expect(text).toContain('0 of 0 worked');
  });
});
