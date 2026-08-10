/**
 * oXeio — seed data
 *
 *   1. Work policy   — মাসিক ২০৮ ঘণ্টা, শুক্র সাপ্তাহিক ছুটি, ছবি ০৭:০০–২৩:০০
 *   2. App categories — productive / neutral / unproductive রুল
 *   3. Holidays      — শুধু নির্দিষ্ট তারিখের জাতীয় ছুটি (নিচের নোট দেখুন)
 *   4. Owner account — .env-এর SEED_OWNER_* থেকে
 *
 * বারবার চালানো নিরাপদ — সব কিছু upsert।
 */
import { hash } from '@node-rs/argon2';
import { MatchType, PrismaClient, Productivity, UserRole } from '@prisma/client';

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
// ⚠️ শুধু **নির্দিষ্ট তারিখের** জাতীয় ছুটি এখানে আছে।
//    ঈদ, শবে বরাত, দুর্গাপূজা, বুদ্ধ পূর্ণিমা ইত্যাদি চান্দ্র/পঞ্জিকা-নির্ভর —
//    সেগুলোর তারিখ প্রতি বছর সরকারি প্রজ্ঞাপনে আসে। অনুমান করে বসানো হয়নি,
//    কারণ ভুল তারিখ pace-এর কর্মদিবস হিসাব নষ্ট করবে (§ ২.১-খ)।
//    → Settings → Holidays থেকে প্রজ্ঞাপন দেখে যোগ করে নিতে হবে (open question O2)।

const FIXED_HOLIDAYS_2026: Array<[string, string]> = [
  ['2026-02-21', 'আন্তর্জাতিক মাতৃভাষা দিবস'],
  ['2026-03-17', 'জাতির পিতার জন্মদিন'],
  ['2026-03-26', 'স্বাধীনতা দিবস'],
  ['2026-05-01', 'মে দিবস'],
  ['2026-08-15', 'জাতীয় শোক দিবস'],
  ['2026-12-16', 'বিজয় দিবস'],
  ['2026-12-25', 'বড়দিন'],
];

async function seedHolidays(): Promise<number> {
  for (const [date, name] of FIXED_HOLIDAYS_2026) {
    const holidayDate = new Date(`${date}T00:00:00.000Z`);
    await prisma.holiday.upsert({
      where: { holidayDate },
      update: { name },
      create: { holidayDate, name, type: 'public' },
    });
  }
  return FIXED_HOLIDAYS_2026.length;
}

// ── 4 · কর্মী তালিকা ────────────────────────────────────────────────────────
//
// অফিসের বর্তমান ১২ জন। emp_code দেওয়া হয়েছে তালিকার ক্রম অনুযায়ী।
//
// ⚠️ `policySignedAt` ইচ্ছাকৃতভাবে ফাঁকা — কেউ এখনো monitoring policy-তে সই
//    করেনি। রোলআউটের আগে এটা পূরণ হওয়া বাধ্যতামূলক শর্ত, তাই আগেভাগে ভরে
//    রেখে শর্তটা অর্থহীন করে দেওয়া হয়নি।
//
// ⚠️ বেতন এখানে **রাখা হয়নি**। এটা সময়-ট্র্যাকিং সিস্টেম, পে-রোল সিস্টেম নয় —
//    F03 ঘণ্টার শিট বানায়, টাকার হিসাব নয়। বেতন রাখতে হলে আলাদা সিদ্ধান্ত,
//    owner-only অ্যাক্সেস আর একটা ADR লাগবে (09-Build-Log § ৪ দেখুন)।

type Staff = [code: string, name: string, designation: string];

const STAFF: Staff[] = [
  ['OX-01', 'Ali', 'Researcher'],
  ['OX-02', 'Asa', 'Designer'],
  ['OX-03', 'Belal', 'Manager'],
  ['OX-04', 'Hafiz', 'Designer'],
  ['OX-05', 'Mariya', 'Designer'],
  ['OX-06', 'Sadia', 'Designer'],
  ['OX-07', 'Sumaiya', 'Researcher'],
  ['OX-08', 'Saiful', 'Intern'],
  ['OX-09', 'Shovon', 'Intern'],
  ['OX-10', 'Istiaq', 'Intern'],
  ['OX-11', 'Razu', 'Intern'],
  ['OX-12', 'Karim', 'Intern'],
];

/** designation থেকে বিভাগ — রিপোর্টে দল ধরে ভাগ করার জন্য (D09, E07)। */
function departmentOf(designation: string): string {
  if (designation === 'Manager') return 'Management';
  if (designation === 'Designer') return 'Design';
  if (designation === 'Researcher') return 'Research';
  return 'Intern';
}

async function seedEmployees(policyId: number): Promise<number> {
  for (const [empCode, fullName, designation] of STAFF) {
    await prisma.employee.upsert({
      where: { empCode },
      // ⚠️ update-এ status নেই — কেউ ছেড়ে গেলে seed আবার চালালে তাকে
      //    জীবিত করে তোলা হবে না।
      update: { fullName, designation, department: departmentOf(designation), policyId },
      create: {
        empCode,
        fullName,
        designation,
        department: departmentOf(designation),
        policyId,
      },
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
  console.log(`   holidays      : ${holidays}টি (শুধু নির্দিষ্ট তারিখের — বাকিগুলো হাতে যোগ করুন)`);
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
