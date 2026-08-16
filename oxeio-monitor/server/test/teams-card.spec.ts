import { describe, expect, it } from 'vitest';

import { teamsCard, trimForTeams } from '../src/alerts/teams.card';

/**
 * **Teams-এ পাঠানোর পে-লোডের গড়ন।**
 *
 * ⚠️⚠️ এই ফাইলটা কেন দরকার, তার একটাই কারণ: <b>Teams ভুল গড়নেও ২০০ ফেরত
 * দেয়</b>, আর চ্যানেলে কিচ্ছু দেখা যায় না। অর্থাৎ ব্যর্থতাটা সম্পূর্ণ
 * নীরব — সার্ভারের লগ বলবে "sent", অথচ কেউ কোনোদিন কিছু পায়নি।
 *
 * ⭐ HTTP স্তরে এটা ধরা যায় না, তাই গড়নটা এখানে বেঁধে রাখা হয়েছে।
 */
describe('teamsCard', () => {
  const card = teamsCard('oXeio — সাপ্তাহিক', 'Belal: 38h · Ali: 41h');

  /**
   * ⚠️⚠️ তিনটে নামই হুবহু এই বানানে লাগে। একটাও বদলালে Teams সংযুক্তিটা
   * নীরবে ফেলে দেয়।
   */
  it('খামের নামগুলো হুবহু', () => {
    expect(card.type).toBe('message');
    expect(card.attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    );
    expect(card.attachments[0].content.type).toBe('AdaptiveCard');
  });

  /** ⚠️ `contentUrl` না থাকলে কিছু ক্লায়েন্ট সংযুক্তিটা বাদ দেয় */
  it('contentUrl থাকে, null হয়ে', () => {
    expect(card.attachments[0]).toHaveProperty('contentUrl', null);
  });

  /**
   * ⚠️ সংস্করণ ১.৪ — বেশি নতুন চাইলে কারো কারো ক্লায়েন্টে কার্ডটা
   * **ফাঁকা** দেখাত, আবারও নীরব ব্যর্থতা।
   */
  it('Adaptive Card সংস্করণ ১.৪', () => {
    expect(card.attachments[0].content.version).toBe('1.4');
  });

  it('শিরোনাম ও লেখা দুটোই কার্ডে থাকে', () => {
    const body = card.attachments[0].content.body as { text: string }[];

    expect(body[0].text).toBe('oXeio — সাপ্তাহিক');
    expect(body[1].text).toContain('Belal: 38h');
  });

  /** ⭐ `wrap` ছাড়া লম্বা লাইন কেটে যেত, আর নাম অর্ধেক দেখাত */
  it('দুটো ব্লকেই wrap চালু', () => {
    const body = card.attachments[0].content.body as { wrap: boolean }[];

    expect(body[0].wrap).toBe(true);
    expect(body[1].wrap).toBe(true);
  });

  it('JSON-এ রূপান্তর করা যায়', () => {
    expect(() => JSON.stringify(card)).not.toThrow();
  });
});

describe('trimForTeams', () => {
  it('ছোট লেখা অক্ষত', () => {
    expect(trimForTeams('ছোট')).toBe('ছোট');
  });

  /**
   * ⚠️⚠️ Teams-এর সীমা ছাড়ালে <b>পুরো বার্তাটাই ফেলে দেয়</b>, অর্ধেক নয়।
   * তাই নিজে কেটে দেওয়া — নইলে দল বড় হওয়ার দিন সাপ্তাহিক সারাংশ হঠাৎ
   * নীরবে আসা বন্ধ হয়ে যেত।
   */
  it('অনেক বড় লেখা কেটে দেওয়া হয়', () => {
    const trimmed = trimForTeams('ক'.repeat(30_000));

    expect(trimmed.length).toBeLessThanOrEqual(20_000);
  });

  /** ⭐ কাটা পড়েছে সেটা বার্তাতেই বলা — নইলে কেউ ভাবত হিসাবই কম */
  it('কাটা পড়লে সেটা লেখা থাকে', () => {
    const trimmed = trimForTeams('ক'.repeat(30_000));

    expect(trimmed).toContain('কেটে দেওয়া হয়েছে');
  });

  it('ঠিক সীমানায় কাটা হয় না', () => {
    const exact = 'ক'.repeat(20_000);

    expect(trimForTeams(exact)).toBe(exact);
  });
});
