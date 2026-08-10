import { INestApplication, ValidationPipe } from '@nestjs/common';
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
