import type { Digest, DigestRow } from './digest.math';

/**
 * **দৈনিক রিপোর্ট — টেলিগ্রামের নিজস্ব চেহারা** *(১৮ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ **কেন ইমেইলের লেখাটা এখানে চলে না।** এতদিন টেলিগ্রামে ইমেইলের বডি
 * **হুবহু** যেত — সব কর্মীর এক লম্বা তালিকা, তারপর "পিছিয়ে", তারপর আট
 * লাইনের *"How to read these numbers"*। ইমেইলে ওটা ঠিক (পড়া হয় বসে, একবার),
 * ফোনে নয়: গোটাটা একটা ধূসর দেয়াল, আর মালিকের আসল প্রশ্ন দুটো —
 * *"কে কত ঘণ্টা করল"* আর *"কে টার্গেট ছুঁল"* — ওর ভেতরে হারিয়ে যেত।
 *
 * ⭐ **তাই দল করে সাজানো**, মালিকের বাছাই অনুযায়ী: টার্গেট ছুঁয়েছেন → ছোঁননি
 * → আজ কিছুই করেননি → আজ ছুটি → মাসে পিছিয়ে। প্রশ্নটার উত্তর **না পড়েই**
 * দেখা যায়, কারণ প্রতিটা শিরোনামের পাশে সংখ্যা আছে।
 *
 * ⚠️⚠️ **ঘণ্টা ধরে সাজানো হয় না, কখনো।** সবাইকে ঘণ্টার ক্রমে বসালে এটা রোজ
 * সন্ধ্যায় একটা **লিডারবোর্ড** হয়ে উঠত — আর সেটা README-র "কখনোই নয়"
 * তালিকায় আছে। প্রতিটা দলের ভেতরে ক্রম **কর্মী-কোড ধরে**, ঠিক যেমন
 * রিপোর্টে ([10 § R22 নোট](../../../../docs/10-Roadmap.md))।
 *
 * ⚠️ এখানেও **কোনো অ্যাপ, ডোমেইন বা স্ক্রিনশট নেই** — শুধু ঘণ্টা।
 * `digest.math.ts`-এর নিয়মটাই বহাল: টেলিগ্রাম বার্তা ফরওয়ার্ড হয়।
 */

/** `7.02` → `7h 01m`। ⚠️ দশমিক ঘণ্টা ফোনে পড়ে কেউ মিনিটে রূপান্তর করেন না */
export function hm(hours: number): string {
  const total = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;

  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * ⭐⭐ **সংখ্যা আগে, নাম পরে** — আর এটা সাজসজ্জা নয়।
 *
 * ⚠️ নাম আগে বসালে কলামটা নামের দৈর্ঘ্য ধরে নড়ত ("Saifur" বনাম "Sk Nasif
 * Iqbal Shovon"), তাই সংখ্যাগুলো আর এক লাইনে থাকত না — অথচ **চোখ বুলিয়ে
 * সংখ্যা তুলনা করাই** এই বার্তার একমাত্র কাজ। ⭐ সংখ্যা আগে রাখলে লাইনের
 * দৈর্ঘ্যও ছোট থাকে (সর্বোচ্চ ~৩২ অক্ষর), তাই সরু ফোনেও ভাঁজ পড়ে না।
 */
function line(row: DigestRow, showDelta = false): string {
  const worked = hm(row.todayHours).padStart(7);

  if (!showDelta) return `  ${worked}  ${row.fullName}`;

  const gap = row.todayHours - row.todayTargetHours;
  // ⚠️ U+2212 (মাইনাস), হাইফেন নয় — হাইফেন সংখ্যার পাশে ড্যাশের মতো দেখায়
  const delta = `${gap < 0 ? '−' : '+'}${hmShort(gap)}`.padStart(7);

  return `  ${worked} ${delta}  ${row.fullName}`;
}

/**
 * ⚠️⚠️ **এক ঘণ্টার কম হলে শুধু মিনিট** — `0h 59m` নয়, `59m`।
 *
 * সাজসজ্জা নয়, **জায়গার হিসাব**: সবচেয়ে লম্বা নামটা ২১ অক্ষর
 * ("Sk Nasif Iqbal Shovon"), আর তিন অক্ষর বাঁচালে গোটা লাইনটা ৪০-এর
 * ভেতরে থাকে। ⚠️ না বাঁচালে ৪১ হতো, আর সরু ফোনে ভাঁজ পড়ে কলামগুলোই
 * ভেঙে যেত — তখন monospace রাখার পুরো কারণটাই বৃথা। (এটা টেস্টে ধরা
 * পড়েছে, চোখে নয়।)
 */
function hmShort(hours: number): string {
  const total = Math.round(Math.abs(hours) * 60);
  if (total < 60) return `${total}m`;

  return hm(hours);
}

export interface DigestExtras {
  /**
   * আজ কর্মঘণ্টায় যতগুলো PC চুপ ছিল।
   *
   * ⚠️⚠️ এই এক লাইনটাই `agent_down` অ্যালার্টের **গোটা টেলিগ্রাম উপস্থিতি**
   * *(১৮ আগস্ট)*। আগে প্রতিটা নীরবতা আলাদা বার্তা হয়ে যেত — গত ২৪ ঘণ্টায়
   * মাপা হয়েছে **৩৯টা**, সপ্তাহে ১৬৮টা। মালিকের কথায়: *"ami ei type er
   * alart gula chaina"*। ⭐ অ্যালার্টগুলো মুছে ফেলা হয়নি, Alerts পাতায়
   * আছে; শুধু ফোনে রোজকার বন্যাটা থামানো হয়েছে।
   */
  silentPcs: number;
  /** পাঠানোর সময় (ঢাকা), যেমন `18:30` — সংখ্যাগুলো কোন মুহূর্তের সেটা বলে */
  atTime: string;
}

/**
 * ⚠️ `parse_mode: 'HTML'`-এ পাঠানো হয় বলে **তিনটে অক্ষর escape করতেই হবে**।
 * কর্মীর নামে `&` থাকা অস্বাভাবিক নয় (`Ali & Co` ধাঁচের নাম), আর একটা
 * unescaped `<` গোটা বার্তাটাকে ৪০০ করে দিত — অর্থাৎ **সেদিনের রিপোর্টই
 * যেত না**।
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * ⭐ কর্মী-কোড ধরে — `Digest.rows` এমনিতেই ওই ক্রমে, তাই এখানে আর সাজানো
 * হয় না। ⚠️ নতুন করে sort করলে সেটাই হতো ঘণ্টা-ক্রমে সাজিয়ে ফেলার
 * প্রথম সুযোগ।
 */
function pick(rows: readonly DigestRow[], test: (r: DigestRow) => boolean) {
  return rows.filter(test);
}

export function telegramDigest(
  digest: Digest,
  orgName: string,
  extras: DigestExtras,
): string {
  const { rows, totals } = digest;

  const off = pick(rows, (r) => r.offToday);
  const working = pick(rows, (r) => !r.offToday);
  const met = pick(working, (r) => r.todayHours >= r.todayTargetHours);
  const under = pick(working, (r) => r.todayHours > 0 && r.todayHours < r.todayTargetHours);
  const none = pick(working, (r) => r.todayHours === 0);

  /** ⚠️ প্রতিদিনের টার্গেট সবার এক নয় (ছুটি, যোগদানের তারিখ) — তাই যেটা
   *  সবচেয়ে বেশিবার এসেছে সেটাই দেখানো হয়, আর কেউ না থাকলে কিছুই নয় */
  const target = working.length > 0 ? working[0].todayTargetHours : 0;

  const out: string[] = [
    `${orgName} · Daily report`,
    `${digest.workDate} · ${extras.atTime} Dhaka`,
    '',
    `Worked today   ${hm(totals.hoursToday)}`,
    `Staff          ${totals.workedToday} of ${totals.employees} worked`,
  ];

  if (target > 0) out.push(`Target         ${hm(target)} each`);

  const section = (
    title: string,
    group: readonly DigestRow[],
    showDelta: boolean,
  ) => {
    // ⚠️ খালি দল **দেখানোই হয় না** — "NO WORK TODAY · 0" পড়তে সময় লাগে,
    //    বুঝতে লাগে না, আর রোজ চারটে খালি শিরোনাম আবার সেই দেয়াল।
    if (group.length === 0) return;

    out.push('', `${title} · ${group.length}`);
    for (const r of group) out.push(line(r, showDelta));
  };

  section('✅ MET THE TARGET', met, false);
  section('⚠️ UNDER TARGET', under, true);

  if (none.length > 0) {
    out.push('', `⭕ NO WORK TODAY · ${none.length}`);
    // ⚠️ এখানে ঘণ্টা লেখা হয় না — সবারই ০, আর শূন্যের কলাম কিছুই বলে না
    for (const r of none) out.push(`  ${r.fullName}`);
  }

  /**
   * ⭐ ছুটির লোকজনও লেখা হয়, যদিও তাঁদের নিয়ে করণীয় নেই।
   *
   * ⚠️⚠️ না লিখলে **সংখ্যাগুলো মিলত না** — উপরে "১৩ জন" লেখা, নিচে
   * ১১ জনের নাম, আর বাকি দুজন কোথায় গেলেন তার উত্তর নেই। ওই ফাঁকটা
   * দেখতে হুবহু "এজেন্ট কাজ করছে না"-র মতো লাগত।
   */
  if (off.length > 0) {
    out.push('', `🌴 OFF TODAY · ${off.length}`);
    for (const r of off) out.push(`  ${r.fullName}`);
  }

  if (digest.behind.length > 0) {
    out.push('', `📉 BEHIND FOR THE MONTH · ${digest.behind.length}`);
    for (const r of digest.behind) {
      const gap = `−${hm(r.paceHours)}`.padStart(8);
      out.push(`  ${gap}  ${r.fullName}`);
      out.push(`            ${hm(r.monthHours)} of ${hm(r.expectedHours)}`);
    }
  }

  /**
   * ⚠️ ব্যাখ্যা **দুই লাইন**, ইমেইলের আটটা নয়। যেটুকু ছাড়া সংখ্যাটা ভুল
   * বোঝা যায় সেটুকুই: আজকের দাবি "পিছিয়ে"-তে ধরা হয়নি, আর এজেন্ট বসার
   * আগের দিনগুলোও নয়। বাকিটা ইমেইলে ও ড্যাশবোর্ডে আছে।
   */
  if (digest.behind.length > 0) {
    out.push(
      '',
      "Behind excludes today's target, and days",
      'before tracking started for someone.',
    );
  }

  if (extras.silentPcs > 0) {
    // ⚠️ দু-লাইনে — এক লাইনে ৫২ অক্ষর হয়ে যেত, আর তখন সরু ফোনে ভাঁজ
    //    পড়ে নিচের কলামগুলোর সাথে জট পাকাত (টেস্টে ধরা পড়েছে)
    out.push(
      '',
      `🖥️ ${extras.silentPcs} ${extras.silentPcs === 1 ? 'PC went' : 'PCs went'} silent today`,
      '   — the Alerts page says which',
    );
  }

  return out.join('\n');
}

/**
 * ⭐ পুরো বার্তাটা একটা `<pre>` ব্লকে — এতে টেলিগ্রাম **monospace**-এ দেখায়,
 * আর তখনই কেবল সংখ্যার কলামগুলো সত্যিই এক লাইনে দাঁড়ায়।
 *
 * ⚠️⚠️ পাঠানো ব্যর্থ হলে `TelegramChannel` **প্লেইন টেক্সটে আবার চেষ্টা
 * করে** — কারণ একটা ফরম্যাটিং সমস্যার দাম কখনোই "সেদিনের রিপোর্ট হারিয়ে
 * গেল" হওয়া উচিত নয়।
 */
export function asPreBlock(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}
