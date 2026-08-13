/**
 * `staff.local.json` ঠিক আছে কি না — **ডাটাবেস ছাড়াই**।
 *
 * ⭐ **কেন এটা দরকার হলো:** তালিকাটা ঠিক আছে কি না জানার একমাত্র উপায় ছিল
 * পুরো seed চালানো — অর্থাৎ ফাইল `scp` করে VPS-এ পাঠিয়ে, সেখানে কনটেইনার
 * চালিয়ে, তারপর এরর পড়া। একটা কমার ভুলের জন্য পুরো চক্রটা ঘুরতে হতো, আর
 * এরর আসত ডকারের লগের ভেতর থেকে।
 *
 * ⚠️ এটা ডাটাবেসে **কিছুই লেখে না** — শুধু পড়ে আর বলে কী দেখল। তাই
 * নিশ্চিন্তে যতবার খুশি চালানো যায়।
 *
 *     npm run check:staff
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseStaff, type StaffRow } from './parse-staff';

const local = join(__dirname, 'staff.local.json');
const example = join(__dirname, 'staff.example.json');
const file = existsSync(local) ? local : example;

if (file === example) {
  console.error('❌ staff.local.json নেই — দেখা হচ্ছে staff.example.json');
  console.error(`   খোঁজা হয়েছিল: ${local}`);
  process.exitCode = 1;
}

let rows: StaffRow[];
try {
  const text = readFileSync(file, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    /**
     * ⚠️⚠️ JSON-এর নিজের এরর আলাদা করে ধরা হয়, কারণ কারণটা প্রায় সবসময়
     *    একই — সারির শেষে **বাড়তি কমা**, বা তারিখ যোগ করতে গিয়ে `]`
     *    ভুল জায়গায়। Node-এর মূল বার্তা অক্ষরের অবস্থান বলে, লাইন নয়।
     */
    console.error(`❌ ফাইলটা বৈধ JSON নয়: ${(e as Error).message}`);
    console.error(
      '   সবচেয়ে সাধারণ কারণ: শেষ সারির পরে বাড়তি কমা, ' +
        'বা তারিখ বসাতে গিয়ে বন্ধনী সরে যাওয়া।',
    );
    process.exit(1);
  }
  rows = parseStaff(raw);
} catch (e) {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
}

const withDate = rows.filter((r) => r.joinedOn).length;
const pad = (s: string, n: number) => s.padEnd(n, ' ');

console.log(`✅ ${rows.length} জন — ধাঁচ ঠিক আছে\n`);
for (const r of rows) {
  const date = r.joinedOn?.toISOString().slice(0, 10) ?? '— তারিখ নেই';
  console.log(
    `   ${pad(r.empCode, 8)} ${pad(r.fullName, 22)} ` +
      `${pad(String(r.monthlySalary), 8)} ${date}`,
  );
}

/**
 * ⚠️⚠️ তারিখ না থাকা **কোনো এরর নয়** (চার ঘরের সারি বৈধ), কিন্তু চুপ করে
 * থাকাও চলে না — G37 তখন ওই কর্মীকে পুরো-মাস ধরে নেবে, আর সেটা কোথাও
 * দেখা যাবে না। তাই গোনাটা এখানে বলা হয়, exit code বদলায় না।
 */
if (withDate < rows.length) {
  console.log(
    `\n⚠️  ${rows.length - withDate} জনের যোগদানের তারিখ নেই — তাঁদের হিসাব ` +
      'পুরো মাস ধরে হবে (G37 proration চলবে না)।',
  );
}
