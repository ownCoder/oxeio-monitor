import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.tmp-test-storage/**',
      'prisma/migrations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // NestJS-এর DI কনস্ট্রাক্টরে খালি ক্লাস (মডিউল) স্বাভাবিক
      '@typescript-eslint/no-extraneous-class': 'off',
      // ইচ্ছাকৃতভাবে ব্যবহার না করা প্যারামিটার `_` দিয়ে শুরু হলে ছাড়
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },

  {
    // টেস্টে any/non-null assertion ব্যবহার করা স্বাভাবিক —
    // supertest-এর body টাইপহীন, আর fixture-এ মান নিশ্চিত জানা থাকে
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    /**
     * ⭐⭐ G140 — স্পেক ফাইলে আসল ঘড়ি নিষিদ্ধ।
     *
     * ⚠️⚠️ তারিখ-নির্ভর টেস্ট এই রিপোতে **তিনবার** ভেঙেছে, তিনটে আলাদা
     * ফাইলে (G62 · adjustments.e2e · agent-recovery.e2e)। প্রতিবারই সময়
     * ইনজেক্ট করার ব্যবস্থা কোডে ছিল, শুধু টেস্ট সেটা ব্যবহার করেনি —
     * অর্থাৎ ভুলটা মনে রাখার উপর দাঁড়িয়ে ছিল, আর তিনবার পরে সেটা আর
     * দুর্ঘটনা নয়।
     *
     * ⭐ বদলে হারনেসের দুটো দরজা: `dhakaNoon()` (দুই সীমানা থেকেই ১২
     * ঘণ্টা দূরে একটা ফিক্সচার-মুহূর্ত) আর `uniqueSuffix()` (অনন্য নামের
     * জন্য, ঘড়ি ছাড়াই)।
     *
     * ⚠️ `test/setup/**` ইচ্ছাকৃতভাবে ছাড়া — ওখানেই একমাত্র জায়গা যেখানে
     * আসল ঘড়ি পড়া হয়, আর সেটাই হেল্পারগুলোর কাজ। ছাড়টা সরু রাখা হয়েছে
     * বলেই নিয়মটা টেকে: চওড়া ছাড় মানে নিয়ম না থাকা।
     */
    files: ['test/**/*.ts'],
    /**
     * ⚠️ `test/setup/**` — হেল্পারগুলো নিজেই আসল ঘড়ি ছোঁয়, ওটাই তাদের কাজ।
     *
     * ⚠️⚠️ `test/clock.spec.ts` — **নিয়মটার নিজের পাহারা**। ওই ফাইলের গোটা
     *    দাবিটাই হলো "`dhakaNoon()` আসল ঘড়ির সাপেক্ষে ঠিক জায়গায় বসে",
     *    আর সেটা প্রমাণ করতে আসল ঘড়ির সাথে **তুলনা করতেই হয়**। ছাড় না
     *    দিলে দুটোর একটা হতো: হয় নিয়মটা suppress করে লেখা, নয়তো পাহারাটাই
     *    না লেখা — আর দুটোই খারাপ।
     */
    ignores: ['test/setup/**', 'test/clock.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'স্পেকে `new Date()` নয় (G140) — ফিক্সচারের মুহূর্তের জন্য হারনেসের `dhakaNoon()` নিন। মধ্যরাতের দুই পাশে পড়ে গিয়ে টেস্ট এই রিপোতে তিনবার ভেঙেছে।',
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'স্পেকে `Date.now()` নয় (G140) — সময়ের জন্য `dhakaNoon()`, আর অনন্য নামের জন্য `uniqueSuffix()` (হারনেস)।',
        },
      ],
    },
  },
);
