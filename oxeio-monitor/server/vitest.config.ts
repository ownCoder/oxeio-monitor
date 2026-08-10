import { resolve } from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { testDatabaseUrl } from './test/setup/test-db-url';

export default defineConfig({
  /**
   * ⚠️ SWC ছাড়া NestJS-এর DI টেস্টে ভাঙে।
   * Vitest ট্রান্সপাইল করে esbuild দিয়ে, আর esbuild `emitDecoratorMetadata`
   * সমর্থন করে না — ফলে `design:paramtypes` মেটাডেটা তৈরি হয় না এবং
   * কনস্ট্রাক্টরের সব injection `undefined` হয়ে আসে।
   */
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    // `*.e2e.spec.ts` ছাড়াও সাধারণ `*.spec.ts` — খাঁটি ফাংশনের টেস্ট
    // (যেমন payroll.math) ডাটাবেস ছাড়াই চলে, কিন্তু একই কমান্ডে চলা দরকার।
    include: ['test/**/*.spec.ts'],
    globalSetup: ['./test/setup/global-setup.ts'],
    // সব টেস্ট একই ডাটাবেস ব্যবহার করে, তাই ফাইলগুলো একের পর এক চলবে
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      // স্ক্রিনশট টেস্ট যেন সত্যিকারের storage-এ ফাইল না ফেলে
      STORAGE_ROOT: resolve(import.meta.dirname, '.tmp-test-storage'),
      JWT_SECRET:
        process.env.JWT_SECRET ??
        'test-only-secret-at-least-32-characters-long',
    },
  },
});
