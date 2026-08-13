/**
 * `staff.local.json` পড়ে যাচাই করা — খাঁটি ফাংশন, কোনো I/O নেই।
 *
 * ⭐ **কেন আলাদা ফাইল:** `seed.ts` import হলেই নিজে চলতে শুরু করে
 * (`main()` নিচে ডাকা), তাই ওর ভেতরের কিছু টেস্ট করা যায় না। অথচ এই
 * ফাইলটাই ঠিক করে দেয় **কার বেতন কত** — ভুল ধরার জায়গা এটাই।
 *
 * ⚠️⚠️ **আগে কোনো যাচাই ছিল না** — শুধু `JSON.parse(...) as Staff[]`,
 * অর্থাৎ TypeScript-এর কাছে মিথ্যে বলা। ফল:
 *
 * - তিন ঘরের সারি → `monthlySalary` হতো `undefined` → Prisma থামত এমন
 *   বার্তা নিয়ে যাতে **কোন কর্মীর সারিতে ভুল সেটা লেখাই থাকত না**।
 * - `"25000"` (উদ্ধৃতিসহ) → Prisma-র টাইপ এরর, একই অস্পষ্ট বার্তা।
 * - `25000.5` → পয়সা নিঃশব্দে হারাত, কারণ কলামটা `Int`।
 *
 * ⚠️ তাই প্রতিটা বার্তায় **কোড আর ঘরের নাম** থাকে — ১২ সারির ফাইলে কোনটা
 * ঠিক করতে হবে সেটা যেন খুঁজতে না হয়।
 */

/** যাচাই হয়ে যাওয়া একটি সারি — `joinedOn` তারিখে রূপান্তরিত */
export interface StaffRow {
  empCode: string;
  fullName: string;
  designation: string;
  monthlySalary: number;
  /** ⚠️ `undefined` মানে "ঘরটা ছোঁয়া হবে না", `null` নয় — নিচে দেখুন */
  joinedOn?: Date;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `YYYY-MM-DD` → UTC-মধ্যরাত।
 *
 * ⚠️ `@db.Date` কলাম UTC-মধ্যরাত ধরে (`countWorkdays`-ও তাই)। স্থানীয় সময়
 * দিয়ে `new Date('2026-01-05')` করলে ঢাকায় ওটা **আগের দিন** হয়ে যেত, আর
 * মাসের ১ তারিখে যোগ দেওয়া কেউ আগের মাসে গিয়ে পড়তেন।
 */
function parseDate(where: string, value: string): Date {
  if (!DATE.test(value)) {
    throw new Error(`${where}: joinedOn "${value}" — YYYY-MM-DD হতে হবে`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${where}: joinedOn "${value}" — এমন কোনো তারিখ নেই`);
  }

  /**
   * ⚠️ `2026-02-30` → JS চুপচাপ ২ মার্চ বানিয়ে দেয়, `Invalid Date` নয়।
   *    ফিরিয়ে মিলিয়ে না দেখলে টাইপোটা সরাসরি proration-এ ঢুকে যেত।
   */
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${where}: joinedOn "${value}" — এমন কোনো তারিখ নেই`);
  }
  return date;
}

function str(where: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}: ${field} — লেখা হতে হবে, খালি নয়`);
  }
  return value.trim();
}

/**
 * @param raw `JSON.parse()`-এর ফল — বিশ্বাস করা হয় না।
 *
 * ⚠️ ভুল পেলে **থেমে যাওয়া হয়**, সারিটা বাদ দেওয়া হয় না। বাদ দিলে একজন
 * কর্মী নিঃশব্দে অনুপস্থিত থাকতেন, আর সেটা ধরা পড়ত মাস শেষে বেতনের সময়।
 */
export function parseStaff(raw: unknown): StaffRow[] {
  if (!Array.isArray(raw)) {
    throw new Error('staff ফাইলটা একটা তালিকা (array) হতে হবে');
  }

  const rows: StaffRow[] = [];
  const seen = new Set<string>();

  raw.forEach((row: unknown, i: number) => {
    // ⚠️ সারি নম্বর ১ থেকে — ফাইল খুলে গোনার সাথে মেলাতে
    const at = `সারি ${i + 1}`;

    if (!Array.isArray(row) || row.length < 4 || row.length > 5) {
      throw new Error(
        `${at}: ["কোড", "নাম", "পদবি", বেতন] — চার বা পাঁচ ঘর লাগে, পাওয়া গেছে ${
          Array.isArray(row) ? row.length : typeof row
        }`,
      );
    }

    const empCode = str(at, 'কোড', row[0]);
    const where = `${at} (${empCode})`;

    /**
     * ⚠️⚠️ একই কোড দুবার থাকলে seed-এর upsert **দ্বিতীয়টা দিয়ে প্রথমটা
     *    চাপা দিত** — কোনো এরর ছাড়াই একজন কর্মী উধাও, অন্যজনের নাম-বেতন
     *    তার জায়গায়। copy-paste করে তালিকা বানালে এটা খুব সহজেই ঘটে।
     */
    if (seen.has(empCode)) {
      throw new Error(`${where}: এই কোডটা আগেও আছে — প্রতিটা কোড আলাদা হতে হবে`);
    }
    seen.add(empCode);

    const monthlySalary = row[3];
    if (typeof monthlySalary !== 'number' || !Number.isFinite(monthlySalary)) {
      throw new Error(
        `${where}: বেতন সংখ্যা হতে হবে — উদ্ধৃতি ছাড়া, যেমন 25000`,
      );
    }
    // ⚠️ কলামটা `Int`; ভগ্নাংশ দিলে পয়সা নিঃশব্দে কাটা পড়ত
    if (!Number.isInteger(monthlySalary) || monthlySalary < 0) {
      throw new Error(`${where}: বেতন ভগ্নাংশ বা ঋণাত্মক হতে পারে না`);
    }

    rows.push({
      empCode,
      fullName: str(where, 'নাম', row[1]),
      designation: str(where, 'পদবি', row[2]),
      monthlySalary,
      ...(row[4] === undefined
        ? {}
        : { joinedOn: parseDate(where, str(where, 'joinedOn', row[4])) }),
    });
  });

  return rows;
}
