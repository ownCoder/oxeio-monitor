import { Page } from '../components/Page';
import { TargetList } from './AllTargetsPage';

/**
 * ⭐⭐ **Review** *(মালিকের নির্দেশ, ৩১ আগস্ট ২০২৬: "side bar e design pool
 * er niche review name ekta page koro. sekhane ei deleted and skip deya
 * design show korao")*।
 *
 * ⚠️⚠️ **নিজের পাতা, কারণ এটা অন্য মানুষের কাজ।** Design Pool গবেষকের
 * রোজকার পাতা — ৩৯ হাজার সারি, চারটে কিউ, জমা দেওয়ার ঘর। বাদ-যাওয়া
 * ডিজাইন দেখা মালিক ও ম্যানেজারের কাজ, আর সেটা রোজ নয়। ⭐ এক পাতায়
 * রাখলে দুই দলের কাজ একই পর্দায় মিশে থাকত, আর ২৫ আগস্টের ছাঁটাইয়ের গোটা
 * কথাই ছিল উল্টোটা।
 *
 * ⚠️ টেবিলটা **নকল নয়** — `AllTargetsPage`-এর `TargetList`-ই, কেবল
 * `to_review` কিউতে আটকানো (১৭ আগস্টে Worklog-এর সময় শেখা নিয়ম)।
 *
 * ⚠️ পাতাটা owner ও manager ছাড়া কেউ দেখেন না — সাইডবার, রুট আর
 * সার্ভারের `@Roles` তিন জায়গাতেই এক।
 */
export function ReviewPage() {
  return (
    <Page
      title="Review"
      subtitle="Skipped and deleted designs — and why"
    >
      <TargetList lockedStage="to_review" />
    </Page>
  );
}
