import { resolve } from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * ⭐⭐ **ডাটাবেস ছাড়া টেস্ট** — `npm run test:nodb`।
 *
 * ⚠️ কেন আলাদা কনফিগ: `vitest.config.ts`-এর `globalSetup` একটা আসল
 * Postgres তোলে ও migration চালায়। সেটা CI-তে ঠিক আছে, কিন্তু যাঁর
 * মেশিনে Docker নেই (সিস্টেম VPS-এ চলে যাওয়ার পর এখানে তাই) তাঁর পক্ষে
 * **একটা খাঁটি ফাংশনের টেস্টও** চালানো যেত না — অথচ পে-রোল আর জামানতের
 * গোটা হিসাবটাই খাঁটি ফাংশনে লেখা, ঠিক এই কারণেই।
 *
 * ⚠️ এখানে `*.e2e.spec.ts` ইচ্ছাকৃতভাবে **বাদ** — ওগুলো ডাটাবেস ছাড়া
 * চলবেই না, আর তালিকায় রাখলে প্রতিবার লাল দেখে মনে হতো কিছু ভেঙেছে।
 * সবুজ মানে "যা চালানো গেছে সব ঠিক", **"সব ঠিক" নয়** — শেষ কথা CI।
 */
export default defineConfig({
  // ⚠️ SWC ছাড়া NestJS-এর DI ভাঙে (`vitest.config.ts`-এর নোট দেখুন)
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    exclude: ['test/**/*.e2e.spec.ts', 'node_modules/**'],
    env: {
      NODE_ENV: 'test',
      // ⚠️ `screenshot-heal.spec.ts` ডাটাবেস ছাড়াই চলে, কিন্তু একটা লেখার
      //    মতো ফোল্ডার চায় — না দিলে ওটাই একমাত্র লাল টেস্ট হয়ে বসত, আর
      //    কারণটা "ডাটাবেস নেই" বলে ভুল বোঝা যেত।
      STORAGE_ROOT: resolve(import.meta.dirname, '.tmp-test-storage'),
    },
  },
});
