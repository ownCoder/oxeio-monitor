import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmployeeWithCode,
  createHarness,
  enrollDevice,
  iso,
  realNow,
  resetDatabase,
  type EnrolledDevice,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐⭐ **ঘড়ির ভুল — একটাই অ্যালার্ট, আর সংখ্যাটা বাসি থাকে না**
 * *(৭ সেপ্টেম্বর ২০২৬, G169 · G170)*।
 *
 * ⚠️⚠️ **G169 — যে বাগটা এই ফাইলটা পাহারা দেয়:** `ClockDriftService.record()`
 * ডাকা হয় `DeviceAuthGuard` থেকে, অর্থাৎ **প্রতিটা রিকোয়েস্টে**। চালু
 * হওয়ার মুহূর্তে এজেন্ট একসাথে কয়েকটা কল পাঠায় (সেগমেন্ট · ইভেন্ট ·
 * অ্যাপ-ব্যবহার · ছবি), আর "আগে দেখো, তারপর বসাও"-এ কোনো তালা ছিল না —
 * তাই দুটো কল একসাথে "কিছু নেই" দেখে **দুটো অ্যালার্ট** বানাত।
 *
 * ⚠️ মাঠে ধরা (৭ সেপ্টেম্বর, OX-13): দুটো অভিন্ন *"PC clock is wrong"*,
 * **৯ মিলিসেকেন্ডের ব্যবধানে**, একই `driftSec`। মালিক সেটা দেখেই
 * বলেছিলেন *"ami eta chai na"*।
 *
 * ⚠️⚠️ **G170 —** `last_drift_sec` লিখত কেবল `record()`, আর সে
 * `level === 'none'`-এ শুরুতেই ফিরে যায়। ফলে ঘড়ি ঠিক হয়ে যাওয়ার পরেও
 * পুরোনো বড় সংখ্যাটা **চিরকাল** বসে থাকত। মাঠে OX-13-এর ঘড়ি কয়েক
 * মিনিটেই মিলে গিয়েছিল, তবু ফ্লিট-তালিকা ৫৪,২২৩ সেকেন্ড দেখাচ্ছিল।
 */
let h: Harness;
let device: EnrolledDevice;

/** ⚠️ `DRIFT_ALERT_SEC` ৩০০ — তাই অ্যালার্টের জন্য এর অনেক উপরে */
const BIG_DRIFT_SEC = 15 * 3600;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const { code } = await createEmployeeWithCode(h.prisma);
  device = await enrollDevice(h, code);
});

/**
 * একটা সস্তা authenticated কল — গুরুত্বপূর্ণ অংশটা হলো **হেডার**, কারণ
 * drift মাপা ও লেখা দুটোই guard-এ হয়, কন্ট্রোলারে নয়।
 */
const ping = (driftSec: number) =>
  h
    .http()
    .get('/api/v1/agent/config')
    .set('Authorization', `Bearer ${device.token}`)
    // ⚠️ ঘড়ি **পিছিয়ে** — server − client ধনাত্মক, ঠিক মাঠের কেসটার মতো
    .set('X-Client-Time', iso(new Date(realNow().getTime() - driftSec * 1000)));

const driftAlerts = () =>
  h.prisma.alert.findMany({ where: { type: 'clock_drift' } });

const deviceRow = () =>
  h.prisma.device.findUniqueOrThrow({ where: { id: device.deviceId } });

describe('G169 — একসাথে আসা কলগুলো মিলে একটাই অ্যালার্ট', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের মূল টেস্ট** — বারোটা কল **একসাথে**, ঠিক যেভাবে
   * এজেন্ট চালু হওয়ার মুহূর্তে পাঠায়।
   *
   * ⚠️ তালা তুলে নিলে এটা লাল হয়: একাধিক অ্যালার্ট তৈরি হয়।
   */
  it('⭐ বারোটা সমান্তরাল কলেও অ্যালার্ট একটাই', async () => {
    await Promise.all(
      Array.from({ length: 12 }, () => ping(BIG_DRIFT_SEC).expect(200)),
    );

    expect(await driftAlerts()).toHaveLength(1);
  });

  /** ⚠️ পরপর কলেও একটাই — ৬ ঘণ্টার throttle আগের মতোই কাজ করে */
  it('পরপর কলেও একটাই', async () => {
    await ping(BIG_DRIFT_SEC).expect(200);
    await ping(BIG_DRIFT_SEC).expect(200);
    await ping(BIG_DRIFT_SEC).expect(200);

    expect(await driftAlerts()).toHaveLength(1);
  });

  /**
   * ⚠️⚠️ **দুই PC একে অন্যকে আটকায় না** — তালাটা `deviceId` ধরে, তাই
   * দুজনের দুটো অ্যালার্টই বসতে হবে। তালাটা গোটা টেবিলের উপর হলে
   * দ্বিতীয় PC-র খবরটা নীরবে চাপা পড়ত।
   */
  it('⭐ আলাদা দুটো PC-র জন্য আলাদা দুটো অ্যালার্ট', async () => {
    const { code } = await createEmployeeWithCode(h.prisma, 'OX-CD2');
    const other = await enrollDevice(h, code, {
      hostname: 'PC-CD2',
      windowsUsername: 'cd2',
      machineGuid: 'guid-test-cd2',
    });

    const stale = iso(new Date(realNow().getTime() - BIG_DRIFT_SEC * 1000));

    await Promise.all([
      ping(BIG_DRIFT_SEC).expect(200),
      h
        .http()
        .get('/api/v1/agent/config')
        .set('Authorization', `Bearer ${other.token}`)
        .set('X-Client-Time', stale)
        .expect(200),
    ]);

    expect(await driftAlerts()).toHaveLength(2);
  });

  /** ⚠️ ঘড়ি ঠিক থাকলে কোনো অ্যালার্টই নয় — নিরাপত্তা-জাল */
  it('ঘড়ি ঠিক থাকলে অ্যালার্ট নেই', async () => {
    await ping(0).expect(200);

    expect(await driftAlerts()).toHaveLength(0);
  });
});

describe('G170 — ঘড়ি ঠিক হলে সংখ্যাটাও ঠিক হয়', () => {
  /**
   * ⭐⭐⭐ **এই ব্লকের মূল টেস্ট।** আগে `last_drift_sec` একবার বসলে আর
   * নামত না — কারণ `record()` `level === 'none'`-এ শুরুতেই ফিরে যায়।
   */
  it('⭐ ঘড়ি মিলে গেলে last_drift_sec শূন্যে ফেরে', async () => {
    await ping(BIG_DRIFT_SEC).expect(200);
    expect((await deviceRow()).lastDriftSec).toBe(BIG_DRIFT_SEC);

    // ⚠️ এখন Windows ঘড়িটা মিলিয়ে নিল
    await ping(0).expect(200);

    expect((await deviceRow()).lastDriftSec).toBe(0);
  });

  /**
   * ⚠️⚠️ **`max_drift_sec` কমে না** — ওটার প্রশ্নই আলাদা: *"সবচেয়ে খারাপ
   * কতটা হয়েছিল"*। ঘড়ি ঠিক হয়ে গেলে ইতিহাসটা মুছে ফেলা চলবে না, নইলে
   * বারবার ঘড়ি নড়া একটা PC চিরকাল নিষ্পাপ দেখাত।
   */
  it('⭐ কিন্তু max_drift_sec ইতিহাস ধরে রাখে', async () => {
    await ping(BIG_DRIFT_SEC).expect(200);
    await ping(0).expect(200);

    const row = await deviceRow();
    expect(row.lastDriftSec).toBe(0);
    expect(row.maxDriftSec).toBe(BIG_DRIFT_SEC);
  });

  /**
   * ⚠️ ছোট drift (৫ সে.-এর নিচে) ইচ্ছাকৃতভাবে **উপেক্ষা** করা হয় —
   *    নেটওয়ার্কের বিলম্বেই ওটুকু হয়। তাই সেটা ০ হিসেবেই লেখা থাকে।
   */
  it('পাঁচ সেকেন্ডের নিচের drift শূন্যই থাকে', async () => {
    await ping(3).expect(200);

    const row = await deviceRow();
    expect(row.lastDriftSec).toBe(0);
    expect(row.maxDriftSec).toBe(0);
  });
});
