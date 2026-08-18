import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  b2Verdict,
  keyHint,
  offsiteView,
  resolveOffsite,
  OFFSITE_SETTING_KEY,
} from '../src/ops/offsite.settings';
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
 * **R5 — অফসাইট ব্যাকআপের কনফিগ, পর্দা থেকে।**
 *
 * ⚠️⚠️ এই ফাইলের সবচেয়ে জরুরি কাজ একটাই: **application key যেন কোনোভাবেই
 * ব্রাউজারে ফেরত না যায়**। বাকি সব ভুল সারানো যায়; ফাঁস হওয়া কী সারানো
 * যায় না।
 */

const KEY_ID = '005c1fee02c86c20000000002';
const APP_KEY = 'K005abcdefghijklmnopqrstuvwxyz1';

let h: Harness;
let owner: Session;

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

const save = (body: Record<string, string>) =>
  owner.http
    .patch('/api/v1/settings/offsite')
    .set('X-CSRF-Token', owner.csrf)
    .send(body);

// ════════════════════════════════════════════════════════════════════════════
// খাঁটি নিয়ম
// ════════════════════════════════════════════════════════════════════════════

describe('keyHint — কতটুকু দেখানো নিরাপদ', () => {
  it('শেষ চার অক্ষর', () => {
    expect(keyHint(APP_KEY)).toBe(`…${APP_KEY.slice(-4)}`);
  });

  /** ⚠️ খুব ছোট মান — অংশ দেখিয়ে লাভ নেই, পুরোটা দেখানোর ঝুঁকি আছে */
  it('চার অক্ষরের কম হলে কিছুই নয়', () => {
    expect(keyHint('abc')).toBeNull();
    expect(keyHint('   ')).toBeNull();
  });
});

describe('resolveOffsite — কোনটা খাটবে', () => {
  const full = { keyId: 'a', appKey: 'b', bucket: 'c' };

  it('তিনটে ঘরই ভরা থাকলে ডাটাবেস জেতে', () => {
    const r = resolveOffsite(full, { keyId: 'x', appKey: 'y', bucket: 'z' });
    expect(r.source).toBe('database');
    expect(r.settings?.keyId).toBe('a');
  });

  /**
   * ⚠️⚠️ সবচেয়ে জরুরি নিয়ম: **আধা-ভরা ডাটাবেস যেন কাজ করা কনফিগ ভাঙতে
   * না পারে**। নইলে পর্দায় একটা ঘর ভরে সেভ চাপলেই অফসাইট চুপচাপ বন্ধ।
   */
  it('ডাটাবেসের একটা ঘর খালি থাকলে সার্ভারেরটাই খাটে', () => {
    const r = resolveOffsite(
      { keyId: 'a', appKey: '', bucket: 'c' },
      { keyId: 'x', appKey: 'y', bucket: 'z' },
    );
    expect(r.source).toBe('env');
    expect(r.settings?.keyId).toBe('x');
  });

  it('কোথাওই পুরো সেট না থাকলে none', () => {
    expect(resolveOffsite(null, {}).source).toBe('none');
    expect(resolveOffsite({ keyId: 'a' }, { bucket: 'z' }).source).toBe('none');
  });
});

describe('b2Verdict — B2-র উত্তর পড়া', () => {
  it('৪০১ মানে key ভুল, আর করণীয়ও বলা থাকে', () => {
    const v = b2Verdict({ status: 401 }, 'oxeio-backups');
    expect(v.ok).toBe(false);
    expect(v.message).toContain('shown only once');
  });

  it('২০০ + একই bucket = ঠিক আছে', () => {
    const v = b2Verdict(
      { status: 200, allowed: { bucketName: 'oxeio-backups' } },
      'oxeio-backups',
    );
    expect(v.ok).toBe(true);
    expect(v.boundTo).toBe('oxeio-backups');
  });

  /**
   * ⭐⭐ key ঠিক, কিন্তু **অন্য bucket-এ বাঁধা** — নীরব ব্যর্থতার চমৎকার
   * উৎস: সব সবুজ দেখাত, আর ব্যাকআপ যেত অন্য কোথাও (বা কোথাওই না)।
   */
  it('অন্য bucket-এ বাঁধা key ধরা পড়ে', () => {
    const v = b2Verdict(
      { status: 200, allowed: { bucketName: 'someone-else' } },
      'oxeio-backups',
    );
    expect(v.ok).toBe(false);
    expect(v.message).toContain('someone-else');
  });

  it('সীমাবদ্ধ না হলেও চলে', () => {
    expect(b2Verdict({ status: 200, allowed: {} }, 'oxeio-backups').ok).toBe(true);
  });

  it('অন্য কোনো এররে B2-র বার্তাই দেখানো হয়', () => {
    const v = b2Verdict({ status: 503, message: 'service unavailable' }, 'b');
    expect(v.ok).toBe(false);
    expect(v.message).toContain('service unavailable');
  });
});

describe('offsiteView — পর্দায় যা যায়', () => {
  /** ⚠️⚠️ গোটা ফাইলের সবচেয়ে জরুরি টেস্ট */
  it('পুরো application key কখনো ভিউতে থাকে না', () => {
    const view = offsiteView(
      resolveOffsite({ keyId: KEY_ID, appKey: APP_KEY, bucket: 'b' }, {}),
    );
    expect(JSON.stringify(view)).not.toContain(APP_KEY);
    expect(view.keyHint).toBe(`…${APP_KEY.slice(-4)}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HTTP
// ════════════════════════════════════════════════════════════════════════════

describe('GET/PATCH /settings/offsite', () => {
  it('কিছু বসানো না থাকলে none', async () => {
    const res = await owner.http.get('/api/v1/settings/offsite').expect(200);
    expect(res.body.source).toBe('none');
    expect(res.body.configured).toBe(false);
  });

  it('বসানো যায়, আর ফেরত আসে কেবল ইঙ্গিত', async () => {
    const res = await save({
      keyId: KEY_ID,
      appKey: APP_KEY,
      bucket: 'oxeio-backups',
    }).expect(200);

    expect(res.body.configured).toBe(true);
    expect(res.body.source).toBe('database');
    expect(res.body.bucket).toBe('oxeio-backups');
    expect(res.body.keyId).toBe(KEY_ID);
    // ⚠️⚠️ কী নিজে কখনো নয়
    expect(JSON.stringify(res.body)).not.toContain(APP_KEY);
  });

  /**
   * ⭐⭐ **B2 application key একবারই দেখায়** — তাই bucket-এর নাম শুধরাতে
   * গিয়ে সেটা মুছে গেলে মালিককে নতুন key বানাতে হতো। খালি ঘর মানে
   * "আগেরটাই থাক"।
   */
  it('bucket বদলাতে গিয়ে key মুছে যায় না', async () => {
    await save({ keyId: KEY_ID, appKey: APP_KEY, bucket: 'first' }).expect(200);

    const res = await save({ keyId: '', appKey: '', bucket: 'second' }).expect(200);

    expect(res.body.configured).toBe(true);
    expect(res.body.bucket).toBe('second');
    expect(res.body.keyId).toBe(KEY_ID);
    expect(res.body.keyHint).toBe(`…${APP_KEY.slice(-4)}`);
  });

  /** ⭐ পুরোপুরি মুছতে হলে তিনটে ঘরই খালি */
  it('তিনটে ঘরই খালি রাখলে মুছে যায়', async () => {
    await save({ keyId: KEY_ID, appKey: APP_KEY, bucket: 'b' }).expect(200);

    const res = await save({ keyId: '', appKey: '', bucket: '' }).expect(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.source).toBe('none');
  });

  /** ⚠️⚠️ audit log ম্যানেজারও দেখেন — গোপন মান ওখানে বসলে আর মোছা যায় না */
  it('audit-এ কী যায় না, শুধু "বসানো হয়েছে কি না"', async () => {
    await save({ keyId: KEY_ID, appKey: APP_KEY, bucket: 'b' }).expect(200);

    const row = await h.prisma.auditLog.findFirstOrThrow({
      where: { targetId: OFFSITE_SETTING_KEY },
    });
    expect(JSON.stringify(row.meta)).not.toContain(APP_KEY);
    expect((row.meta as Record<string, unknown>).keySet).toBe(true);
  });

  it('ম্যানেজার পারেন না', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    await manager.http.get('/api/v1/settings/offsite').expect(403);
    await manager.http
      .patch('/api/v1/settings/offsite')
      .set('X-CSRF-Token', manager.csrf)
      .send({ keyId: 'x', appKey: 'y', bucket: 'z' })
      .expect(403);
  });

  /** ⚠️ কিছু বসানো না থাকলে পরীক্ষা চালানোর মানে নেই — কিন্তু ৫০০ও নয় */
  it('কনফিগ ছাড়া test চালালে ভদ্র উত্তর', async () => {
    const res = await owner.http
      .post('/api/v1/settings/offsite/test')
      .set('X-CSRF-Token', owner.csrf)
      .expect(201);

    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain('Nothing to test');
  });
});
