/**
 * টেস্ট কখনোই ডেভ ডাটাবেস ছোঁয় না — একই Postgres ইনস্ট্যান্সে
 * আলাদা একটা `*_test` ডাটাবেসে চলে।
 *
 * ⚠️ [02-Workflow §9](../../../docs/02-Workflow.md)-এ Testcontainers-এর কথা আছে।
 *    ইচ্ছাকৃতভাবে সেটা নেওয়া হয়নি: docker compose-এ Postgres তো চলছেই,
 *    প্রতি রানে নতুন কন্টেইনার তোলা মানে অকারণে ৩০+ সেকেন্ড আর একটা ডিপেন্ডেন্সি।
 *    CI-তে service container দিলে এই একই কোড কাজ করবে।
 */
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'DATABASE_URL সেট নেই — টেস্ট চালান `npm test` দিয়ে (ওটা ../.env লোড করে)',
    );
  }

  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '') || 'oxeio';
  if (dbName.endsWith('_test')) return base;

  url.pathname = `/${dbName}_test`;
  return url.toString();
}

/** `CREATE DATABASE` চালাতে হলে অন্য একটা ডাটাবেসে কানেক্ট করতে হয় */
export function adminDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = '/postgres';
  return url.toString();
}

export function testDatabaseName(): string {
  return new URL(testDatabaseUrl()).pathname.replace(/^\//, '');
}
