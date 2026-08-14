import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/* ═══ PWA: সার্ভিস ওয়ার্কার বিল্ড করা ═══════════════════════════════════
 *
 * ⭐⭐ কেন `vite-plugin-pwa` নয় — নির্ভরতা নয়, **নিয়ন্ত্রণ**। প্লাগইনটা
 *    workbox আনে, আর workbox ডিফল্টে অনেক কিছু runtime ক্যাশ করে। এই
 *    অ্যাপে `/api/v1/screenshots/*` হলো কর্মীর পর্দার ছবি, আর সংখ্যাগুলো
 *    লাইভ — দুটোর একটাও ডিভাইসে জমতে পারে না। পুরো ব্যাখ্যা
 *    `src/pwa-sw.ts`-এর মাথায়।
 *
 * ⭐ কিন্তু যেটার জন্য প্লাগইন সত্যিই লাগত সেটা হলো **hash-করা ফাইলের
 *    তালিকা** — `assets/index-eB3mYKqm.js` নামটা প্রতি বিল্ডে বদলায়, তাই
 *    হাতে লেখা যায় না। নিচের ~৬০ লাইন ঠিক ততটুকুই করে: বিল্ড শেষে
 *    তালিকাটা আর একটা ভার্সন-হ্যাশ সার্ভিস ওয়ার্কারের ভেতরে বসিয়ে দেয়।
 */

/** সার্ভিস ওয়ার্কারের সোর্স — rollup-এর দ্বিতীয় entry */
const SW_ENTRY = 'src/pwa-sw.ts';

/** বিল্ডের পর যে নামে বেরোবে — ⚠️ `index.html` ও `Caddyfile`-এ একই নাম */
const SW_FILE = 'sw.js';

/**
 * ⭐ ছোট, স্থিতিশীল হ্যাশ (FNV-1a, ৩২-বিট) — ফাইলের তালিকা বদলালেই বদলায়।
 *
 * ⚠️ `node:crypto` ইচ্ছাকৃতভাবে নয়: শুধু এই এক লাইনের জন্য web-এ
 *    `@types/node` যোগ করতে হতো (`tsconfig.node.json`-এ lib কেবল ES2023)।
 *    এটা নিরাপত্তার হ্যাশ নয়, "বদলেছে কি না" চেনার সংকেত মাত্র।
 */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // ⚠️ `Math.imul` — সাধারণ `*` করলে ৩২ বিট ছাড়িয়ে ভাসমান দশমিকে চলে
    //    যেত আর হ্যাশটা মেশিনভেদে আলাদা হতো।
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function serviceWorkerPlugin(): Plugin {
  return {
    name: 'oxeio-service-worker',

    // ⚠️ শুধু বিল্ডে। ডেভ সার্ভারে `sw.js` তৈরি হয় না, আর সেটাই চাওয়া —
    //    কারণ `src/pwa.ts`-এ লেখা।
    apply: 'build',

    /**
     * সার্ভিস ওয়ার্কারকে **দ্বিতীয় entry** হিসেবে যোগ করা।
     *
     * ⭐ এতে ফাইলটা সাধারণ TypeScript-ই থাকে — `tsc -b` টাইপ দেখে,
     *    eslint পড়ে, আর বাকি কোডের মতোই আচরণ করে। স্ট্রিং হিসেবে
     *    লিখলে ওই তিনটের একটাও পেত না।
     * ⚠️ নামটা `sw.js`, hash নয় — ব্রাউজার সবসময় **একই ঠিকানায়**
     *    ওয়ার্কার খোঁজে। hash বসালে প্রতি বিল্ডে নতুন ওয়ার্কার হতো আর
     *    পুরোনোটা কোনোদিন প্রতিস্থাপিত হতো না।
     * ⚠️ scope: `/`-এ বসে বলে পুরো সাইট তার আওতায়। `assets/`-এ থাকলে
     *    scope হতো `/assets/`, আর নেভিগেশন কখনো ধরত না।
     */
    config() {
      return {
        build: {
          rollupOptions: {
            input: { index: 'index.html', sw: SW_ENTRY },
            output: {
              entryFileNames: (chunk: { name: string }) =>
                chunk.name === 'sw' ? SW_FILE : 'assets/[name]-[hash].js',
            },
          },
        },
      };
    },

    /**
     * ⭐ `index.html`-এর কমেন্টগুলো বিল্ডে ছেঁটে ফেলা।
     *
     * ⚠️ Vite HTML কমেন্ট রেখে দেয় (JS/CSS-এর মতো ছাঁটে না)। এই ফাইলে
     *    ব্যাখ্যা লম্বা — না ছাঁটলে ~৫ কিলোবাইট বাংলা কমেন্ট **প্রতিবার**
     *    যেত, আর `index.html` ইচ্ছাকৃতভাবে `no-cache` (Caddyfile), অর্থাৎ
     *    ড্যাশবোর্ড খোলার প্রতিবার। মালিক-ম্যানেজার ফোনের ডেটায় এটা
     *    খোলেন।
     * ⭐ কমেন্টগুলো তাই সোর্সেই থাকে, পুরো দৈর্ঘ্যে — শুধু পাঠানো হয় না।
     * ⚠️ `order: 'post'` — Vite স্ক্রিপ্ট/স্টাইল ট্যাগ বসানোর **পরে**;
     *    ওগুলোয় কোনো কমেন্ট নেই, তাই কিছু নষ্ট হয় না।
     */
    transformIndexHtml: {
      order: 'post',
      handler: (html: string) => html.replace(/<!--[\s\S]*?-->\s*/g, ''),
    },

    /**
     * ⭐ বিল্ডের ফাইলগুলো জানা হয়ে গেছে — এখন তালিকাটা ওয়ার্কারের ভেতরে বসে।
     */
    generateBundle(_options, bundle) {
      /**
       * ⚠️ `/index.html` হাতে যোগ করা হয়, `bundle` থেকে নয়। Vite-এর HTML
       *    প্লাগইন ফাইলটা তার **নিজের** `generateBundle`-এ emit করে, আর
       *    দুটো হুকের ক্রম প্লাগইনের সাজানোর উপর নির্ভর করে। ক্রম বদলালে
       *    তালিকা থেকে `index.html` নীরবে হারিয়ে যেত — আর তখন অফলাইনে
       *    অ্যাপ একেবারেই খুলত না, অথচ বিল্ড সবুজ।
       */
      const shell = ['/index.html'];

      for (const fileName of Object.keys(bundle)) {
        // ⚠️ ওয়ার্কার নিজেকে precache করে না — করলে নতুন সংস্করণ কোনোদিন
        //    পৌঁছাত না, ঠিক যে ফাঁদটা `Caddyfile`-এর no-cache ঠেকায়।
        if (fileName === SW_FILE) continue;
        // sourcemap ব্যবহারকারীর কোনো কাজে লাগে না, শুধু ক্যাশ ভারী করত।
        if (fileName.endsWith('.map')) continue;
        shell.push(`/${fileName}`);
      }

      /**
       * ⭐⭐ **এই প্রকল্পের সবচেয়ে জরুরি নিয়মটার পাহারা।**
       *
       * ⚠️ কোনোদিন কেউ `/api/*`-এর কিছু বান্ডলে ঢুকিয়ে দিলে সেটা নীরবে
       *    precache হয়ে যেত — অর্থাৎ কর্মীর ডেটা ফোনের ডিস্কে। বিল্ড
       *    থামিয়ে দেওয়াই একমাত্র সৎ উত্তর।
       */
      const leaked = shell.filter((path) => path.startsWith('/api'));
      if (leaked.length > 0) {
        this.error(
          `সার্ভিস ওয়ার্কারের precache তালিকায় API পথ ঢুকেছে: ${leaked.join(', ')} — ` +
            'API উত্তর কখনো ক্যাশ হতে পারে না (লাইভ সংখ্যা ও স্ক্রিনশট)।',
        );
      }

      const chunk = bundle[SW_FILE];
      if (!chunk || chunk.type !== 'chunk') {
        this.error(
          `${SW_FILE} তৈরি হয়নি — rollup-এর entry বা \`entryFileNames\` বদলে গেছে। ` +
            'ওয়ার্কার ছাড়া অ্যাপ চলবে, কিন্তু PWA ইনস্টল হবে না।',
        );
        return;
      }

      // ⭐ ভার্সন = তালিকার হ্যাশ। কোড বদলালে asset-এর hash বদলায়, তাই এটাও।
      const version = shortHash(shell.join('\n'));

      /**
       * ⚠️ প্লেসহোল্ডারের কোট দুরকম হতে পারে — esbuild minify করার সময়
       *    `'...'` কে `"..."` বানিয়ে দেয়। দুটোই ধরা হয়, নইলে minify চালু
       *    করার দিনটাতেই এটা নীরবে ভাঙত।
       */
      const before = chunk.code;
      chunk.code = before
        .replace(/(['"])__OXEIO_PRECACHE__\1/, JSON.stringify(JSON.stringify(shell)))
        .replace(/(['"])__OXEIO_SW_VERSION__\1/, JSON.stringify(version));

      /**
       * ⚠️⚠️ বদল না হলে বিল্ড থামে। বসানো না হলে ওয়ার্কারে
       *    `JSON.parse('__OXEIO_PRECACHE__')` থেকে যেত — সে ইনস্টলেই মরত,
       *    ব্যবহারকারী কিছুই টের পেতেন না, আর বিল্ড সবুজ দেখাত।
       *    **নীরব ব্যর্থতাই এখানে আসল শত্রু।**
       */
      if (chunk.code.includes('__OXEIO_PRECACHE__') || chunk.code.includes('__OXEIO_SW_VERSION__')) {
        this.error(
          `${SW_FILE}-এ প্লেসহোল্ডার বসানো যায়নি — \`src/pwa-sw.ts\`-এ ` +
            'নামগুলো বদলে গেছে কি না দেখুন।',
        );
      }

      this.info(`sw.js: ${shell.length}টা ফাইল precache, ভার্সন ${version}`);
    },
  };
}

/**
 * ⭐ API HTTPS-এ চললে proxy-ও HTTPS-এ যেতে হবে।
 *
 * ⚠️ সার্ভার `TLS_CERT`/`TLS_KEY` পেলে **শুধু** TLS-এ কথা বলে — ওই পোর্টে
 *    আর কোনো প্লেইন HTTP থাকে না। proxy তখনো `http://` ধরে বসে থাকলে
 *    প্রতিটা রিকোয়েস্ট `socket hang up` হয়ে ফিরত, আর ড্যাশবোর্ড পুরো
 *    অচল হয়ে যেত — অথচ সার্ভারের লগে কিছুই ভুল দেখাত না। TLS চালু করার
 *    দিনটাই সবচেয়ে খারাপ দিন এই ফাঁদে পড়ার জন্য।
 *
 * তাই একই `.env` থেকে `TLS_CERT` দেখে scheme ঠিক করা হয় — দুটো জায়গায়
 * দুরকম সত্য রাখলে একদিন সেগুলো আলাদা হয়ে যেত।
 *
 * ⚠️ vite এই ফাইলটা **চালু হওয়ার সময় একবারই** পড়ে। তাই `.env`-এ TLS
 *    চালু/বন্ধ করলে ডেভ সার্ভারটাও **রিস্টার্ট করতে হবে** — নইলে proxy
 *    আগের scheme ধরে বসে থাকবে আর প্রতিটা কল ৫০০ দেবে।
 */
export default defineConfig(({ mode }) => {
  // ⚠️ `.env` আছে web/ নয়, তার এক ফোল্ডার উপরে — সার্ভারও সেটাই পড়ে।
  //    তৃতীয় আর্গুমেন্ট `''` মানে সব ভেরিয়েবল, শুধু `VITE_`-গুলো নয়।
  // ⚠️ `'..'` ইচ্ছাকৃতভাবে আপেক্ষিক — `loadEnv` নিজেই cwd থেকে মেলায়,
  //    ঠিক যেভাবে vite তার `root`-ও মেলায়। `node:path`/`node:url` আনলে
  //    web-এ `@types/node` যোগ করতে হতো শুধু এই এক লাইনের জন্য।
  const env = loadEnv(mode, '..', '');
  const https = Boolean(env.TLS_CERT?.trim());

  return {
    plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
    server: {
      port: 5173,
      /**
       * ⚠️ proxy না থাকলে লগইনই কাজ করবে না।
       *
       * সেশন cookie-তে `SameSite=Strict` (ADR-016), তাই ব্রাউজার সেটা শুধু
       * **same-site** রিকোয়েস্টেই পাঠায়। ফ্রন্টএন্ড :5173 থেকে সরাসরি :3000-এ
       * ডাকলে cookie যেত না — লগইন সফল দেখাত, কিন্তু পরের রিকোয়েস্টেই 401।
       * proxy দিয়ে ব্রাউজারের চোখে সবই এক origin।
       */
      proxy: {
        '/api': {
          target: `${https ? 'https' : 'http'}://localhost:3000`,
          changeOrigin: false,
          // ⚠️ self-signed সার্ট (deploy/make-cert.ps1) — ডেভ proxy-কে
          //    সেটা মেনে নিতে বলতে হয়। এটা **শুধু ডেভ সার্ভারের** কথা;
          //    এজেন্ট নিজে SPKI পিন দিয়েই যাচাই করে, আর ব্রাউজার তার
          //    নিজের নিয়মে সার্ট দেখে।
          secure: false,
        },
      },
    },
  };
});
