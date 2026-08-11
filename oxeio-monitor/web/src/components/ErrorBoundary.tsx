import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * শেষ জাল — কোনো পেজ render করতে গিয়ে ছুড়ে ফেললে **পুরো অ্যাপটা মুছে যাওয়া**
 * ঠেকায়।
 *
 * ⭐ কেন এটা দরকার, সেটা হাতে চালিয়ে দেখা হয়েছে: `/employees/:id` যদি
 *    প্রত্যাশার চেয়ে আলাদা আকারের JSON ফেরত দেয়, ভেতরের একটা কম্পোনেন্ট
 *    `undefined.length` পড়তে গিয়ে ছোড়ে — আর React তখন গোটা গাছটা unmount
 *    করে দেয়। ফল: হেডার, নেভ, সব উধাও, `document.body` একদম খালি। ঠিক
 *    যে "সাদা পর্দা" দেখলে মনে হয় সিস্টেমটা ভেঙে গেছে, সেটাই।
 *
 * ⚠️ এটা `<ErrorBox>`-এর বিকল্প নয়। **নেটওয়ার্কের ভুল** `useApi` ধরে,
 *    আর সেটাই স্বাভাবিক পথ। এই ক্লাসটা শুধু render-এর ভেতরের bug-এর জন্য —
 *    অর্থাৎ এটা দেখা যাওয়া মানেই কোথাও একটা আসল বাগ আছে, তাই বার্তাটা
 *    "একটু পরে দেখুন" নয়।
 *
 * ⚠️ ক্লাস কম্পোনেন্ট, কারণ React-এ error boundary বানানোর হুক নেই —
 *    `componentDidCatch`/`getDerivedStateFromError` ছাড়া উপায় নেই।
 */
interface Props {
  children: ReactNode;
  /** রুট বদলালে এটা বদলায় — নিচে দেখুন */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  /**
   * ⚠️ কনসোলে লেখা হয় ইচ্ছাকৃতভাবে — অফিসের সার্ভারে কোনো error-tracking
   *    সার্ভিস নেই, তাই ব্যবহারকারীর কাছ থেকে স্ক্রিনশট চাওয়া ছাড়া আর
   *    কোনো উপায় থাকবে না। নীরবে গিলে ফেললে বাগটা কখনো খুঁজে পাওয়া যেত না।
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[oXeio] Error while rendering the page:', error, info.componentStack);
  }

  /**
   * ⭐ রুট বদলালে নিজে থেকেই সেরে ওঠে। নইলে একটা পেজে একবার ভুল হলে
   *    ব্যবহারকারী অন্য ট্যাবে গিয়েও সেই ভুলের বার্তাটাই দেখত, আর মনে
   *    করত পুরো ড্যাশবোর্ডটাই মরে গেছে।
   */
  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="mx-auto max-w-xl rounded-xl border border-brand/30 bg-brand-bg px-5 py-6 text-center"
      >
        <p className="text-sm font-medium text-brand-ink">
          This page couldn't be displayed
        </p>
        <p className="mt-1.5 text-xs text-ink-3">
          The other tabs will still work. If it keeps happening, send a
          screenshot — this is a bug in the system, not something you did wrong.
        </p>
        {/* ⚠️ কারিগরি বার্তাটা লুকোনো হয় না — ওটাই বাগটা খুঁজে পাওয়ার একমাত্র সূত্র */}
        <pre className="num mt-3 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 text-left text-[11px] whitespace-pre-wrap text-ink-2">
          {error.message}
        </pre>
      </div>
    );
  }
}
