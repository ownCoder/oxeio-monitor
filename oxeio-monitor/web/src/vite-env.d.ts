/// <reference types="vite/client" />

/**
 * ⭐ বিল্ডের সময় বসানো ভার্সন-চলকগুলো (web/Dockerfile → VITE_APP_*)।
 *
 * ⚠️ টাইপ না দিলে `import.meta.env.VITE_APP_BUILD` `any` হয়ে যেত, আর
 *    নামের বানান ভুল করলেও কম্পাইলার চুপ থাকত — ব্যাজে চিরকাল "dev"।
 */
interface ImportMetaEnv {
  readonly VITE_APP_BUILD?: string;
  readonly VITE_APP_COMMIT?: string;
  readonly VITE_APP_BUILT_AT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
