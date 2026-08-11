import 'reflect-metadata';

import { readFileSync } from 'node:fs';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';

/**
 * I01 — TLS চালু করার সিদ্ধান্ত।
 *
 * ⭐ এই কাজটা `NestFactory.create()`-এর **আগেই** করতে হয়, কারণ Node-এর
 * HTTP আর HTTPS সার্ভার দুটো আলাদা জিনিস — সার্ভার তৈরি হয়ে যাওয়ার পর
 * "এখন থেকে TLS" বলার কোনো উপায় নেই। তাই এখানে `ConfigService` ব্যবহার
 * করা যায় না (সে DI কনটেইনারের ভেতরে, আর কনটেইনার তখনো নেই) — সরাসরি
 * `process.env` পড়া হয়। ⚠️ ফলে এই দুটো চলক `.env`-এ থাকলেও কাজ করবে না
 * যদি না প্রসেসের পরিবেশে আসে; docker-compose বা systemd থেকেই দিতে হবে।
 *
 * তিনটে অবস্থা, ইচ্ছাকৃতভাবেই আলাদা:
 *
 * ১· **দুটোই খালি** → HTTP। ডেভেলপমেন্টে সার্ট বানানোর ঝামেলা নেই, আর
 *    আগের আচরণ হুবহু অক্ষত থাকে।
 *
 * ২· **দুটোই দেওয়া** → HTTPS।
 *
 * ৩· **একটা দেওয়া, আরেকটা নয়** → প্রসেস উঠবেই না।
 *
 * ⚠️ তৃতীয় অবস্থাটায় "যা পেয়েছি তাই দিয়ে চালাই" বা "HTTP-তে নেমে যাই"
 * করা হয়নি, আর এটাই এখানকার সবচেয়ে গুরুত্বপূর্ণ সিদ্ধান্ত। প্রোডাকশনে
 * নীরবে HTTP-তে নেমে গেলে সার্ভার দিব্যি চলত, ড্যাশবোর্ড খুলত, আর
 * এজেন্টগুলো তাদের **ডিভাইস টোকেন প্লেইনটেক্সটে** LAN-এ পাঠাতে থাকত —
 * অফিসের যেকোনো মেশিন থেকে ধরে ফেলা যায়। কেউ টের পেত না, কারণ বাইরে থেকে
 * সবকিছু কাজ করছে বলেই মনে হতো। একটা টাইপো (`TLS_KEY` বনাম `TLS_KEYFILE`)
 * এভাবে মাসের পর মাস নিরাপত্তা ফুটো করে রাখতে পারত।
 */
function loadTlsOptions(): { key: Buffer; cert: Buffer } | undefined {
  const certPath = process.env.TLS_CERT?.trim();
  const keyPath = process.env.TLS_KEY?.trim();

  if (!certPath && !keyPath) return undefined;

  if (!certPath || !keyPath) {
    const missing = certPath ? 'TLS_KEY' : 'TLS_CERT';
    throw new Error(
      `TLS is only half configured — ${missing} is missing. ` +
        'Set both TLS_CERT and TLS_KEY, or neither (then it runs on HTTP).',
    );
  }

  // ⚠️ readFileSync — ইচ্ছাকৃতভাবে synchronous। এটা প্রসেসের জীবনে একবারই
  //    চলে, এবং ব্যর্থ হলে সার্ভার ওঠার কোনো মানেই নেই। async করলে ভুলটা
  //    পরে, অন্য কোথাও ধরা পড়ত।
  const read = (label: string, path: string): Buffer => {
    try {
      return readFileSync(path);
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Could not read ${label} (${path}) — ${why}`);
    }
  };

  return {
    cert: read('TLS_CERT', certPath),
    key: read('TLS_KEY', keyPath),
  };
}

async function bootstrap(): Promise<void> {
  const httpsOptions = loadTlsOptions();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    httpsOptions,
  });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  configureApp(app, {
    corsOrigin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173'),
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');

  // ⚠️ scheme-টা লগে থাকা দরকার। "সার্ভার চলছে" দেখে অ্যাডমিন ধরে নিতে
  //    পারতেন TLS চালু আছে; কোন প্রোটোকলে চলছে সেটা লেখা না থাকলে ভুলটা
  //    ধরা পড়ত এজেন্ট সংযোগ করতে না পারার দিন।
  app
    .get(Logger)
    .log(`oXeio API ${httpsOptions ? 'https' : 'http'}://0.0.0.0:${port}`);
}

// ⚠️ ধরা না পড়া rejection Node-এ কুৎসিত স্ট্যাক ট্রেস দিয়ে মরে, আর
//    ১৫টা PC-র মালিক সেটা পড়ে কিছুই বোঝেন না। TLS-এর ভুল কনফিগ এখানে
//    এসেই থামে — এক লাইনের পরিষ্কার কারণ, তারপর exit 1 (docker
//    `restart: unless-stopped` যেন অসীমবার চেষ্টা না করে সেটাও এতে বোঝা যায়)।
void bootstrap().catch((error: unknown) => {
  const why = error instanceof Error ? error.message : String(error);
  // ⚠️ `console` — pino logger নয়। এই পর্যায়ে DI কনটেইনার ভেঙে পড়া
  //    থাকতে পারে, অর্থাৎ logger-টাই হয়তো নেই।
  console.error(`oXeio API failed to start: ${why}`);
  process.exit(1);
});
