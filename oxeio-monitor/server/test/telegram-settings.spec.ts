import { describe, expect, it } from 'vitest';

import {
  resolveTelegram,
  telegramView,
  tokenHint,
} from '../src/alerts/telegram.settings';

/**
 * টেলিগ্রামের সেটিং — ডাটাবেস বনাম `.env`, আর পর্দায় কী যায়।
 *
 * ⚠️⚠️ এই ফাইলের সবচেয়ে জরুরি দাবিটা নিরাপত্তার: **বট টোকেন কখনো
 * ব্রাউজারে যাবে না**। গেলে সেটা DevTools, প্রক্সি লগ বা স্ক্রিন শেয়ারে
 * দেখা যেত, আর যে কেউ ওই বট দিয়ে বার্তা পাঠাতে পারত।
 */
describe('tokenHint', () => {
  it('শেষ চার অক্ষর', () => {
    expect(tokenHint('123456789:ABCdefGHIjklMNO4821')).toBe('…4821');
  });

  /** ⚠️ খুব ছোট মানে ভুল বসানো বা পরীক্ষার মান — অংশ দেখিয়ে লাভ নেই */
  it('চার অক্ষরের কম হলে কিছুই নয়', () => {
    expect(tokenHint('abc')).toBeNull();
    expect(tokenHint('')).toBeNull();
  });

  it('ফাঁকা জায়গা ছেঁকে নেয়', () => {
    expect(tokenHint('  ...9999  ')).toBe('…9999');
  });
});

describe('resolveTelegram', () => {
  const env = { botToken: 'env-token-1111', chatId: '111' };
  const db = { botToken: 'db-token-2222', chatId: '222' };

  it('দুটোই ভরা থাকলে ডাটাবেস জেতে', () => {
    const r = resolveTelegram(db, env);

    expect(r.source).toBe('database');
    expect(r.settings?.chatId).toBe('222');
  });

  it('ডাটাবেস খালি হলে .env', () => {
    const r = resolveTelegram(null, env);

    expect(r.source).toBe('env');
    expect(r.settings?.chatId).toBe('111');
  });

  /**
   * ⭐⭐ **এই ফাইলের মূল টেস্ট।** ডাটাবেসে একটা ঘর ভরা আর একটা খালি —
   * তখন `.env`-এর কাজ করা মানটাই খাটবে।
   *
   * ⚠️ নইলে পর্দায় অর্ধেক বসিয়ে সেভ করলে টেলিগ্রাম চুপচাপ বন্ধ হয়ে যেত,
   * অথচ `.env`-এ কাজ করা মান বসেই আছে — অর্থাৎ পর্দা দিয়ে জিনিসটা
   * **ভাঙানো** যেত।
   */
  it('ডাটাবেসে আধা-ভরা হলে .env-ই খাটে', () => {
    expect(resolveTelegram({ botToken: 'x', chatId: '' }, env).source).toBe('env');
    expect(resolveTelegram({ botToken: '', chatId: '9' }, env).source).toBe('env');
  });

  it('কোথাও কিছু না থাকলে none', () => {
    const r = resolveTelegram(null, {});

    expect(r.source).toBe('none');
    expect(r.settings).toBeNull();
  });

  it('শুধু ফাঁকা জায়গা মানে খালি', () => {
    expect(resolveTelegram({ botToken: '  ', chatId: '  ' }, {}).source).toBe('none');
  });

  it('ফাঁকা জায়গা ছেঁকে নেওয়া হয়', () => {
    const r = resolveTelegram({ botToken: '  t  ', chatId: '  9  ' }, {});

    expect(r.settings).toEqual({ botToken: 't', chatId: '9' });
  });
});

describe('telegramView', () => {
  /**
   * ⚠️⚠️ **সবচেয়ে জরুরি দাবি — টোকেন কোনোভাবেই বেরোয় না।**
   */
  it('পুরো টোকেন কখনো যায় না', () => {
    const view = telegramView(
      resolveTelegram({ botToken: 'super-secret-4821', chatId: '55' }, {}),
    );

    expect(JSON.stringify(view)).not.toContain('super-secret');
    expect(view.tokenHint).toBe('…4821');
  });

  /** ⭐ চ্যাট আইডি গোপন নয় — ওটা দিয়ে কিছু করা যায় না, তাই পুরোটাই যায় */
  it('চ্যাট আইডি পুরোটাই যায়', () => {
    const view = telegramView(resolveTelegram({ botToken: 'tok1', chatId: '-100999' }, {}));

    expect(view.chatId).toBe('-100999');
  });

  /**
   * ⚠️ কোনটা খাটছে সেটা না জানালে মালিক পর্দায় নতুন মান বসিয়ে ভাবতেন
   * সেভ হয়নি — অথচ হয়েছে, শুধু `.env`-এরটা জিতছে না।
   */
  it('উৎস কোনটা সেটাও যায়', () => {
    expect(telegramView(resolveTelegram(null, { botToken: 'a', chatId: 'b' })).source).toBe(
      'env',
    );
  });

  it('কিছু না থাকলে configured মিথ্যা', () => {
    const view = telegramView(resolveTelegram(null, {}));

    expect(view.configured).toBe(false);
    expect(view.tokenHint).toBeNull();
    expect(view.chatId).toBe('');
  });
});
