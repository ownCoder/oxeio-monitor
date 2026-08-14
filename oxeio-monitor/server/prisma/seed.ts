/**
 * oXeio — seed data
 *
 *   1. Work policy   — মাসিক ২০৮ ঘণ্টা, শুক্র সাপ্তাহিক ছুটি, ছবি ০৭:০০–২৩:০০
 *   2. App categories — productive / neutral / unproductive রুল
 *   3. Holidays      — ২০২৬–২৭-এর সরকারি ছুটি (`holidays.data.ts`)
 *   4. Owner account — .env-এর SEED_OWNER_* থেকে
 *
 * বারবার চালানো নিরাপদ — সব কিছু upsert।
 *
 * ⚠️⚠️ **একটাই ব্যতিক্রম, আর সেটা টাকার:** ছুটি বসানো "নিরাপদ পুনরাবৃত্তি"
 *    নয়। চলতি বা অতীত মাসে একটা নতুন ছুটি বসলে ওই মাসের কর্মদিবস কমে,
 *    টার্গেট ও pace বদলায়, আর পে-রোলের `d ÷ D` ভগ্নাংশও বদলায়। তাই seed
 *    ওই মাসগুলোতে **নিজে থেকে কিছু বসায় না** — শুধু তারিখগুলো নাম ধরে ছাপে।
 *    বসাতে হলে `SEED_HOLIDAYS_PAST=true` (deploy/README.md § ২.১গ)।
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hash } from '@node-rs/argon2';
import { MatchType, PrismaClient, Productivity, UserRole } from '@prisma/client';

import {
  BD_HOLIDAYS,
  HOLIDAY_YEARS,
  dhakaToday,
  gazetteNotes,
  holidayRowName,
  planHolidaySeedRun,
  validateHolidays,
  yearsSettled,
  yearsToSeed,
} from './holidays.data';
import { parseStaff, shouldSeedSampleStaff, type StaffRow } from './parse-staff';

const prisma = new PrismaClient();

// ── 1 · work policy ─────────────────────────────────────────────────────────

async function seedWorkPolicy(): Promise<number> {
  const policy = await prisma.workPolicy.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Standard',
      monthlyTargetHours: 208,
      expectedWorkdays: 26,
      weeklyOffDay: 5, // ISO: শুক্রবার। ⚠️ ব্লক নয় — শুক্রবারে কাজ করলেও গোনা হবে
      screenshotFrom: '07:00',
      screenshotTo: '23:00',
      idleThresholdSec: 60,
      slotMinutes: 5,
      timezone: 'Asia/Dhaka',
      isActive: true,
    },
  });
  return policy.id;
}

// ── 2 · app categories ──────────────────────────────────────────────────────

type Rule = [MatchType, string, string, Productivity, number?];

const RULES: Rule[] = [
  // ── development ───────────────────────────────────────────────
  [MatchType.process, 'code.exe', 'Visual Studio Code', Productivity.productive],
  [MatchType.process, 'devenv.exe', 'Visual Studio', Productivity.productive],
  [MatchType.process, 'rider64.exe', 'JetBrains Rider', Productivity.productive],
  [MatchType.process, 'webstorm64.exe', 'WebStorm', Productivity.productive],
  [MatchType.process, 'pycharm64.exe', 'PyCharm', Productivity.productive],
  [MatchType.process, 'idea64.exe', 'IntelliJ IDEA', Productivity.productive],
  [MatchType.process, 'sublime_text.exe', 'Sublime Text', Productivity.productive],
  [MatchType.process, 'notepad++.exe', 'Notepad++', Productivity.productive],
  [MatchType.process, 'windowsterminal.exe', 'Windows Terminal', Productivity.productive],
  [MatchType.process, 'powershell.exe', 'PowerShell', Productivity.productive],
  [MatchType.process, 'cmd.exe', 'Command Prompt', Productivity.productive],
  [MatchType.process, 'git-bash.exe', 'Git Bash', Productivity.productive],
  [MatchType.process, 'docker desktop.exe', 'Docker Desktop', Productivity.productive],
  [MatchType.process, 'postman.exe', 'Postman', Productivity.productive],
  [MatchType.process, 'insomnia.exe', 'Insomnia', Productivity.productive],
  [MatchType.process, 'datagrip64.exe', 'DataGrip', Productivity.productive],
  [MatchType.process, 'ssms.exe', 'SQL Server Mgmt Studio', Productivity.productive],
  [MatchType.process, 'pgadmin4.exe', 'pgAdmin', Productivity.productive],
  [MatchType.process, 'mysqlworkbench.exe', 'MySQL Workbench', Productivity.productive],
  [MatchType.process, 'sourcetree.exe', 'Sourcetree', Productivity.productive],
  [MatchType.process, 'gitkraken.exe', 'GitKraken', Productivity.productive],
  [MatchType.domain, 'github.com', 'GitHub', Productivity.productive],
  [MatchType.domain, 'gitlab.com', 'GitLab', Productivity.productive],
  [MatchType.domain, 'bitbucket.org', 'Bitbucket', Productivity.productive],
  [MatchType.domain, 'stackoverflow.com', 'Stack Overflow', Productivity.productive],
  [MatchType.domain, 'developer.mozilla.org', 'MDN', Productivity.productive],
  [MatchType.domain, 'npmjs.com', 'npm', Productivity.productive],
  [MatchType.domain, 'nuget.org', 'NuGet', Productivity.productive],
  [MatchType.domain, 'docs.microsoft.com', 'Microsoft Docs', Productivity.productive],
  [MatchType.domain, 'learn.microsoft.com', 'Microsoft Learn', Productivity.productive],
  [MatchType.domain, 'vercel.com', 'Vercel', Productivity.productive],
  [MatchType.domain, 'netlify.com', 'Netlify', Productivity.productive],
  [MatchType.domain, 'digitalocean.com', 'DigitalOcean', Productivity.productive],
  [MatchType.domain, 'aws.amazon.com', 'AWS', Productivity.productive],
  [MatchType.domain, 'console.cloud.google.com', 'Google Cloud', Productivity.productive],
  [MatchType.domain, 'chatgpt.com', 'ChatGPT', Productivity.productive],
  [MatchType.domain, 'claude.ai', 'Claude', Productivity.productive],

  // ── design ────────────────────────────────────────────────────
  [MatchType.process, 'photoshop.exe', 'Adobe Photoshop', Productivity.productive],
  [MatchType.process, 'illustrator.exe', 'Adobe Illustrator', Productivity.productive],
  [MatchType.process, 'indesign.exe', 'Adobe InDesign', Productivity.productive],
  [MatchType.process, 'afterfx.exe', 'After Effects', Productivity.productive],
  [MatchType.process, 'adobe premiere pro.exe', 'Premiere Pro', Productivity.productive],
  [MatchType.process, 'figma.exe', 'Figma', Productivity.productive],
  [MatchType.process, 'coreldrw.exe', 'CorelDRAW', Productivity.productive],
  [MatchType.process, 'blender.exe', 'Blender', Productivity.productive],
  [MatchType.domain, 'figma.com', 'Figma', Productivity.productive],
  [MatchType.domain, 'canva.com', 'Canva', Productivity.productive],
  [MatchType.domain, 'dribbble.com', 'Dribbble', Productivity.productive],
  [MatchType.domain, 'behance.net', 'Behance', Productivity.productive],
  [MatchType.domain, 'unsplash.com', 'Unsplash', Productivity.productive],

  // ── office ও ডকুমেন্ট ─────────────────────────────────────────
  [MatchType.process, 'excel.exe', 'Microsoft Excel', Productivity.productive],
  [MatchType.process, 'winword.exe', 'Microsoft Word', Productivity.productive],
  [MatchType.process, 'powerpnt.exe', 'PowerPoint', Productivity.productive],
  [MatchType.process, 'outlook.exe', 'Outlook', Productivity.productive],
  [MatchType.process, 'onenote.exe', 'OneNote', Productivity.productive],
  [MatchType.process, 'acrobat.exe', 'Adobe Acrobat', Productivity.productive],
  [MatchType.process, 'acrord32.exe', 'Acrobat Reader', Productivity.productive],
  [MatchType.domain, 'docs.google.com', 'Google Docs', Productivity.productive],
  [MatchType.domain, 'sheets.google.com', 'Google Sheets', Productivity.productive],
  [MatchType.domain, 'drive.google.com', 'Google Drive', Productivity.productive],
  [MatchType.domain, 'mail.google.com', 'Gmail', Productivity.productive],
  [MatchType.domain, 'outlook.office.com', 'Outlook Web', Productivity.productive],
  [MatchType.domain, 'notion.so', 'Notion', Productivity.productive],
  [MatchType.domain, 'atlassian.net', 'Jira / Confluence', Productivity.productive],
  [MatchType.domain, 'trello.com', 'Trello', Productivity.productive],
  [MatchType.domain, 'asana.com', 'Asana', Productivity.productive],
  [MatchType.domain, 'clickup.com', 'ClickUp', Productivity.productive],

  // ── communication (কাজের, কিন্তু মাপা কঠিন) ───────────────────
  [MatchType.process, 'ms-teams.exe', 'Microsoft Teams', Productivity.productive],
  [MatchType.process, 'teams.exe', 'Microsoft Teams', Productivity.productive],
  [MatchType.process, 'slack.exe', 'Slack', Productivity.productive],
  [MatchType.process, 'zoom.exe', 'Zoom', Productivity.productive],
  [MatchType.process, 'skype.exe', 'Skype', Productivity.neutral],
  [MatchType.domain, 'meet.google.com', 'Google Meet', Productivity.productive],
  [MatchType.domain, 'zoom.us', 'Zoom', Productivity.productive],
  [MatchType.domain, 'slack.com', 'Slack', Productivity.productive],
  [MatchType.domain, 'web.whatsapp.com', 'WhatsApp Web', Productivity.neutral],

  // ── neutral ───────────────────────────────────────────────────
  [MatchType.process, 'explorer.exe', 'File Explorer', Productivity.neutral],
  [MatchType.process, 'chrome.exe', 'Google Chrome', Productivity.neutral, 200],
  [MatchType.process, 'msedge.exe', 'Microsoft Edge', Productivity.neutral, 200],
  [MatchType.process, 'firefox.exe', 'Mozilla Firefox', Productivity.neutral, 200],
  [MatchType.process, 'calc.exe', 'Calculator', Productivity.neutral],
  [MatchType.process, 'notepad.exe', 'Notepad', Productivity.neutral],
  [MatchType.process, 'snippingtool.exe', 'Snipping Tool', Productivity.neutral],
  [MatchType.domain, 'google.com', 'Google Search', Productivity.neutral],
  [MatchType.domain, 'bing.com', 'Bing', Productivity.neutral],
  [MatchType.domain, 'wikipedia.org', 'Wikipedia', Productivity.neutral],
  [MatchType.domain, 'linkedin.com', 'LinkedIn', Productivity.neutral],
  [MatchType.domain, 'prothomalo.com', 'Prothom Alo', Productivity.neutral],
  [MatchType.domain, 'bdnews24.com', 'bdnews24', Productivity.neutral],

  // ── unproductive ──────────────────────────────────────────────
  [MatchType.domain, 'facebook.com', 'Facebook', Productivity.unproductive],
  [MatchType.domain, 'messenger.com', 'Messenger', Productivity.unproductive],
  [MatchType.domain, 'instagram.com', 'Instagram', Productivity.unproductive],
  [MatchType.domain, 'tiktok.com', 'TikTok', Productivity.unproductive],
  [MatchType.domain, 'x.com', 'X (Twitter)', Productivity.unproductive],
  [MatchType.domain, 'twitter.com', 'Twitter', Productivity.unproductive],
  [MatchType.domain, 'youtube.com', 'YouTube', Productivity.unproductive],
  [MatchType.domain, 'netflix.com', 'Netflix', Productivity.unproductive],
  [MatchType.domain, 'hoichoi.tv', 'Hoichoi', Productivity.unproductive],
  [MatchType.domain, 'reddit.com', 'Reddit', Productivity.unproductive],
  [MatchType.domain, 'pinterest.com', 'Pinterest', Productivity.unproductive],
  [MatchType.domain, 'twitch.tv', 'Twitch', Productivity.unproductive],
  [MatchType.domain, 'daraz.com.bd', 'Daraz', Productivity.unproductive],
  [MatchType.domain, 'amazon.com', 'Amazon', Productivity.unproductive],
  [MatchType.domain, 'cricbuzz.com', 'Cricbuzz', Productivity.unproductive],
  [MatchType.domain, 'espncricinfo.com', 'ESPNcricinfo', Productivity.unproductive],
  [MatchType.process, 'steam.exe', 'Steam', Productivity.unproductive],
  [MatchType.process, 'epicgameslauncher.exe', 'Epic Games', Productivity.unproductive],
  [MatchType.process, 'spotify.exe', 'Spotify', Productivity.unproductive],
  [MatchType.process, 'vlc.exe', 'VLC Player', Productivity.unproductive],
];

async function seedAppCategories(): Promise<number> {
  for (const [matchType, pattern, displayName, category, priority] of RULES) {
    const existing = await prisma.appCategory.findFirst({
      where: { matchType, pattern },
    });
    if (existing) {
      await prisma.appCategory.update({
        where: { id: existing.id },
        data: { displayName, category, priority: priority ?? 100 },
      });
    } else {
      await prisma.appCategory.create({
        data: { matchType, pattern, displayName, category, priority: priority ?? 100 },
      });
    }
  }
  return RULES.length;
}

// ── 3 · holidays ────────────────────────────────────────────────────────────
//
// ⚠️⚠️ আগে এখানে ছিল কেবল ৭টা **নির্দিষ্ট তারিখের** ছুটি; চান্দ্রগুলো
//    (ঈদ, আশুরা, শবে বরাত, দুর্গাপূজা…) "অনুমান করা যাবে না" যুক্তিতে বাদ
//    ছিল। কিন্তু বাদ দেওয়া মানে ওই দিনগুলো **কর্মদিবস** হিসেবে গোনা — অর্থাৎ
//    চুপচাপ "ছুটি নেই" বলা, যা একটা সক্রিয় ভুল: প্রত্যেকের টার্গেট ও pace
//    দুটোই বেশি দেখাত (roadmap R7 · open question O2)।
//    এখন তালিকাটা `holidays.data.ts`-এ, আর আনুমানিক তারিখ **আনুমানিক বলেই**
//    যায় — নামের শেষে "(সম্ভাব্য)"। কেন এভাবে, তা ওই ফাইলের মাথায় লেখা।

const HOLIDAY_SEED_KEY = 'seed.holidays';

/**
 * ⭐⭐ **চলতি ও অতীত মাসে ছুটি বসানোর স্পষ্ট সম্মতি।**
 *
 * ⚠️⚠️ কেন একটা পতাকা লাগল: `npm run seed` দেখতে নিরীহ ("সব upsert, বারবার
 *    চালানো নিরাপদ"), কিন্তু চলতি মাসের মাঝপথে একটা নতুন ছুটি বসলে ওই মাসের
 *    কর্মদিবস D কমে যায় → `dailyTargetSec = মাসিক ÷ D` বাড়ে →
 *    `monthly_summary`-র `target_sec`·`expected_sec`·`pace_sec` তিনটেই নড়ে,
 *    আর G37-এর `d ÷ D` ভগ্নাংশ (`src/payroll/payroll.service.ts`) **সরাসরি
 *    টাকায়** গিয়ে পড়ে। অর্থাৎ একটা রুটিন কমান্ড নীরবে বেতন বদলে দিত।
 *
 * ⚠️ মিলানো হয় হুবহু `'true'`-র সাথে। `1`/`yes` লিখলে সম্মতি **ধরা হয় না**,
 *    আর তখন seed তারিখগুলো আবার নাম ধরে ছাপে — অর্থাৎ ভুলটা নীরব নয়, চোখে
 *    পড়ে। উল্টো দিকে "যেকোনো অ-খালি মান = হ্যাঁ" ধরলে একটা ফাঁকা-নয়-এমন
 *    টাইপো (`SEED_HOLIDAYS_PAST=false`) সম্মতি হয়ে যেত।
 */
const ALLOW_PAST_HOLIDAYS = process.env.SEED_HOLIDAYS_PAST === 'true';

/** `settings`-এর ওই একটামাত্র সারি: কোন কোন বছর একবার বসানো হয়ে গেছে */
interface HolidaySeedState {
  years?: number[];
}

async function loadSeededYears(): Promise<number[]> {
  const row = await prisma.setting.findUnique({
    where: { key: HOLIDAY_SEED_KEY },
    select: { value: true },
  });
  if (!row || typeof row.value !== 'object' || row.value === null) return [];
  const years = (row.value as HolidaySeedState).years;
  return Array.isArray(years) ? years.filter((y) => typeof y === 'number') : [];
}

/**
 * ছুটির ক্যালেন্ডার বসানো।
 *
 * ⭐⭐ **seed এখানে কিছু বদলায় না, মোছেও না — শুধু অনুপস্থিত সারি বসায়।**
 *    সরকার ঘোষণা দিলে মালিক Settings → Holidays-এ তারিখ/নাম ঠিক করবেন, আর
 *    পরের `db seed` সেটা ফিরিয়ে দেবে না। আগের কোড `update: { name }` করত —
 *    তাতে হাতে করা প্রতিটা সংশোধন পরের seed-এ মুছে যেত।
 *
 * ⭐⭐ **নোটগুলো প্রতিবারই ছাপে — ছুটি বসুক বা না বসুক।** আগে বছর বসে গেলে
 *    এখান থেকেই early-return হতো, তাই `unlisted`/`renamed` নোট প্রথম রানের
 *    পর **চিরতরে নীরব** হয়ে যেত। ⚠️ "না বলা সিদ্ধান্ত নয়, চেপে যাওয়া" —
 *    নিয়মটা seed নিজেই দ্বিতীয় রানে ভাঙছিল।
 *
 * ⭐⭐ **আর চলতি/অতীত মাসে seed নিজে থেকে কিছু বসায় না** — ওই মাসগুলোর
 *    সংখ্যা ইতিমধ্যে বেরিয়ে গেছে, তাই সেখানে ছুটি বসানো মানে পিছন ফিরে
 *    টার্গেট ও পে-রোল বদলানো। বসাতে হলে `SEED_HOLIDAYS_PAST=true`
 *    (`ALLOW_PAST_HOLIDAYS`-এর নোট)। নইলে তারিখগুলো **নাম ধরে ধরে** ছাপা হয়।
 */
async function seedHolidays(): Promise<{
  summary: string;
  standing: string[];
  notes: string[];
}> {
  const problems = validateHolidays(BD_HOLIDAYS);
  if (problems.length > 0) {
    // ⚠️ থামানো হয়, কারণ ভুল তারিখ সরাসরি কর্মদিবসের হিসাবে ঢোকে
    throw new Error(`ছুটির তালিকায় ভুল:\n  - ${problems.join('\n  - ')}`);
  }

  const seeded = await loadSeededYears();
  const years = yearsToSeed(HOLIDAY_YEARS, seeded);

  // ⚠️ DB **প্রতিবারই** পড়া হয়, বছর বাকি থাক বা না থাক — নইলে বলার মতো
  //    কিছু আছে কি না সেটাই জানা যেত না।
  const rows = await prisma.holiday.findMany({
    select: { holidayDate: true, name: true },
  });

  // ⭐ পরিকল্পনা হয় **পুরো তালিকার** উপর; `years` শুধু ঠিক করে কী বসবে
  const run = planHolidaySeedRun(
    BD_HOLIDAYS,
    rows.map((row) => ({
      date: row.holidayDate.toISOString().slice(0, 10),
      name: row.name,
    })),
    years,
    // ⚠️ "আজ" ঢাকার তারিখ, মেশিনের স্থানীয় ঘড়ির নয় — `dhakaToday()`-র নোট
    { today: dhakaToday(new Date()), allowPast: ALLOW_PAST_HOLIDAYS },
  );

  for (const entry of run.create) {
    await prisma.holiday.create({
      data: {
        // ⚠️ `@db.Date` কলাম UTC-মধ্যরাত ধরে; স্থানীয় সময় দিলে ঢাকায় ছুটিটা
        //    আগের দিনে গিয়ে পড়ত (`parse-staff.ts`-এ একই ফাঁদ)
        holidayDate: new Date(`${entry.date}T00:00:00.000Z`),
        name: holidayRowName(entry),
        // ⚠️ পর্দার Type বাছাইয়ে শুধু public/optional/company আছে — নতুন কোনো
        //    মান দিলে মালিক Edit → Save করলেই সেটা নিঃশব্দে বদলে যেত
        type: 'public',
      },
    });
  }

  /**
   * ⭐⭐ যে বছরে সম্মতির অপেক্ষায় সারি রয়ে গেছে, সেটা "বসানো হয়ে গেছে" নয়
   *    — নইলে `SEED_HOLIDAYS_PAST=true` পরের রানে আর কোনো কাজেই লাগত না
   *    (`yearsSettled`-এর নোটে কারণ ও এর দামটাও লেখা)।
   *
   * ⚠️ `settings` কেবল তখনই ছোঁয়া হয় যখন সত্যিই একটা বছর সম্পূর্ণ বসল —
   *    নইলে প্রতিটা রান একই মান আবার লিখত, আর `updated_at` মিথ্যে বলত।
   */
  const settledYears = yearsSettled(years, run.needsConsent);
  if (settledYears.length > 0) {
    await prisma.setting.upsert({
      where: { key: HOLIDAY_SEED_KEY },
      create: {
        key: HOLIDAY_SEED_KEY,
        value: { years: [...seeded, ...settledYears] },
      },
      update: { value: { years: [...seeded, ...settledYears] } },
    });
  }

  /**
   * ⭐⭐ সারাংশে **প্রতিটা ভাগ আলাদা করে** বলা হয়। আগে শুধু "কতটা বসেছে"
   *    ছাপা হতো; এখন যেগুলো **বসেনি** সেগুলোর সংখ্যাও থাকে, কারণ "০টি
   *    বসেছে" পড়ে দুটো একেবারে আলাদা জিনিস বোঝা যেত — "সব আগে থেকেই ঠিক
   *    ছিল" আর "১৮টা তারিখ আটকে আছে"।
   */
  const approx = run.create.filter((h) => h.approximate).length;
  const parts = [
    `${run.create.length}টি বসেছে (${approx}টি সম্ভাব্য তারিখ)`,
    `${run.kept}টি আগে থেকেই ছিল`,
  ];
  if (run.needsConsent.length > 0) {
    parts.push(`${run.needsConsent.length}টি চলতি/অতীত মাস বলে আটকানো`);
  }
  if (run.heldBack.length > 0) {
    parts.push(`${run.heldBack.length}টি বন্ধ বছরে (তাই বসেনি)`);
  }
  /**
   * ⚠️ তিনটে অবস্থা আলাদা করে বলা হয়। "কোনো বছর সম্পূর্ণ হয়নি" আর "সব
   *    বছর আগেই সম্পূর্ণ" — দুটোই "নতুন কিছু বন্ধ হয়নি", কিন্তু প্রথমটা
   *    মানে কিছু আটকে আছে, দ্বিতীয়টা মানে সব ঠিক আছে।
   */
  if (years.length === 0) {
    const done = [...seeded].sort((a, b) => a - b).join(', ');
    parts.push(`সব বছর আগেই সম্পূর্ণ (${done})`);
  } else if (settledYears.length > 0) {
    parts.push(`বছর সম্পূর্ণ হলো: ${settledYears.join(', ')}`);
  } else {
    parts.push('কোনো বছর সম্পূর্ণ হয়নি — সম্মতির অপেক্ষায় সারি আছে');
  }

  /**
   * ⚠️ পুরোনো/অচেনা সারি **মোছা হয় না**, শুধু দেখানো হয়। ২০২৪-এ ১৭ মার্চ ও
   *    ১৫ আগস্ট সরকারি ছুটি থেকে বাদ পড়েছে, অথচ আগের seed ওগুলো বসিয়ে গেছে —
   *    চলতি DB-তে ওরা এখনো কর্মদিবস কমিয়ে রাখছে। কোনটা ভুল আর কোনটা মালিকের
   *    নিজের যোগ করা ছুটি, সেটা এখান থেকে বোঝার উপায় নেই — তাই সিদ্ধান্তটা
   *    তাঁর, আমাদের নয়। ⭐ কিন্তু **না বলা**-টা সিদ্ধান্ত নয়, চেপে যাওয়া —
   *    তাই `run.notes` প্রতিবারই ফেরে, `run.create` খালি হলেও।
   */
  return {
    summary: parts.join(' · '),
    // ⚠️ তালিকা সম্পর্কে **স্থায়ী** কথা — এই রান কী করল, তার সাথে গুলিয়ে নয়
    standing: gazetteNotes(BD_HOLIDAYS),
    notes: run.notes,
  };
}

// ── 4 · কর্মী তালিকা ────────────────────────────────────────────────────────
//
// তালিকাটা `staff.local.json` থেকে আসে (gitignore করা) — নিচে দেখুন।
//
// ⚠️ `policySignedAt` ইচ্ছাকৃতভাবে ফাঁকা — কেউ এখনো monitoring policy-তে সই
//    করেনি। রোলআউটের আগে এটা পূরণ হওয়া বাধ্যতামূলক শর্ত, তাই আগেভাগে ভরে
//    রেখে শর্তটা অর্থহীন করে দেওয়া হয়নি।
//
// ⚠️ বেতন **শুধু owner** দেখতে পায় ([ADR-023](../../docs/05-Options-Decisions.md))।
//    ঘাটতির টাকা বের করতে লাগে। ম্যানেজারের রিপোর্টেও এই কলাম যায় না।

/**
 * ⭐ **আসল কর্মী তালিকা রিপোতে থাকে না** — `prisma/staff.local.json`-এ,
 * আর সেটা gitignore করা।
 *
 * ⚠️ কারণটা কোডের নয়, মানুষের: এই তালিকায় ১২ জনের **নাম ও বেতন** আছে,
 * আর ওটা তাঁদের তথ্য, আমাদের নয়। রিপো GitHub-এ গেলে — private হলেও —
 * সেটা তৃতীয় পক্ষের সার্ভারে চলে যায়, আর কাউকে collaborator করলে সে-ও
 * দেখে ফেলে। git-এর ইতিহাস থেকে কিছু মুছে ফেলাও কঠিন, তাই প্রথম থেকেই
 * বাইরে রাখা।
 *
 * ফাইলটা না থাকলে seed `staff.example.json` দিয়ে চলে (নমুনা নাম, বেতন ০)
 * — অর্থাৎ নতুন কেউ রিপো ক্লোন করলে প্রকল্পটা চলে, কিন্তু কারো বেতন
 * জানা যায় না।
 */
function loadStaff(): StaffRow[] {
  const local = join(__dirname, 'staff.local.json');
  const example = join(__dirname, 'staff.example.json');
  const file = existsSync(local) ? local : example;

  usingExample = file === example;

  if (usingExample) {
    console.warn(
      '⚠  staff.local.json নেই — staff.example.json দিয়ে seed হচ্ছে। ' +
        'আসল তালিকা বসাতে staff.local.json বানান।',
    );
  }

  /**
   * ⚠️ `as Staff[]` **ছিল একটা মিথ্যে** — JSON-এ যা-ই থাকুক TypeScript
   *    মেনে নিত। এখন সত্যিই যাচাই হয়, আর ভুল থাকলে কোন সারি ও কোন ঘর
   *    সেটা বার্তাতেই বলা থাকে।
   */
  return parseStaff(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * ⚠️⚠️ নমুনা তালিকা দিয়ে চলছি কি না — আর এই একটা bool-ই ১৪ আগস্টের
 *    আসল বাগটা ঠেকায়।
 *
 *    `staff.local.json` **gitignore করা**, তাই VPS-এ ওটা কোনোদিন থাকে না।
 *    ফলে সেখানে প্রতিবার seed চললেই `staff.example.json`-এর তিনজন নমুনা
 *    কর্মী (Example One/Two/Three, বেতন ০) তৈরি হতো — আর ওরা ঠিক এভাবেই
 *    প্রোডাকশনে ঢুকেছিল, দলের টার্গেটে ৬২৪ ঘণ্টা যোগ করে।
 */
let usingExample = false;

const STAFF: StaffRow[] = loadStaff();

/** designation থেকে বিভাগ — রিপোর্টে দল ধরে ভাগ করার জন্য (D09, E07)। */
function departmentOf(designation: string): string {
  if (designation === 'Manager') return 'Management';
  if (designation === 'Designer') return 'Design';
  if (designation === 'Researcher') return 'Research';
  return 'Intern';
}

async function seedEmployees(policyId: number): Promise<number> {
  /**
   * ⭐⭐ **আসল কর্মী থাকলে নমুনা কর্মী আর বসানো হয় না।**
   *
   * ⚠️ নিয়মটা সরু করে লেখা: শুধু **নমুনা** তালিকার বেলায়, আর শুধু
   *    ডাটাবেসে ইতিমধ্যে কেউ থাকলে। `staff.local.json` থাকলে seed আগের
   *    মতোই সব বসায় — আসল তালিকা হালনাগাদ করার পথটা বন্ধ হয় না।
   *
   * ⭐ যুক্তিটা সহজ: চালু সিস্টেমে নমুনা মানুষ যোগ করার কোনো কারণ নেই।
   *    ওরা কেবল দলের টার্গেট ফোলায়, বোর্ডে ভিড় করে, আর "পিছিয়ে" সংখ্যাটা
   *    মিথ্যা বানায় — অথচ কারো এক মিনিটও কাজ নেই।
   *
   * ⚠️ নতুন ইনস্টলে (ডাটাবেস খালি) নমুনাগুলো আগের মতোই বসে, নইলে কেউ
   *    রিপো ক্লোন করে প্রকল্পটা চালিয়েই দেখতে পারত না।
   */
  const already = await prisma.employee.count();
  if (!shouldSeedSampleStaff(usingExample, already)) {
    console.warn(
      `⚠  ${already} জন কর্মী ইতিমধ্যেই আছেন — নমুনা তালিকা বসানো হলো না। ` +
        'আসল তালিকা বসাতে prisma/staff.local.json বানান।',
    );
    return 0;
  }

  for (const { empCode, joinedOn, ...rest } of STAFF) {
    const common = {
      ...rest,
      department: departmentOf(rest.designation),
      policyId,
      /**
       * ⚠️⚠️ তারিখ **না দিলে ঘরটা ছোঁয়া হয় না** (`undefined`), `null`
       * বসানো হয় না। কেউ ড্যাশবোর্ডে হাতে তারিখ বসিয়ে থাকলে seed আবার
       * চালালে সেটা মুছে যেত — আর তার সাথে G37-এর proration-ও, নীরবে।
       */
      ...(joinedOn ? { joinedOn } : {}),
    };

    await prisma.employee.upsert({
      where: { empCode },
      // ⚠️ update-এ status নেই — কেউ ছেড়ে গেলে seed আবার চালালে তাকে
      //    জীবিত করে তোলা হবে না।
      update: common,
      create: { empCode, ...common },
    });
  }
  return STAFF.length;
}

// ── 5 · owner account ───────────────────────────────────────────────────────

async function seedOwner(): Promise<string> {
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@oxeio.local';
  const password = process.env.SEED_OWNER_PASSWORD;
  const fullName = process.env.SEED_OWNER_NAME ?? 'oXeio Owner';

  if (!password) {
    throw new Error(
      'SEED_OWNER_PASSWORD সেট করা নেই। .env-এ বসিয়ে আবার চালান — ' +
        'ডিফল্ট পাসওয়ার্ড বসানো হয় না, ইচ্ছাকৃতভাবে।',
    );
  }

  const passwordHash = await hash(password);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      fullName,
      role: UserRole.owner,
      // প্রথম লগইনেই বদলাতে হবে — seed পাসওয়ার্ড .env-এ প্লেইনটেক্সটে থাকে
      mustChangePw: true,
    },
  });

  return email;
}

// ── run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const policyId = await seedWorkPolicy();
  const rules = await seedAppCategories();
  const holidays = await seedHolidays();
  const staff = await seedEmployees(policyId);
  const ownerEmail = await seedOwner();

  console.log('✅ seed সম্পূর্ণ');
  console.log(`   work policy   : #${policyId} · ২০৮ ঘণ্টা/মাস · ছবি ০৭:০০–২৩:০০`);
  console.log(`   app categories: ${rules}টি রুল`);
  console.log(`   holidays      : ${holidays.summary}`);
  console.log(
    '                   ⚠️ "(সম্ভাব্য)" লেখা তারিখগুলো চাঁদ/তিথি-নির্ভর — ঘোষণা এলে ঠিক করে নিন',
  );
  // ⚠️ তালিকা সম্পর্কে স্থায়ী কথা আগে, তারপর এই রান কী করল
  for (const note of [...holidays.standing, ...holidays.notes]) {
    console.log(`                   ${note}`);
  }
  console.log(`   কর্মী          : ${staff} জন — কারো policy সই করা নেই, রোলআউটের আগে দরকার`);
  console.log(`   owner         : ${ownerEmail} (প্রথম লগইনে পাসওয়ার্ড বদলাতে হবে)`);
}

main()
  .catch((e: unknown) => {
    console.error('❌ seed ব্যর্থ:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
