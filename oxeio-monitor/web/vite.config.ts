import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

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
    plugins: [react(), tailwindcss()],
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
