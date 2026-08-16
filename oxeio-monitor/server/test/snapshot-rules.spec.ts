import { describe, expect, it } from 'vitest';

import {
  shouldSendSnapshot,
  snapshotMessage,
  type SnapshotPerson,
} from '../src/digest/snapshot.rules';

/**
 * **ঘণ্টায় একবারের স্ন্যাপশট** — এখন কে কাজ করছে, কে করছে না।
 *
 * ⚠️⚠️ এই ফিচারটা এসেছে একটা **প্রত্যাখ্যাত দাবি** থেকে: মালিক চেয়েছিলেন
 * কেউ ১০ মিনিটের বেশি idle থাকলেই খবর। হিসাবে দাঁড়াত দিনে ৬০–১৮০টা
 * বার্তা, আর কিছুদিনে সবাই সেগুলো অগ্রাহ্য করতে শিখত।
 *
 * ⭐ তাই এখানকার টেস্টগুলো দুটো জিনিস পাহারা দেয়: বার্তাটা **ছোট থাকে**,
 * আর **সৎ থাকে** (idle মানে অকর্মণ্য নয়)।
 */
const p = (
  fullName: string,
  status: SnapshotPerson['status'],
  todayWorkedSec = 0,
): SnapshotPerson => ({ fullName, status, todayWorkedSec });

describe('snapshotMessage', () => {
  it('কেউ না থাকলে বার্তা নয়', () => {
    expect(snapshotMessage({ people: [], clock: '11:00' })).toBeNull();
  });

  it('কতজন কাজ করছে সেটা মাথায়', () => {
    const msg = snapshotMessage({
      people: [p('Ali', 'active'), p('Sadia', 'idle'), p('Karim', 'active')],
      clock: '11:00',
    });

    expect(msg).toContain('Working now: 2/3');
  });

  /**
   * ⭐⭐ **এই ফাইলের মূল দাবি — বার্তাটা ছোট থাকে।** যাঁরা কাজ করছেন
   * তাঁদের শুধু গোনা হয়, নাম লেখা হয় না। সবার নাম লিখলে ১২ জনের তালিকায়
   * ঘণ্টায় একবার পড়াও ক্লান্তিকর হতো, আর তখন এটাও উপেক্ষিত হতো।
   */
  it('কাজ করা মানুষের নাম লেখা হয় না', () => {
    const msg = snapshotMessage({
      people: [p('Ali', 'active'), p('Karim', 'active')],
      clock: '11:00',
    });

    expect(msg).not.toContain('Ali');
    expect(msg).not.toContain('Karim');
  });

  /**
   * ⭐⭐ **সততার দাবি।** শুধু "Ali idle" লিখলে মনে হতো তিনি কিছুই করেননি।
   * আজকের ঘণ্টা সাথে দিলে ছবিটা সৎ হয় — তিনি হয়তো সারাদিন কাজ করে
   * এখন চা খেতে গেছেন।
   */
  it('idle-এর সাথে আজকের ঘণ্টাও যায়', () => {
    const msg = snapshotMessage({
      people: [p('Ali', 'idle', 5 * 3600 + 40 * 60)],
      clock: '15:00',
    });

    expect(msg).toContain('Ali (5h 40m today)');
  });

  it('offline আলাদা সারিতে', () => {
    const msg = snapshotMessage({
      people: [p('Ali', 'active'), p('Karim', 'offline')],
      clock: '11:00',
    });

    expect(msg).toContain('Offline: Karim');
  });

  /**
   * ⚠️⚠️ agent down **আলাদা করে শেষে** — এটাই একমাত্র সারি যেটা সত্যিকারের
   * সমস্যা। idle-এর সাথে মিশিয়ে দিলে রোজকার শব্দের নিচে চাপা পড়ত।
   */
  it('agent down আলাদা ও চিহ্নিত', () => {
    const msg = snapshotMessage({
      people: [p('Ali', 'active'), p('Sadia', 'agent_down')],
      clock: '11:00',
    });

    expect(msg).toContain('⚠ Agent down: Sadia');
    expect(msg!.indexOf('Agent down')).toBeGreaterThan(msg!.indexOf('Working now'));
  });

  it('সবাই কাজ করলে শুধু গোনাটাই থাকে', () => {
    const msg = snapshotMessage({
      people: [p('Ali', 'active'), p('Karim', 'active')],
      clock: '11:00',
    });

    expect(msg).not.toContain('Idle');
    expect(msg).not.toContain('Offline');
    expect(msg).not.toContain('Agent down');
  });

  it('ঘড়ি বার্তার মাথায়', () => {
    const msg = snapshotMessage({ people: [p('Ali', 'active')], clock: '14:00' });

    expect(msg!.startsWith('oXeio · 14:00')).toBe(true);
  });

  /** ⚠️ শূন্য ঘণ্টাও পড়ার মতো — "0h 00m", ফাঁকা নয় */
  it('শূন্য ঘণ্টাও লেখা হয়', () => {
    const msg = snapshotMessage({ people: [p('Ali', 'idle', 0)], clock: '09:00' });

    expect(msg).toContain('Ali (0h 00m today)');
  });
});

describe('shouldSendSnapshot', () => {
  /**
   * ⚠️⚠️ রাত ২টায় "Working now: 0/12" কোনো তথ্য নয়, শুধু শব্দ — আর ওই
   * শব্দই দিনের বার্তাগুলোকে অগ্রাহ্য করতে শেখায়।
   */
  it('কাজের সময়ের বাইরে পাঠানো হয় না', () => {
    expect(shouldSendSnapshot(2)).toBe(false);
    expect(shouldSendSnapshot(23)).toBe(false);
  });

  it('কাজের সময়ে পাঠানো হয়', () => {
    expect(shouldSendSnapshot(9)).toBe(true);
    expect(shouldSendSnapshot(14)).toBe(true);
  });

  /** ⚠️ সীমানা — শুরু ধরা হয়, শেষ ধরা হয় না */
  it('সীমানার আচরণ স্পষ্ট', () => {
    expect(shouldSendSnapshot(8)).toBe(false);
    expect(shouldSendSnapshot(19)).toBe(false);
    expect(shouldSendSnapshot(18)).toBe(true);
  });

  it('সময়সীমা বদলানো যায়', () => {
    expect(shouldSendSnapshot(7, 6, 22)).toBe(true);
  });
});
