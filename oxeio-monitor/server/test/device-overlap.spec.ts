import { describe, expect, it } from 'vitest';

import { OVERLAP_ALERT_SEC } from '../src/alerts/alerts.constants';
import { shouldFlagOverlap } from '../src/alerts/alerts.rules';
import { overlapSec, type DeviceSpans } from '../src/summary/summary.math';

/**
 * **G32** — একই স্টাফের দুটো ডিভাইস একসাথে।
 *
 * ⚠️ এই অ্যালার্টটা একজন মানুষের নামে ওঠে, ডিভাইসের নামে নয় — তাই ভুল
 * হিসাবের দাম এখানে সবচেয়ে বেশি। একটা মিথ্যা `device_overlap` মানে কারো
 * কাজের সততা নিয়ে প্রশ্ন তোলা, অথচ সে হয়তো সারাদিন একটাই মেশিনে ছিল।
 */

const at = (hh: number, mm = 0): Date =>
  new Date(Date.UTC(2026, 7, 12, hh - 6, mm)); // ঢাকা → UTC

const span = (fromH: number, toH: number) => ({
  startedAt: at(fromH),
  endedAt: at(toH),
});

const device = (deviceId: number, ...spans: Array<{ startedAt: Date; endedAt: Date }>):
  DeviceSpans => ({ deviceId, spans });

describe('overlapSec — কত সেকেন্ড দুই মেশিন একসাথে চলেছে', () => {
  it('ডিভাইস একটা হলে শূন্য', () =>
    expect(overlapSec([device(1, span(9, 17))])).toBe(0));

  it('কিছুই না থাকলে শূন্য', () => expect(overlapSec([])).toBe(0));

  /**
   * ⭐ এটাই সেই ভুলটার পাহারা যেটা প্রায় হয়েই গিয়েছিল। এখানে দুটো ডিভাইস
   * আছে কিন্তু সময়ে **মেলে না** — সকালে ডেস্কটপ, বিকেলে ল্যাপটপ। ভুল
   * হিসাবে (`active_sec − worked_sec`) এখানেও একটা ফারাক আসতে পারত।
   */
  it('দুটো ডিভাইস কিন্তু আলাদা সময়ে — শূন্য', () =>
    expect(overlapSec([device(1, span(9, 13)), device(2, span(14, 18))])).toBe(0));

  it('দুই ঘণ্টা মিলে গেলে দুই ঘণ্টা', () =>
    expect(overlapSec([device(1, span(9, 13)), device(2, span(11, 15))])).toBe(
      2 * 3600,
    ));

  it('একটা ডিভাইসের সময় পুরোপুরি আরেকটার ভেতরে', () =>
    expect(overlapSec([device(1, span(9, 18)), device(2, span(11, 12))])).toBe(3600));

  /**
   * ⚠️ একই মেশিনের দুটো ছোঁয়া-ছোঁয়া খণ্ড (রিট্রাই, সেশন আবার খোলা) যেন
   * overlap বলে না গোনা হয় — তাই প্রতি ডিভাইসের নিজের UNION নেওয়া হয়,
   * কাঁচা যোগফল নয়। যোগফল নিলে এখানে ফল আসত ১ ঘণ্টা, অথচ মেশিন একটাই।
   */
  it('একই মেশিনের পরস্পরকে ছোঁয়া খণ্ড overlap নয়', () =>
    expect(overlapSec([device(1, span(9, 12), span(11, 13))])).toBe(0));

  it('তিনটে ডিভাইস একসাথে — জোড়াগুলোর যোগ', () =>
    // ৯–১২, ৯–১২, ৯–১২ · একসাথে ৩ ঘণ্টা → Σ৯ − ৩ = ৬
    expect(
      overlapSec([device(1, span(9, 12)), device(2, span(9, 12)), device(3, span(9, 12))]),
    ).toBe(6 * 3600));
});

describe('shouldFlagOverlap — অ্যালার্ট উঠবে কি না', () => {
  const input = (overlap: number, deviceCount = 2) => ({
    deviceCount,
    overlapSec: overlap,
    workedSec: 8 * 3600,
  });

  it('ডিভাইস একটা হলে কখনোই নয়', () =>
    expect(shouldFlagOverlap(input(9999, 1))).toBe(false));

  /**
   * ⚠️ ১৪ মিনিট — রোজকার ঘটনা (ডেস্কটপ লক না করে ল্যাপটপ নিয়ে মিটিং)।
   * দোরগোড়া নামালে প্রায় প্রতিদিন সবার নামে অ্যালার্ট উঠত, আর তখন
   * এই অ্যালার্টটার মানেই থাকত না।
   */
  it('অল্প overlap-এ চুপ থাকে', () =>
    expect(shouldFlagOverlap(input(14 * 60))).toBe(false));

  it('ঠিক ১৫ মিনিটে ওঠে', () =>
    expect(shouldFlagOverlap(input(OVERLAP_ALERT_SEC))).toBe(true));

  it('আধ ঘণ্টায় অবশ্যই ওঠে', () =>
    expect(shouldFlagOverlap(input(30 * 60))).toBe(true));
});
