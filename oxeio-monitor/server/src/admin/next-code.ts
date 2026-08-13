/**
 * পরের কর্মী-কোড কী হবে — খাঁটি ফাংশন, কোনো I/O নেই।
 *
 * ⭐ **কেন আলাদা ফাইল:** "পরেরটা কোনটা" প্রশ্নের উত্তর দেখতে সহজ, কিন্তু
 * সীমানাগুলো নয় — মিশ্র প্রস্থ (`OX-01` বনাম `OX-001`), অন্য উপসর্গ,
 * সংখ্যা-নয় এমন কোড, খালি তালিকা। DB-র ভেতরে বসে থাকলে এর একটাও যাচাই
 * করা যেত না।
 *
 * ⚠️ এটা **পরামর্শ**, নিশ্চয়তা নয়। পর্দায় ঘরটা সম্পাদনযোগ্যই থাকে, আর
 * আসল সুরক্ষা ডাটাবেসের unique constraint — দুজন একসাথে যোগ করলে
 * দ্বিতীয়জন ৪০৯ পাবে, আর সেটাই ঠিক।
 */

/** `OX-001` ধাঁচ — উপসর্গ, তারপর হাইফেন, তারপর শুধু অঙ্ক */
const PATTERN = /^([A-Za-z_]+)-(\d+)$/;

const DEFAULT_PREFIX = 'OX';
const DEFAULT_WIDTH = 3;

interface Parsed {
  prefix: string;
  value: number;
  width: number;
}

function parse(code: string): Parsed | null {
  const m = PATTERN.exec(code.trim());
  if (!m) return null;

  return { prefix: m[1], value: Number(m[2]), width: m[2].length };
}

/**
 * @param existing ডাটাবেসের **সব** কর্মীর কোড — active ও inactive দুটোই।
 *
 * ⚠️⚠️ inactive-দেরও দিতে হবে। শুধু active দিলে ছাঁটাই হওয়া কর্মীর কোডটা
 * আবার পরামর্শ হিসেবে আসত, আর সেভ করতে গিয়ে ৪০৯ — অথচ পর্দায় ওই কোডের
 * কাউকে দেখা যেত না, তাই কারণটা বোঝাই যেত না।
 */
export function nextEmployeeCode(existing: readonly string[]): string {
  const parsed = existing
    .map(parse)
    .filter((p): p is Parsed => p !== null);

  if (parsed.length === 0) {
    // ⚠️ `OX-001`, `OX-1` নয় — পর্দার হিন্টেও এই উদাহরণটাই দেওয়া আছে,
    //    আর তিন অঙ্কে ৯৯৯ জন পর্যন্ত ক্রম ঠিক থাকে।
    return `${DEFAULT_PREFIX}-${'1'.padStart(DEFAULT_WIDTH, '0')}`;
  }

  /**
   * ⭐ সবচেয়ে **বড় সংখ্যাটাই** ভিত্তি, আর প্রস্থও তারই।
   *
   * ⚠️ প্রকৃত ডেটায় দুই ধাঁচ পাশাপাশি আছে — `OX-001` (মালিক নিজে হাতে
   * বসিয়েছেন) আর `OX-01`…`OX-12` (seed থেকে)। "সবচেয়ে চওড়াটা নাও" ধরলে
   * পরেরটা হতো `OX-013`, অর্থাৎ চলতি ক্রম থেকে ছিটকে যেত। বদলে যেখানে
   * থেমেছিলেন সেখান থেকেই এগোনো হয় — `OX-12` → `OX-13`।
   */
  let best = parsed[0];
  for (const p of parsed) {
    if (p.value > best.value) best = p;
  }

  const prefix = mostCommonPrefix(parsed) ?? best.prefix;
  const next = best.value + 1;

  // ⚠️ সংখ্যাটা প্রস্থ ছাড়িয়ে গেলে (৯৯ → ১০০) আর কাটা যায় না, তাই
  //    `padStart` স্বাভাবিকভাবেই বড় হতে দেয়।
  return `${prefix}-${String(next).padStart(best.width, '0')}`;
}

/**
 * ⚠️ উপসর্গ **সবচেয়ে বড় কোডের** থেকে নেওয়া হয় না, সবচেয়ে **প্রচলিতটা**
 * থেকে নেওয়া হয়। কেউ একবার `TMP-99` বসালে পরের সব পরামর্শ `TMP-` হয়ে
 * যেত, অথচ বাকি ১২ জন `OX-`।
 */
function mostCommonPrefix(parsed: readonly Parsed[]): string | null {
  const counts = new Map<string, number>();
  for (const p of parsed) counts.set(p.prefix, (counts.get(p.prefix) ?? 0) + 1);

  let winner: string | null = null;
  let top = 0;
  for (const [prefix, n] of counts) {
    if (n > top) {
      top = n;
      winner = prefix;
    }
  }
  return winner;
}
