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
);
