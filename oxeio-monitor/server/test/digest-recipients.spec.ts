import { describe, expect, it } from 'vitest';

import { digestRecipients } from '../src/digest/digest.recipients';

/**
 * সাপ্তাহিক সারাংশ **কার কাছে যাবে**।
 *
 * ⚠️⚠️ নিয়মটা ছোট, কিন্তু ভুলটা ফেরানো যায় না: এই বার্তায় প্রতিটা কর্মীর
 * **নাম ও ঘণ্টা** থাকে। একবার ভুল ঠিকানায় গেলে ইমেইল ফিরিয়ে আনা যায় না।
 */
describe('digestRecipients', () => {
  const owners = ['owner@oxeio.local'];

  it('স্পষ্ট তালিকা থাকলে সেটাই', () => {
    expect(digestRecipients({ explicit: 'boss@x.com', owners })).toEqual([
      'boss@x.com',
    ]);
  });

  it('না থাকলে সক্রিয় owner-রা', () => {
    expect(digestRecipients({ explicit: undefined, owners })).toEqual(owners);
  });

  it('খালি স্ট্রিংও "না থাকা"', () => {
    expect(digestRecipients({ explicit: '   ', owners })).toEqual(owners);
  });

  it('কমা দিয়ে একাধিক', () => {
    expect(
      digestRecipients({ explicit: 'a@x.com, b@x.com', owners }),
    ).toEqual(['a@x.com', 'b@x.com']);
  });

  /**
   * ⚠️ `.env`-এ বাড়তি কমা খুব সাধারণ — না ছাঁকলে খালি ঠিকানায় SMTP
   * ছুড়ত, আর গোটা পাঠানোটাই ব্যর্থ হতো।
   */
  it('ফাঁকা ঘর বাদ যায়', () => {
    expect(
      digestRecipients({ explicit: 'a@x.com,,  ,b@x.com', owners }),
    ).toEqual(['a@x.com', 'b@x.com']);
  });

  /** ⚠️ একই ঠিকানা দুবার থাকলে একজন দুটো কপি পেতেন */
  it('ডুপ্লিকেট একবারই', () => {
    expect(
      digestRecipients({ explicit: 'a@x.com, a@x.com', owners }),
    ).toEqual(['a@x.com']);
  });

  /** ⚠️ বড়-ছোট হাতের তফাতেও একই ঠিকানা */
  it('ছোট-বড় হাত মিলিয়ে ডুপ্লিকেট ধরা পড়ে', () => {
    expect(
      digestRecipients({ explicit: 'A@x.com, a@x.com', owners }),
    ).toEqual(['A@x.com']);
  });

  it('owner-দের তালিকাতেও ডুপ্লিকেট ছাঁকা হয়', () => {
    expect(
      digestRecipients({
        explicit: undefined,
        owners: ['o@x.com', 'O@x.com', 'p@x.com'],
      }),
    ).toEqual(['o@x.com', 'p@x.com']);
  });

  /** ⚠️ কেউ না থাকলে খালি — কলার তখন পাঠানোর চেষ্টাই করে না */
  it('কেউ না থাকলে খালি তালিকা', () => {
    expect(digestRecipients({ explicit: undefined, owners: [] })).toEqual([]);
  });
});
