/**
 * পেজের ভেতরের ট্যাবের সারি — রিপোর্ট (৩–৪টা) আর সেটিংস (৫টা) দুজনেই এটাই
 * ব্যবহার করে।
 *
 * ⭐ দুই এজেন্ট আলাদা করে প্রায় হুবহু একই markup লিখেছিল, আর সেটাই ছিল
 *    আসল ঝুঁকি: ট্যাব **রুট নয়**, তাই দেখতে এক না হলে ব্যবহারকারী ভাবত
 *    দুটো আলাদা জিনিস। এক জায়গায় থাকলে সরু লাল রেখার ওজন, ফাঁক আর ফোকাস
 *    রিং একসাথেই বদলায়।
 *
 * ⚠️ **সরু ব্র্যান্ড-লাল নিচের রেখা, সলিড লাল নয়** — বাছাই করা ট্যাব কোনো
 *    ভুল নয়, শুধু একটা পছন্দ। ভরাট লাল হলে প্রতিটা ট্যাব "সমস্যা" মনে হতো।
 *
 * ⚠️ E12 — সারিটা **নিজেই** আড়াআড়ি স্ক্রল করে (`overflow-x-auto`), পুরো
 *    পাতা নয়। ৩৭৫px-এ সেটিংসের পাঁচটা ট্যাব একসাথে আঁটে না।
 *
 * ⚠️⚠️ **সাথে `overflow-y-hidden` — আর এটা বাদ দেওয়া যাবে না।**
 *
 *    Tailwind-এর `overflow-x-auto` **দুই অক্ষেই** `auto` বসায়। ভেতরের
 *    বোতামগুলো (প্যাডিং + বাছাই করা ট্যাবের ২px নিচের রেখা) ঘরটার চেয়ে
 *    ঠিক **এক পিক্সেল** উঁচু হয়ে যায় — আর তাতেই ব্রাউজার একটা **উল্লম্ব
 *    scrollbar** এঁকে দেয়, যেটা আবার ১৫px চওড়া জায়গা কেড়ে নেয়
 *    (`clientWidth 1280 → 1265`)।
 *
 *    ⭐ ম্যাকে ধরা পড়ে না — ওখানে scrollbar ভাসমান ও প্রায় অদৃশ্য।
 *    Windows-এ ওটা তীরসহ মোটা বার, আর মালিকের পর্দায় "Add staff"-এর
 *    উপরে একটা অদ্ভুত ফাঁকা বাক্স হয়ে দাঁড়ায় (১৪ আগস্ট, তাঁর রিপোর্ট)।
 *
 *    ⚠️ এক ডেভেলপারের OS-এ অদৃশ্য একটা খুঁত অন্যের পর্দায় স্পষ্ট — তাই
 *    "আমার এখানে তো ঠিক দেখাচ্ছে" কখনো প্রমাণ নয়।
 *
 * ⚠️ `<Link>` নয়, `<button>` — ট্যাবগুলো আলাদা রুট নয়। নেভিগেশনের ট্যাব
 *    (উপরের হেডারে) `Layout.tsx`-এ, `NavLink` দিয়ে; দুটো গুলিয়ে ফেলবেন না।
 */
export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  label,
}: {
  items: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  /** স্ক্রিন-রিডারের জন্য — "সেটিংসের অংশ", "রিপোর্টের ধরন" */
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line"
    >
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onChange(item.id)}
            // ⚠️ `tap` — ফোনে ৪৪px (`index.css`)। ট্যাব ছিল ~৩৮px, আর
            //    সারিটা আড়াআড়ি স্ক্রল করে বলে আঙুল এমনিতেই নড়ে থাকে।
            className={`tap -mb-px border-b-2 px-3 py-2.5 text-[13px] whitespace-nowrap transition focus:outline-none focus:ring-2 focus:ring-brand/30 ${
              selected
                ? 'border-brand font-semibold text-brand-ink'
                : 'border-transparent text-ink-2 hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
