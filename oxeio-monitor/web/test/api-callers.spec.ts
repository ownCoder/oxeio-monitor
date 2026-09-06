import { describe, expect, it } from 'vitest';

/**
 * ⭐⭐⭐ **প্রতিটা API ফাংশনের একজন কলার আছে কি না**
 * *(৬ সেপ্টেম্বর ২০২৬, G167)*।
 *
 * ⚠️⚠️ **যে ব্যর্থতাটা এই ফাইলটা ধরে:** এই প্রকল্পের সবচেয়ে চেনা ভুল —
 * *"চুক্তি লেখা আছে, কলার লেখা হয়নি"*। এখন পর্যন্ত এটা ঘটেছে **নয়বার
 * ছাড়িয়ে**: G141 · G144 · G146 · G149 · G156 · G159, আর সবশেষে G167।
 *
 * ⚠️ G167-এ সার্ভারে `POST /work-policies/:id/reactivate` ছিল **G85 থেকেই**
 * — কন্ট্রোলার, সার্ভিস, অডিট-সারি, পাঁচটা ইউনিট টেস্ট, সব সবুজ। কেবল
 * ওয়েবে কেউ ওটা ডাকত না। ভুল করে পলিসি Close করলে ফেরার পথ ছিল `curl`
 * বা কাঁচা SQL — ঠিক যে দুটো জিনিস দূর করতে G85 লেখা হয়েছিল।
 *
 * ⭐ **এই টেস্টটা সেই শ্রেণির অর্ধেকটা বন্ধ করে।** বাকি অর্ধেক (সার্ভারে
 * endpoint আছে অথচ ওয়েবে ফাংশনটাই কেউ লেখেনি) এটা ধরতে পারে না — সেটা
 * এখনো চোখের কাজ।
 *
 * ⚠️ ফাইলগুলো `import.meta.glob` দিয়ে পড়া হয়, `node:fs` দিয়ে নয় —
 * এই প্রকল্পে `@types/node` নেই, আর টেস্ট ফাইলগুলোও `npm run typecheck`-এর
 * ভেতরে (tsconfig.app.json দেখুন)। `fs` ব্যবহার করলে টেস্ট চলত কিন্তু
 * typecheck ভাঙত।
 */
const SOURCES = import.meta.glob('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * ⚠️ যেগুলোর কলার না থাকাটা **বৈধ**। খালি রাখা হয়েছে ইচ্ছাকৃতভাবে:
 * আজ একটাও ব্যতিক্রম নেই, আর নতুন ব্যতিক্রম যোগ করতে হলে সেটা যেন
 * একটা **সিদ্ধান্ত** হয়, দুর্ঘটনা নয়।
 */
const ALLOWED_WITHOUT_CALLER: ReadonlySet<string> = new Set<string>();

/** ঠিক `src/api/*.ts` — নিচের ফোল্ডারগুলো নয় */
const API_FILES = Object.keys(SOURCES)
  .filter((p) => /^\.\.\/src\/api\/[^/]+\.ts$/.test(p))
  .sort();

/** একটা ফাইলের `export function` নামগুলো */
function exportedFunctions(text: string): string[] {
  const names: string[] = [];
  const re = /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;

  for (const m of text.matchAll(re)) names.push(m[1]);
  return names;
}

describe('G167 — API ফাংশনের কলার আছে কি না', () => {
  /** ⚠️ সত্যিই ফাইল পড়া গেছে কি না — নইলে টেস্টটা ফাঁকা সবুজ হতো */
  it('src/api/ ও src/ ট্রি পড়া গেছে', () => {
    expect(API_FILES.length).toBeGreaterThan(5);
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });

  for (const path of API_FILES) {
    const file = path.slice(path.lastIndexOf('/') + 1);

    for (const name of exportedFunctions(SOURCES[path])) {
      const test = ALLOWED_WITHOUT_CALLER.has(name) ? it.skip : it;

      test(`${file} :: ${name}() — কেউ ডাকে`, () => {
        const word = new RegExp(`\\b${name}\\b`);

        const callers = Object.entries(SOURCES).filter(
          ([p, text]) => p !== path && word.test(text),
        );

        expect(
          callers.length,
          `${file}-এর ${name}() কোথাও ডাকা হয় না — চুক্তি লেখা আছে, ` +
            'কলার লেখা হয়নি। হয় কলারটা লিখুন, নয় ফাংশনটা সরান।',
        ).toBeGreaterThan(0);
      });
    }
  }
});
