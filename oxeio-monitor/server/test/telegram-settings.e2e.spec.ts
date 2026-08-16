import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TELEGRAM_SETTING_KEY } from '../src/alerts/telegram.settings';
import {
  createHarness,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
} from './setup/harness';

/**
 * **G08 — টেলিগ্রামের কনফিগ পর্দা থেকে।**
 *
 * ⚠️⚠️ এই ফাইলের সবচেয়ে জরুরি দাবিটা নিরাপত্তার: **বট টোকেন কখনো
 * রেসপন্সে যাবে না**। গেলে সেটা DevTools, প্রক্সি লগ বা স্ক্রিন শেয়ারে
 * দেখা যেত, আর যে কেউ ওই বট দিয়ে বার্তা পাঠাতে পারত।
 */
let h: Harness;
let owner: Session;

const TOKEN = '123456789:AAHfakeTOKENforTESTS4821';

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
});

const read = () => owner.http.get('/api/v1/settings/telegram');

const save = (botToken: string, chatId: string) =>
  owner.http
    .patch('/api/v1/settings/telegram')
    .set('X-CSRF-Token', owner.csrf)
    .send({ botToken, chatId });

describe('GET /settings/telegram', () => {
  it('কিছু বসানো না থাকলে none', async () => {
    const res = await read().expect(200);

    expect(res.body.source).toBe('none');
    expect(res.body.configured).toBe(false);
    expect(res.body.tokenHint).toBeNull();
  });

  /** ⚠️ ম্যানেজার নয় — ওই চ্যাটে কর্মীর নাম ও ঘণ্টা যায় */
  it('ম্যানেজার দেখতে পান না', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    await manager.http.get('/api/v1/settings/telegram').expect(403);
  });
});

describe('PATCH /settings/telegram', () => {
  it('বসানো যায়, আর ডাটাবেসই জেতে', async () => {
    const res = await save(TOKEN, '-100999').expect(200);

    expect(res.body.source).toBe('database');
    expect(res.body.configured).toBe(true);
    expect(res.body.chatId).toBe('-100999');
  });

  /**
   * ⭐⭐⭐ **এই ফাইলের মূল টেস্ট।** পুরো টোকেন কোনো রেসপন্সেই থাকবে না —
   * না সেভ করার উত্তরে, না পড়ার উত্তরে।
   */
  it('পুরো টোকেন কোনো রেসপন্সে যায় না', async () => {
    const saved = await save(TOKEN, '55').expect(200);
    const fetched = await read().expect(200);

    expect(JSON.stringify(saved.body)).not.toContain(TOKEN);
    expect(JSON.stringify(fetched.body)).not.toContain(TOKEN);
    expect(JSON.stringify(fetched.body)).not.toContain('AAHfake');
  });

  /** ⭐ শুধু শেষ চার অক্ষর — মালিক যেন মিলিয়ে নিতে পারেন কোনটা বসানো */
  it('শেষ চার অক্ষরের ইঙ্গিত যায়', async () => {
    const res = await save(TOKEN, '55').expect(200);

    expect(res.body.tokenHint).toBe('…4821');
  });

  /**
   * ⚠️⚠️ **টোকেন audit log-এও যায় না।** audit log মালিক ও ম্যানেজার
   * দুজনেই দেখেন, আর গোপন মান একবার ওখানে বসলে আর মোছা যায় না।
   */
  it('audit log-এ টোকেন লেখা হয় না', async () => {
    await save(TOKEN, '55').expect(200);

    const rows = await h.prisma.auditLog.findMany({
      where: { targetId: TELEGRAM_SETTING_KEY },
    });

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].meta)).not.toContain(TOKEN);
    expect(rows[0].meta).toMatchObject({ op: 'telegram', tokenSet: true });
  });

  /** ⚠️ খালি পাঠানো বৈধ — মানে "মুছে দাও", নইলে ভুল টোকেন সরানোর পথ থাকত না */
  it('খালি পাঠিয়ে মুছে ফেলা যায়', async () => {
    await save(TOKEN, '55').expect(200);

    const res = await save('', '').expect(200);

    expect(res.body.source).toBe('none');
  });

  /**
   * ⚠️⚠️ একটা ঘর ভরা আর একটা খালি রাখলে ডাটাবেসেরটা **জেতে না** — নইলে
   * পর্দা দিয়ে টেলিগ্রাম নীরবে ভাঙানো যেত।
   */
  it('আধা-ভরা কনফিগ কার্যকর হয় না', async () => {
    const res = await save(TOKEN, '').expect(200);

    expect(res.body.configured).toBe(false);
    expect(res.body.source).toBe('none');
  });

  it('ম্যানেজার বসাতে পারেন না', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    await manager.http
      .patch('/api/v1/settings/telegram')
      .set('X-CSRF-Token', manager.csrf)
      .send({ botToken: TOKEN, chatId: '5' })
      .expect(403);
  });

  it('অতি লম্বা টোকেন ৪০০', async () => {
    await save('x'.repeat(300), '5').expect(400);
  });

  /** ⭐ দুবার বসালে সারি একটাই — upsert */
  it('আবার বসালে নতুনটাই থাকে', async () => {
    await save(TOKEN, '11').expect(200);
    const res = await save('987654321:BBsecondTOKEN9999', '22').expect(200);

    expect(res.body.tokenHint).toBe('…9999');
    expect(res.body.chatId).toBe('22');

    const rows = await h.prisma.setting.findMany({
      where: { key: TELEGRAM_SETTING_KEY },
    });
    expect(rows).toHaveLength(1);
  });
});
