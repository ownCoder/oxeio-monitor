import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  deriveSigningKey,
  signScreenshotToken,
  verifyScreenshotToken,
  type ScreenshotVariant,
  type SignInput,
  type VerifyResult,
} from './signed-url';

/**
 * খাঁটি ফাংশনগুলোর (signed-url.ts) চারপাশে পাতলা একটা মোড়ক — এর একমাত্র
 * কাজ সিক্রেটটা ধরে রাখা। হিসাবের কোনো লজিক এখানে নেই, কারণ সিক্রেট
 * ঢুকলেই জিনিসটা আর DB ছাড়া টেস্ট করা যেত না।
 */
@Injectable()
export class SignedUrlService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    /**
     * ⭐ আলাদা `SCREENSHOT_URL_SECRET` দেওয়া যায়, না দিলে `JWT_SECRET`।
     *
     * ⚠️ একই কাঁচা সিক্রেট হলেও চাবি দুটো আলাদা — `deriveSigningKey`
     *    label মিশিয়ে নতুন চাবি বানায়। তাই স্ক্রিনশটের টোকেন দিয়ে কখনো
     *    সেশন বানানো যাবে না, উল্টোটাও না।
     */
    const raw =
      this.config.get<string>('SCREENSHOT_URL_SECRET') ??
      this.config.get<string>('JWT_SECRET');

    if (!raw || raw.length < 32) {
      // TokenService-এর মতোই fail fast — দুর্বল সিক্রেটে সই করা মানে
      // যে-কেউ নিজের হাতে যেকোনো স্ক্রিনশটের লিঙ্ক বানিয়ে নিতে পারবে।
      throw new Error(
        'SCREENSHOT_URL_SECRET / JWT_SECRET is unset or shorter than 32 characters. Check .env.',
      );
    }

    this.key = deriveSigningKey(raw);
  }

  sign(input: SignInput): string {
    return signScreenshotToken(input, this.key);
  }

  verify(token: string): VerifyResult {
    return verifyScreenshotToken(token, this.key);
  }

  /**
   * গ্যালারির প্রতিটি ছবির জন্য যে লিঙ্কটা রেসপন্সে যায়।
   *
   * ⚠️ ইচ্ছাকৃতভাবে **relative** — ফ্রন্টএন্ড `/api` কে সার্ভারে প্রক্সি করে
   *    (vite.config.ts), আর SameSite=Strict cookie-র জন্য একই origin থাকাটা
   *    জরুরি। এখানে absolute URL বানালে হোস্টনেম বদলালেই সব লিঙ্ক ভাঙত।
   */
  urlFor(
    screenshotId: bigint,
    variant: ScreenshotVariant,
    viewerUserId: number,
  ): string {
    const token = this.sign({ screenshotId, variant, viewerUserId });
    return `/api/v1/screenshots/${screenshotId.toString()}/file?token=${encodeURIComponent(token)}`;
  }
}
