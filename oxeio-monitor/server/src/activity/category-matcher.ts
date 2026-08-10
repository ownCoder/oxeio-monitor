import type { MatchType, Productivity } from '@prisma/client';

/**
 * অ্যাপ/সাইটকে productive · neutral · unproductive-এ ফেলা (D05) —
 * খাঁটি ফাংশন, কোনো I/O নেই।
 *
 * আলাদা ফাইলে রাখার কারণ [payroll.math.ts](../payroll/payroll.math.ts)-এর
 * মতোই: এই সিদ্ধান্তটা রিপোর্টে গিয়ে "কে কতটা কাজ করেছে" বলে দাঁড়ায়।
 * ডাটাবেসের সাথে মিশে থাকলে নিরিবিলি পরীক্ষা করা যেত না।
 *
 * ⚠️ **ক্যাটাগরি কখনো বেতনের হিসাবে ঢোকে না।** টাকার হিসাব একমাত্র
 * সেকেন্ডের উপর ([09 § ৪](../../../../docs/09-Build-Log.md))। কেউ সারাদিন
 * "unproductive" থাকলেও তার ঘণ্টা কাটা যায় না — এটা তথ্য, শাস্তি নয়।
 */

export interface CategoryRule {
  id: number;
  matchType: MatchType;
  pattern: string;
  displayName: string;
  category: Productivity;
  /** ⚠️ **ছোট সংখ্যা আগে জেতে** — নিচের compile() দেখুন */
  priority: number;
}

export interface CompiledRule extends CategoryRule {
  /** process/domain-এর জন্য ছোট হাতের প্যাটার্ন */
  needle: string;
  /** title_regex-এর জন্য; নইলে null */
  regex: RegExp | null;
}

/** যা দেখে সিদ্ধান্ত হয় — `app_usage`-এর একটা সারির তিনটে ফিল্ড। */
export interface UsageFacts {
  processName: string;
  domain?: string | null;
  windowTitle?: string | null;
}

/**
 * ⚠️ `title_regex` মালিকের লেখা (D06), আর JavaScript-এ regex-এর কোনো
 * টাইমআউট নেই — catastrophic backtracking হলে পুরো Node ইভেন্ট লুপ আটকে
 * যায়। দুটো রক্ষাকবচ: প্যাটার্ন ছোট রাখা, আর টাইটেল এমনিতেই ১০০০ অক্ষরে
 * বাঁধা (`AppUsageDto`)। দুটোই সম্পূর্ণ সমাধান নয় — তাই এই ম্যাচ-টাইপটা
 * seed-এ ব্যবহার করা হয়নি, আর D06-এ যোগ করার সময় নিয়মটা audit হবে।
 */
const MAX_REGEX_LENGTH = 200;

/**
 * নিয়মগুলোকে একবার সাজিয়ে ও কম্পাইল করে রাখা। ম্যাচ করার সময় শুধু
 * **প্রথম মিল**টাই নেওয়া হয়, তাই সাজানোর ক্রমটাই আসল সিদ্ধান্ত।
 *
 * ⭐ **ক্রম: priority ↑ → প্যাটার্নের দৈর্ঘ্য ↓ → id ↑**
 *
 * ১· **priority — ছোট সংখ্যা আগে।** seed-এ ব্রাউজারগুলোর priority ২০০,
 *    বাকি সবার ১০০। উল্টো করলে `chrome.exe` (neutral) সবসময় জিতত আর
 *    **প্রতিটা ব্রাউজিং মিনিট neutral হয়ে যেত** — youtube.com-ও, github.com-ও।
 *    D05-এর গোটা উদ্দেশ্যই তখন ব্যর্থ, অথচ কোথাও কোনো এরর দেখাত না।
 *
 * ২· **দৈর্ঘ্য — লম্বা প্যাটার্ন আগে**, অর্থাৎ বেশি নির্দিষ্টটা।
 *    `mail.google.com` (productive) আর `google.com` (neutral) দুটোই
 *    Gmail-এর সাথে মেলে; নির্দিষ্টটা না জিতলে Gmail "neutral" হতো।
 *
 * ৩· **id — শুধু নিশ্চিততার জন্য।** সমান হলে ফল যেন প্রতিবার এক থাকে;
 *    নইলে একই সারি দু-বার ক্যাটাগরি করলে দু-রকম ফল আসতে পারত।
 */
export function compile(rules: readonly CategoryRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];

  for (const rule of rules) {
    const needle = rule.pattern.trim().toLowerCase();
    if (needle.length === 0) continue;

    let regex: RegExp | null = null;

    if (rule.matchType === 'title_regex') {
      if (rule.pattern.length > MAX_REGEX_LENGTH) continue;

      try {
        regex = new RegExp(rule.pattern, 'i');
      } catch {
        // ⚠️ ভুল regex-এ ingest ভেঙে পড়া চলবে না — একটা নিয়ম বাদ পড়া
        //    অনেক কম ক্ষতি। কোন নিয়মটা বাদ পড়ল সেটা সার্ভিস লগে যায়।
        continue;
      }
    }

    compiled.push({ ...rule, needle, regex });
  }

  return compiled.sort(
    (a, b) =>
      a.priority - b.priority ||
      b.needle.length - a.needle.length ||
      a.id - b.id,
  );
}

/** মিল না পেলে <c>null</c> — অচেনা অ্যাপ জোর করে কোনো ঘরে ফেলা হয় না। */
export function matchCategory(
  rules: readonly CompiledRule[],
  facts: UsageFacts,
): CompiledRule | null {
  const process = facts.processName?.trim().toLowerCase() ?? '';
  const domain = facts.domain?.trim().toLowerCase() ?? '';
  const title = facts.windowTitle ?? '';

  for (const rule of rules) {
    switch (rule.matchType) {
      case 'process':
        if (process.length > 0 && process === rule.needle) return rule;
        break;

      case 'domain':
        if (domain.length > 0 && domainMatches(domain, rule.needle)) return rule;
        break;

      case 'title_regex':
        if (title.length > 0 && rule.regex?.test(title) === true) return rule;
        break;
    }
  }

  return null;
}

/**
 * ডোমেইন মিলছে কি না — নিজে, নাকি সাবডোমেইন হিসেবে।
 *
 * ⚠️ **সাধারণ `includes()` বা `endsWith()` দিয়ে করা যায় না।**
 * `endsWith('google.com')` লিখলে `notgoogle.com` আর `evilgoogle.com`-ও
 * "Google" হয়ে যেত। তাই মিলটা **লেবেলের সীমানায়** হতে হবে —
 * `mail.google.com` ✅, কিন্তু `notgoogle.com` ❌।
 *
 * এতে `atlassian.net` নিয়মটা `acme.atlassian.net`-এও কাজ করে, যেটা
 * দরকারি: প্রতিটা কোম্পানির Jira আলাদা সাবডোমেইনে থাকে।
 */
function domainMatches(domain: string, pattern: string): boolean {
  if (domain === pattern) return true;

  return (
    domain.length > pattern.length + 1 &&
    domain.endsWith(pattern) &&
    domain[domain.length - pattern.length - 1] === '.'
  );
}
