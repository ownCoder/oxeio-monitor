/* eslint-disable */
/**
 * স্ক্রিনশট দেখানোর জন্য নমুনা ডেটা — **সাময়িক**।
 *
 * ⚠️ এটা seed নয়, আর কখনো প্রোডাকশনে চালানোর জিনিস নয়। উদ্দেশ্য একটাই:
 * খালি ড্যাশবোর্ডে থিম আর লেআউট বিচার করা যায় না, তাই কিছুক্ষণের জন্য
 * বাস্তবের মতো ডেটা বসানো।
 *
 * ⭐ **যা বসায় তার প্রতিটা সারির id একটা manifest ফাইলে লিখে রাখে**, আর
 * `--undo` দিলে ঠিক সেগুলোই মোছে। "আজকের সব ডেটা মুছে দাও" জাতীয় ঝাড়ু
 * চালানো হয় না — তাতে আসল ডেটাও চলে যেত, আর এই ডাটাবেসে ইতিমধ্যেই
 * আসল এজেন্টের পরীক্ষার ডেটা আছে।
 *
 *   node scripts/sample-data.cjs          # বসাও
 *   node scripts/sample-data.cjs --undo   # ঠিক সেগুলোই মোছো
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const MANIFEST = path.join(__dirname, '.sample-data.json');
const DHAKA_MS = 6 * 3600_000;
const HOUR = 3600;

/** ⚠️ বীজ দেওয়া PRNG — প্রতিবার একই ডেটা, নইলে দুটো স্ক্রিনশট মেলানো যেত না */
let seed = 20260811;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const workDateOf = (d) => {
  const s = new Date(d.getTime() + DHAKA_MS);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
};
/** ঢাকার ওই তারিখে ওই ঘণ্টা, UTC instant হিসেবে */
const at = (workDate, hour, min = 0) =>
  new Date(workDate.getTime() - DHAKA_MS + hour * 3600_000 + min * 60_000);

/** ⚠️ শুক্রবার সাপ্তাহিক ছুটি (policy.weeklyOffDay = 5) */
const isFriday = (workDate) => workDate.getUTCDay() === 5;

// প্রতিটি কর্মীর চরিত্র — কেউ এগিয়ে, কেউ পিছিয়ে। সব একরকম হলে
// রঙের তারতম্য দেখাই যেত না, আর হিটম্যাপ বিচার করা যেত না।
const PROFILE = {
  'OX-01': { hours: 8.4, today: 6.4, state: 'active' },
  'OX-02': { hours: 7.6, today: 5.1, state: 'active' },
  'OX-03': { hours: 8.9, today: 3.2, state: 'idle' },
  'OX-04': { hours: 8.1, today: 7.9, state: 'active' },
  'OX-05': { hours: 6.2, today: 1.2, state: 'offline' },
  'OX-06': { hours: 7.9, today: 8.3, state: 'active' },
  'OX-07': { hours: 8.6, today: 8.2, state: 'active' },
  'OX-08': { hours: 5.4, today: 0, state: 'agent_down' },
  'OX-09': { hours: 7.1, today: 4.6, state: 'idle' },
  'OX-10': { hours: 6.8, today: 2.9, state: 'offline' },
  'OX-11': { hours: 7.4, today: 6.1, state: 'active' },
  'OX-12': { hours: 4.9, today: 0.4, state: 'offline' },
};

const APPS = [
  ['code.exe', 'Visual Studio Code', null, false],
  ['chrome.exe', 'Google Chrome', 'github.com', true],
  ['chrome.exe', 'Google Chrome', 'docs.google.com', true],
  ['chrome.exe', 'Google Chrome', 'youtube.com', true],
  ['chrome.exe', 'Google Chrome', 'facebook.com', true],
  ['EXCEL.EXE', 'Microsoft Excel', null, false],
  ['photoshop.exe', 'Adobe Photoshop', null, false],
  ['chrome.exe', 'Google Chrome', 'figma.com', true],
];

async function insert() {
  if (fs.existsSync(MANIFEST)) {
    console.error('⚠ আগের নমুনা ডেটা এখনো বসানো আছে। আগে --undo চালান।');
    process.exit(1);
  }

  // ⚠️ আগের কোনো রান মাঝপথে ভেঙে থাকলে তার সারি পড়ে থাকে, আর তখন
  //    unique constraint-এ পরের রানও ভাঙে। `sample-` চিহ্ন ধরে সেগুলো
  //    আগেই সরিয়ে নেওয়া হয় — শুধু নিজের বানানো, আসল কিছু নয়।
  const stale = await prisma.device.findMany({
    where: { machineGuid: { startsWith: "sample-" } },
    select: { id: true },
  });
  if (stale.length > 0) {
    const ids = stale.map((d) => d.id);
    await prisma.appUsage.deleteMany({ where: { deviceId: { in: ids } } });
    await prisma.activitySegment.deleteMany({ where: { deviceId: { in: ids } } });
    await prisma.workSession.deleteMany({ where: { deviceId: { in: ids } } });
    await prisma.device.deleteMany({ where: { id: { in: ids } } });
    console.log(`(আগের অসম্পূর্ণ রানের ${ids.length}টি ডিভাইস সরানো হলো)`);
  }

  const made = { devices: [], sessions: [], segments: [], summaries: [], appUsage: [] };

  const staff = await prisma.employee.findMany({
    where: { empCode: { in: Object.keys(PROFILE) } },
    orderBy: { empCode: 'asc' },
  });
  if (staff.length === 0) throw new Error('কোনো কর্মী পাওয়া গেল না — seed চালানো আছে তো?');

  const now = new Date();
  const today = workDateOf(now);

  // গত ১৪ দিন (আজসহ)
  const days = [];
  for (let i = 13; i >= 0; i--) {
    days.push(new Date(today.getTime() - i * 86_400_000));
  }

  for (const e of staff) {
    const p = PROFILE[e.empCode];

    // ── ডিভাইস ─────────────────────────────────────────────────────────
    // ⚠️ স্ট্যাটাসের বৈচিত্র্য আসে lastSeenAt থেকে: ৯০ সে.-এর বেশি চুপ →
    //    offline, ১০ মি.-এর বেশি → agent_down (dashboard.math.ts)
    const seenAgo =
      p.state === 'agent_down' ? 42 * 60_000
      : p.state === 'offline' ? 6 * 60_000
      : 20_000;

    const device = await prisma.device.create({
      data: {
        hostname: `OFFICE-${e.empCode.slice(3)}`,
        windowsUsername: e.fullName.split(' ')[0].toLowerCase(),
        employeeId: e.id,
        machineGuid: `sample-${e.empCode}-${randomUUID().slice(0, 8)}`,
        osVersion: 'Windows 11 Pro 26200',
        agentVersion: '0.1.1',
        tokenHash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
        monitors: 1 + (rnd() > 0.7 ? 1 : 0),
        lastSeenAt: new Date(now.getTime() - seenAgo),
        lastState: p.state === 'idle' ? 'idle' : p.state === 'active' ? 'active' : 'idle',
        lastStateAt: new Date(now.getTime() - seenAgo),
      },
    });
    made.devices.push(device.id);

    // ── প্রতিদিন ────────────────────────────────────────────────────────
    for (const day of days) {
      if (isFriday(day)) continue;

      const isToday = day.getTime() === today.getTime();
      const target = isToday ? p.today : Math.max(0, p.hours + (rnd() - 0.5) * 2.4);
      if (target < 0.2) continue;

      const workedSec = Math.round(target * HOUR);
      const startHour = 9 + Math.floor(rnd() * 2);
      const startedAt = at(day, startHour, Math.floor(rnd() * 50));

      const session = await prisma.workSession.create({
        data: {
          employeeId: e.id,
          deviceId: device.id,
          workDate: day,
          startedAt,
          endedAt: isToday ? null : new Date(startedAt.getTime() + (workedSec + 3600) * 1000),
          endReason: isToday ? null : 'logoff',
        },
      });
      made.sessions.push(session.id.toString());

      // ⚠️ সেগমেন্ট ৫ মিনিটের টুকরোয় — এজেন্ট এভাবেই পাঠায় (G53)
      let cursor = startedAt;
      let left = workedSec;
      let idleSec = 0;

      while (left > 0) {
        const chunk = Math.min(left, 300);
        const seg = await prisma.activitySegment.create({
          data: {
            sessionId: session.id,
            employeeId: e.id,
            deviceId: device.id,
            clientUuid: randomUUID(),
            workDate: day,
            state: 'active',
            startedAt: cursor,
            endedAt: new Date(cursor.getTime() + chunk * 1000),
            durationSec: chunk,
            inputScore: 40 + Math.floor(rnd() * 60),
            countsAsWork: true,
          },
        });
        made.segments.push(seg.id.toString());
        cursor = new Date(cursor.getTime() + chunk * 1000);
        left -= chunk;

        // মাঝেমধ্যে নিষ্ক্রিয়তা — টাইমলাইনে রঙের তারতম্য দেখাতে
        if (left > 0 && rnd() > 0.78) {
          const gap = 120 + Math.floor(rnd() * 600);
          const idle = await prisma.activitySegment.create({
            data: {
              sessionId: session.id,
              employeeId: e.id,
              deviceId: device.id,
              clientUuid: randomUUID(),
              workDate: day,
              state: 'idle',
              startedAt: cursor,
              endedAt: new Date(cursor.getTime() + gap * 1000),
              durationSec: gap,
              countsAsWork: false,
            },
          });
          made.segments.push(idle.id.toString());
          cursor = new Date(cursor.getTime() + gap * 1000);
          idleSec += gap;
        }
      }

      // ── daily_summary ───────────────────────────────────────────────
      // ⚠️ রিপোর্ট ও মাসিক হিটম্যাপ **এখান থেকেই** পড়ে, সেগমেন্ট থেকে নয়।
      //    তাই সংখ্যাগুলো উপরের সেগমেন্টের সাথে মিলিয়ে বসানো — নইলে দুই
      //    পাতা দুই কথা বলত, আর সেটাই তো গতকাল বাগ হিসেবে ধরা পড়েছে।
      const productive = Math.round(workedSec * (0.55 + rnd() * 0.35));
      const unproductive = Math.round(workedSec * (0.05 + rnd() * 0.15));

      // ⚠️ `create` নয় — K06 rollup জব প্রতি ১৫ মিনিটে চলে আর নিজেই
      //    সারি বানায়, ফলে দ্বিতীয়বার চালালে unique constraint ভাঙত।
      //    undo-তে এগুলো মুছে দিলেই হয়: জব পরের রানে সেগমেন্ট থেকে
      //    আবার সঠিক সারি বানিয়ে নেবে।
      const figures = {
        firstActivityAt: startedAt,
        lastActivityAt: cursor,
        activeSec: workedSec,
        idleSec,
        workedSec,
        adjustmentSec: 0,
        creditedSec: workedSec,
        earliestHour: startHour,
        latestHour: Math.min(23, startHour + Math.ceil(target) + 1),
        productiveSec: productive,
        unproductiveSec: unproductive,
        productivityPct: Math.round((productive / workedSec) * 10000) / 100,
        screenshotCount: Math.floor(target * 12),
        dayType: 'worked',
      };

      const s = await prisma.dailySummary.upsert({
        where: { employeeId_workDate: { employeeId: e.id, workDate: day } },
        update: figures,
        create: { employeeId: e.id, workDate: day, ...figures },
      });
      made.summaries.push([s.employeeId, s.workDate.toISOString().slice(0, 10)]);

      // ── app_usage (শুধু শেষ ৩ দিন — টপ ১০ প্যানেল ভরাতে যথেষ্ট) ─────
      if (day.getTime() >= today.getTime() - 2 * 86_400_000) {
        let apCursor = startedAt;
        for (let i = 0; i < 6; i++) {
          const [proc, appName, domain, isBrowser] = APPS[Math.floor(rnd() * APPS.length)];
          const dur = 300 + Math.floor(rnd() * 2400);
          const au = await prisma.appUsage.create({
            data: {
              employeeId: e.id,
              deviceId: device.id,
              clientUuid: randomUUID(),
              workDate: day,
              startedAt: apCursor,
              endedAt: new Date(apCursor.getTime() + dur * 1000),
              durationSec: dur,
              processName: proc,
              appName,
              domain,
              isBrowser,
            },
          });
          made.appUsage.push(au.id.toString());
          apCursor = new Date(apCursor.getTime() + dur * 1000);
        }
      }
    }
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(made, null, 1));
  console.log(
    `✅ নমুনা ডেটা বসানো হলো — ${made.devices.length} ডিভাইস · ` +
      `${made.sessions.length} সেশন · ${made.segments.length} সেগমেন্ট · ` +
      `${made.summaries.length} দৈনিক সারাংশ · ${made.appUsage.length} অ্যাপ-ব্যবহার`,
  );
  console.log(`   manifest: ${MANIFEST}`);
  console.log('   মুছতে: node scripts/sample-data.cjs --undo');
}

async function undo() {
  if (!fs.existsSync(MANIFEST)) {
    console.log('manifest নেই — মোছার কিছু নেই।');
    return;
  }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  // ⚠️ ক্রমটা নির্ভরতার উল্টো দিকে — নইলে foreign key আটকাবে
  const au = await prisma.appUsage.deleteMany({
    where: { id: { in: m.appUsage.map(BigInt) } },
  });
  for (const [employeeId, date] of m.summaries) {
    await prisma.dailySummary.deleteMany({
      where: { employeeId, workDate: new Date(`${date}T00:00:00.000Z`) },
    });
  }
  const seg = await prisma.activitySegment.deleteMany({
    where: { id: { in: m.segments.map(BigInt) } },
  });
  const ses = await prisma.workSession.deleteMany({
    where: { id: { in: m.sessions.map(BigInt) } },
  });
  const dev = await prisma.device.deleteMany({ where: { id: { in: m.devices } } });

  fs.unlinkSync(MANIFEST);
  console.log(
    `🧹 মুছে ফেলা হলো — ${dev.count} ডিভাইস · ${ses.count} সেশন · ` +
      `${seg.count} সেগমেন্ট · ${m.summaries.length} সারাংশ · ${au.count} অ্যাপ-ব্যবহার`,
  );
}

(async () => {
  try {
    if (process.argv.includes('--undo')) await undo();
    else await insert();
  } finally {
    await prisma.$disconnect();
  }
})();
