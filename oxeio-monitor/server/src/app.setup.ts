import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/**
 * প্রোডাকশন (`main.ts`) আর টেস্ট — দুই জায়গাতেই এই একই সেটআপ চলে।
 *
 * আলাদা করে রাখার কারণ: টেস্টে যদি নিজের মতো করে prefix/pipe/cookie বসাতাম,
 * তাহলে টেস্ট পাস করেও প্রোডাকশনে অন্যরকম আচরণ হতে পারত।
 */
export function configureApp(
  app: INestApplication,
  opts: { corsOrigin?: string } = {},
): void {
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
