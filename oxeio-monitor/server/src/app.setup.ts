import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/**
 * প্রোডাকশন (`main.ts`) আর টেস্ট — দুই জায়গাতেই এই একই সেটআপ চলে।
 *
 * আলাদা করে রাখার কারণ: টেস্টে যদি নিজের মতো করে prefix/pipe/cookie বসাতাম,
 * তাহলে টেস্ট পাস করেও প্রোডাকশনে অন্যরকম আচরণ হতে পারত।
 */
/**
 * ⚠️ `JSON.stringify` BigInt পেলে **ছুড়ে ফেলে** — "Do not know how to
 * serialize a BigInt"। আর আমাদের অর্ধেক প্রাইমারি কী-ই BigInt
 * (`activity_segments`, `screenshots`, `app_usage`, `audit_log`)।
 *
 * ফল: যে endpoint ভুল করে একটা id ফেরত দেয়, সেটা **৫০০** দেয় — আর
 * typecheck সেটা কোনোদিন ধরত না, কারণ টাইপ হিসেবে সবই ঠিক। আগে প্রতিটা
 * মডিউলকে হাতে `String(id)` করতে হতো, আর একজন ভুলে গেলেই ওই একটা রুট
 * নীরবে ভাঙা থাকত।
 *
 * স্ট্রিং-এ পাঠানো হয়, সংখ্যায় নয় — `Number.MAX_SAFE_INTEGER`-এর পরে
 * JavaScript নীরবে ভুল সংখ্যা দেখাত।
 */
function enableBigIntJson(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function (this: bigint): string {
    return this.toString();
  };
}

export function configureApp(
  app: INestApplication,
  opts: { corsOrigin?: string } = {},
): void {
  enableBigIntJson();

  app.setGlobalPrefix('api/v1');

  /**
   * ⭐⭐⭐ **প্রক্সির পেছনে আসল IP** *(৬ সেপ্টেম্বর ২০২৬)*।
   *
   * ⚠️⚠️ **যে বাগটা এটা সারায়, আর সেটা দুটো:**
   *
   * ১· **লগইনের তালা একটাই বালতি হয়ে গিয়েছিল।** `login-throttle.service`
   *    প্রতি-IP গোনে (`ipMaxFails`), কিন্তু Express প্রক্সিকে বিশ্বাস না
   *    করায় `req.ip` হতো **Caddy কন্টেইনারের** ঠিকানা — সবার জন্য একই।
   *    ফলে পৃথিবীর যেকোনো জায়গা থেকে ৫০টা ভুল লগইন করলে **মালিকসহ
   *    গোটা অফিস** তালাবন্ধ হয়ে যেত। এক লাইনের DoS।
   *
   * ২· **অডিট লগের IP অর্থহীন ছিল।** *"আমার স্ক্রিনশট কে দেখল"* (I08)
   *    প্রশ্নের উত্তরে প্রতিটা সারিতে একই ভেতরের ঠিকানা বসত। মাঠে গুনে
   *    দেখা: ৭ দিনের **৪৯৪টা সারির সবগুলোতেই** `172.18.0.4`।
   *
   * ⭐ ডিফল্ট **১** — কারণ শিপ করা টপোলজিতে সামনে সবসময় ঠিক একটাই হপ
   * (Caddy), আর API-র পোর্ট `127.0.0.1`-এ বাঁধা, তাই বাইরে থেকে ওটাই
   * একমাত্র পথ।
   *
   * ⚠️⚠️ **সংখ্যাটা বাড়িয়ে বসাবেন না।** `trust proxy` যত হপ বিশ্বাস করে,
   * ক্লায়েন্ট তত গভীরে `X-Forwarded-For` জাল করতে পারে — অর্থাৎ নিজের IP
   * নিজেই বেছে নিয়ে তালা এড়াতে পারে। সামনে Cloudflare বসলে **তখন** ২,
   * আর প্রক্সি ছাড়া বেয়ার চালালে `TRUST_PROXY=0`।
   */
  //  ⚠️ `set()` কেবল Express অ্যাডাপ্টারে — নিচের `useBodyParser`-এর মতোই
  //     টাইপটা এখানে সংকীর্ণ করা হয়। Fastify-তে গেলে এটাই প্রথম ভাঙবে,
  //     আর সেটাই ঠিক: নীরবে ভুল IP-তে ফিরে যাওয়ার চেয়ে ভালো।
  (app as NestExpressApplication).set('trust proxy', trustProxyHops());

  /**
   * ⭐⭐ **JSON বডির ছাদ ৮ MB** *(২৩ আগস্ট ২০২৬, মালিকের চাওয়া)*।
   *
   * ⚠️⚠️ Express-এর ডিফল্ট **১০০ KB**, আর সেটা এখানে বসানো ছিল না। ফলে
   * গবেষক বড় তালিকা পেস্ট করলে অনুরোধটা **যাচাইয়ে পৌঁছনোর আগেই** ৪১৩
   * খেয়ে ফিরত — পর্দায় কোনো বোধগম্য কারণ ছাড়াই।
   *
   * ⚠️ ছাদটা DTO-র ছাদের (৫ MB) **চেয়ে বড়** ইচ্ছাকৃতভাবে: বেশি পেস্ট
   * করলে মানুষ যেন Express-এর নীরব ৪১৩ নয়, আমাদের নিজের বোধগম্য
   * বার্তাটা পান ("text must be shorter than…")।
   */
  //  ⚠️ `useBodyParser` কেবল Express অ্যাডাপ্টারে আছে, `INestApplication`-এ
  //     নয় — তাই টাইপটা এখানে সংকীর্ণ করা হয়। Fastify-তে গেলে এই লাইনটাই
  //     প্রথম ভাঙবে, আর সেটাই ঠিক: নীরবে ১০০ KB-তে ফিরে যাওয়ার চেয়ে ভালো।
  (app as NestExpressApplication).useBodyParser('json', { limit: '8mb' });

  app.use(helmet());
  app.use(cookieParser());

  // টোকেন httpOnly cookie-তে থাকে (ADR-016), তাই credentials লাগবে
  app.enableCors({
    origin: opts.corsOrigin ?? 'http://localhost:5173',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableShutdownHooks();
}

/**
 * সামনে কতগুলো প্রক্সি — `TRUST_PROXY`, ডিফল্ট ১।
 *
 * ⚠️ অবৈধ বা ঋণাত্মক মান নীরবে ০ হয়ে যায় না, ডিফল্টেই ফেরে — নইলে
 *    একটা টাইপো (`TRUST_PROXY=yes`) চুপচাপ পুরোনো বাগটা ফিরিয়ে আনত।
 */
function trustProxyHops(): number {
  const raw = process.env.TRUST_PROXY?.trim();
  if (raw === undefined || raw === '') return 1;

  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) return 1;
  return hops;
}
