import { execSync } from 'node:child_process';

import { PrismaClient } from '@prisma/client';

import {
  adminDatabaseUrl,
  testDatabaseName,
  testDatabaseUrl,
} from './test-db-url';

/**
 * পুরো টেস্ট রানে **একবার** চলে:
 *   ১· `oxeio_test` ডাটাবেস (না থাকলে) তৈরি
 *   ২· তাতে সব migration প্রয়োগ
 *
 * seed ইচ্ছাকৃতভাবে চালানো হয় না — টেস্ট নিজের fixture নিজেই বসায়,
 * নইলে seed বদলালেই টেস্ট ভাঙত।
 */
export default async function setup(): Promise<void> {
  const dbName = testDatabaseName();

  const admin = new PrismaClient({
    datasources: { db: { url: adminDatabaseUrl() } },
  });

  try {
    const existing = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) AS count FROM pg_database WHERE datname = '${dbName}'`,
    );
    if (Number(existing[0]?.count ?? 0) === 0) {
      // CREATE DATABASE ট্রানজেকশনে চলে না, তাই $executeRawUnsafe
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  // execFileSync দিয়ে নয় — Windows-এ `.cmd` সরাসরি spawn করলে Node EINVAL দেয়
  // (২০+ ভার্সনের নিরাপত্তা পরিবর্তন)। execSync শেল ব্যবহার করে, তাই নিরাপদ।
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
