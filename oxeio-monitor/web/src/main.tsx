import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';
import { registerServiceWorker } from './pwa';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * ⭐ PWA — হোমস্ক্রিন থেকে খোলার জন্য অ্যাপ-শেল ক্যাশ হয়।
 *
 * ⚠️ রেন্ডারের **পরে** ডাকা হয়: ফাংশনটা নিজে `load` ইভেন্টের অপেক্ষা করে,
 *    তাই এটা প্রথম পেইন্টের সাথে কিছুর জন্য লড়ে না।
 * ⚠️⚠️ সার্ভিস ওয়ার্কার **কোনো API উত্তর ক্যাশ করে না** — কারণ `pwa-sw.ts`-এ
 *    লেখা (লাইভ সংখ্যা + স্ক্রিনশট)।
 */
registerServiceWorker();
