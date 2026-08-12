/**
 * ⭐⭐ **owner-lockout — ফেরার একমাত্র পথ।**
 *
 * ⚠️ এই সিস্টেমে "পাসওয়ার্ড ভুলে গেছি" বলে কোনো ইমেইল-লিংক নেই, আর সেটা
 * ইচ্ছাকৃত: অফিসের ভেতরের সার্ভার, বাইরের কোনো মেইল-নির্ভরতা রাখা হয়নি।
 * কিন্তু তার ফল ছিল একটা **নিঃশব্দ ফাঁদ** — একমাত্র owner পাসওয়ার্ড (বা
 * 2FA-র ফোনটা) হারালে গোটা সিস্টেমে ঢোকার আর কোনো উপায় থাকত না। কর্মীদের
 * ঘণ্টা জমা হতেই থাকত, অথচ কেউ দেখতে পারত না, বেতনের হিসাবও বের করা যেত না।
 *
 * ⚠️ `prisma/seed.ts` দিয়েও ফেরা যায় না — সেখানে owner `upsert` হয়
 * `update: {}` দিয়ে, অর্থাৎ অ্যাকাউন্ট আগে থেকে থাকলে পাসওয়ার্ড অক্ষত
 * থাকে। seed-এর জন্য ওটাই ঠিক (বারবার চলে), কিন্তু বিপদের দিনে অচল।
 *
 * ── কীভাবে চালাতে হয় ────────────────────────────────────────────────────
 *
 * সার্ভারে (কন্টেইনারে — সত্যিকারের বিপদের দিনে এভাবেই লাগবে):
 *
 *   docker compose exec api node dist/scripts/recover-owner.js --list
 *   docker compose exec api node dist/scripts/recover-owner.js --confirm
 *
 * ডেভ মেশিনে:
 *
 *   npm run recover:owner -- --list
 *   npm run recover:owner -- --confirm --email owner@office.local
 *
 * ⚠️⚠️ ফাইলটা `src/`-এর ভেতরে, `scripts/`-এ নয় — **ইচ্ছাকৃতভাবে**।
 * প্রোডাকশনের ইমেজে শুধু `dist/` আর prod-deps যায়; `tsx` সেখানে নেই আর
 * `scripts/` ফোল্ডারটাও কপি হয় না। বাইরে রাখলে স্ক্রিপ্টটা ঠিক সেই
 * মেশিনেই অচল থাকত যেখানে ওটা একমাত্র কাজে লাগে। `src/`-এ থাকায়
 * `nest build` এটাকেও কম্পাইল করে, আর কেউ import না করায় সার্ভার চালু
 * হওয়ার সময় এটা কখনো চলে না।
 *
 * ⚠️ চালাতে হলে সার্ভারের শেলে পৌঁছাতে হয় — অর্থাৎ যার ডাটাবেসে হাত আছে
 * সে এমনিতেই সব পারে। এই স্ক্রিপ্ট নতুন কোনো ফাঁক তৈরি করে না; শুধু
 * ইতিমধ্যেই থাকা ক্ষমতাটা **অডিট করা** ও নিরাপদ একটা পথে আনে।
 *
 * ⚠️ পাসওয়ার্ড কমান্ড-লাইনে **নেওয়া হয় না**, বানিয়ে দেওয়া হয়। আর্গুমেন্টে
 * নিলে সেটা শেলের ইতিহাসে আর `ps` তালিকায় থেকে যেত, আর মানুষ প্রায়ই
 * দুর্বল কিছু বসাত।
 *
 * সিদ্ধান্তগুলো এখানে নয় — `src/auth/owner-recovery.ts`-এ, যাতে টেস্ট
 * করা যায়। এই ফাইলে শুধু argv আর পর্দা।
 */
import { PrismaClient } from '@prisma/client';

import { listOwners, recoverOwner } from '../auth/owner-recovery';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const next = index >= 0 ? process.argv[index + 1] : undefined;
  return next !== undefined && !next.startsWith('--') ? next : undefined;
}

const has = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  if (has('list')) {
    const owners = await listOwners(prisma);

    if (owners.length === 0) {
      console.log('কোনো owner অ্যাকাউন্ট নেই।');
      return;
    }

    console.log(`${owners.length}টি owner অ্যাকাউন্ট:\n`);
    for (const o of owners) {
      const seen = o.lastLoginAt?.toISOString().slice(0, 16) ?? 'কখনো ঢোকেনি';
      console.log(
        `  #${o.id}  ${o.email}  (${o.fullName})  · ` +
          `${o.isActive ? 'সক্রিয়' : 'নিষ্ক্রিয়'} · ` +
          `${o.hasTwoFactor ? '2FA চালু' : '2FA নেই'} · শেষ লগইন ${seen}`,
      );
    }
    return;
  }

  /**
   * ⚠️ `--confirm` ছাড়া কিছুই বদলায় না। এটা এমন কাজ নয় যা ভুল করে চালানো
   * যায় — চললে আগের পাসওয়ার্ডটা **চিরতরে যায়**, আর owner তখন লগইন করতে
   * গিয়ে হঠাৎ আটকে যেতেন, কারণ না জেনেই।
   */
  if (!has('confirm')) {
    console.error(
      'কিছুই বদলানো হয়নি।\n\n' +
        'এই স্ক্রিপ্ট owner-এর পাসওয়ার্ড **বদলে দেয়** (আগেরটা আর কাজ করবে না),\n' +
        'আর 2FA থাকলে সেটাও সরিয়ে দেয়। নিশ্চিত হলে `--confirm` দিন।\n\n' +
        'আগে দেখে নিন কোন কোন অ্যাকাউন্ট আছে: `--list`\n',
    );
    process.exitCode = 2;
    return;
  }

  const result = await recoverOwner(prisma, {
    email: arg('email'),
    fullName: arg('name'),
  });

  if (!result.ok) {
    console.error(`\n${result.detail}\n`);
    if (result.reason === 'no-owner-no-email') {
      console.error('  … --confirm --email owner@office.local [--name "নাম"]\n');
    } else {
      console.error('  … --list  দিয়ে দেখে নিন\n');
    }
    // ⚠️ আলাদা exit code — স্ক্রিপ্টটা কোনো রানবুকে বসলে যেন "কী ভুল হলো"
    //    প্রশ্নের উত্তর আউটপুট না পড়েও পাওয়া যায়।
    process.exitCode = result.reason === 'no-owner-no-email' ? 3 : 4;
    return;
  }

  console.log(
    `\n✅ ${result.kind === 'created' ? 'নতুন owner অ্যাকাউন্ট তৈরি হলো' : 'পাসওয়ার্ড রিসেট হলো'}\n`,
  );
  console.log(`   ইমেইল    : ${result.email}`);
  console.log(`   পাসওয়ার্ড : ${result.password}\n`);
  console.log('⚠️ এই পাসওয়ার্ড আর কোথাও লেখা নেই — এখনই ব্যবহার করুন।');
  console.log('⚠️ প্রথম লগইনেই নতুন পাসওয়ার্ড চাওয়া হবে।');
  if (result.clearedTwoFactor) {
    console.log('⚠️ 2FA সরিয়ে দেওয়া হয়েছে — ঢুকে আবার চালু করে নিন।');
  }
  console.log('');
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
