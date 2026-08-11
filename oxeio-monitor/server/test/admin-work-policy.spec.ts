import { describe, expect, it } from 'vitest';

import {
  CAPTURE_EARLIEST,
  CAPTURE_LATEST,
  captureWindowProblem,
  DEFAULT_CAPTURE_WINDOW,
  hhmmToMinutes,
} from '../src/admin/work-policy.rules';

describe('ক্যাপচার উইন্ডো — ADR-011c-র সীমা', () => {
  it('০৭:০০–২৩:০০ মেনে নেয়', () => {
    expect(captureWindowProblem('07:00', '23:00')).toBeNull();
    expect(captureWindowProblem('09:00', '18:00')).toBeNull();
  });

  /**
   * ⭐ পণ্যের কঠিন নিয়ম: রাত ২টায় ল্যাপটপে ব্যক্তিগত কাজের ছবি উঠবে না।
   * এটাই একমাত্র জায়গা যেখানে একজন মানুষ ওই সীমা বদলাতে পারে।
   */
  it('এক মিনিট আগে শুরু করলেও নাকচ', () => {
    expect(captureWindowProblem('06:59', '23:00')).toContain('ADR-011c');
  });

  it('এক মিনিট পরে শেষ করলেও নাকচ', () => {
    expect(captureWindowProblem('07:00', '23:01')).toContain('ADR-011c');
  });

  it('২৪ ঘণ্টা করার চেষ্টা নাকচ', () => {
    expect(captureWindowProblem('00:00', '23:59')).not.toBeNull();
  });

  /**
   * ⚠️ শুরু = শেষ মানে শূন্য দৈর্ঘ্যের উইন্ডো — এজেন্ট একটাও ছবি তুলত না,
   * অথচ ড্যাশবোর্ডে সব ঠিকঠাক দেখাত। "কেউ বন্ধ করে দিয়েছে" আর "কাজ করছে
   * না" আলাদা করা যেত না।
   */
  it('শুরু আর শেষ এক হলে নাকচ', () => {
    expect(captureWindowProblem('09:00', '09:00')).toContain('must be before');
  });

  it('উল্টো উইন্ডো নাকচ', () => {
    expect(captureWindowProblem('18:00', '09:00')).toContain('must be before');
  });

  it('ফরম্যাট ভুল হলে কোনটা ভুল সেটাও বলে', () => {
    expect(captureWindowProblem('7:00', '23:00')).toContain('window start');
    expect(captureWindowProblem('07:00', '২৩:০০')).toContain('window end');
    expect(captureWindowProblem('07:00', '25:00')).toContain('window end');
  });

  /**
   * ⭐ ডিফল্টটাই যদি অবৈধ হয়ে যায়, তাহলে ক্যাপচার উইন্ডো না দিলে নীরবে
   * নিয়মভাঙা কনফিগ বসে যেত — আর কোনো টেস্ট সেটা ধরত না।
   */
  it('ডিফল্ট উইন্ডোটা নিজেই বৈধ', () => {
    expect(
      captureWindowProblem(
        DEFAULT_CAPTURE_WINDOW.screenshotFrom,
        DEFAULT_CAPTURE_WINDOW.screenshotTo,
      ),
    ).toBeNull();
    expect(DEFAULT_CAPTURE_WINDOW.screenshotFrom).toBe(CAPTURE_EARLIEST);
    expect(DEFAULT_CAPTURE_WINDOW.screenshotTo).toBe(CAPTURE_LATEST);
  });
});

describe('hhmmToMinutes', () => {
  it('মধ্যরাত থেকে মিনিট গোনে', () => {
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('07:00')).toBe(420);
    expect(hhmmToMinutes('23:59')).toBe(1439);
  });

  it('ভুল ফরম্যাটে null — শূন্য নয়', () => {
    // ⚠️ শূন্য ফেরত দিলে '০০:০০' আর 'আবর্জনা' এক হয়ে যেত, আর আবর্জনা
    //    মধ্যরাত ধরে নিয়ে উইন্ডো নীরবে খুলে যেত
    expect(hhmmToMinutes('abc')).toBeNull();
    expect(hhmmToMinutes('24:00')).toBeNull();
    expect(hhmmToMinutes('07:60')).toBeNull();
    expect(hhmmToMinutes('')).toBeNull();
  });
});
