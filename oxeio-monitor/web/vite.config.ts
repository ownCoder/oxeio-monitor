import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
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
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
