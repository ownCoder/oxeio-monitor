import { ApiError } from '../api/client';
import { getLiveBoard } from '../api/dashboard';
import { usePolling } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/Page';
import { ErrorBox, Loading } from '../components/States';
import { TeamRoster } from './live/TeamRoster';

/**
 * **Worklog — এখন কে কাজ করছেন, কে করছেন না।**
 *
 * ⭐⭐ কার্ডগুলো ছিল Live Board-এর **সবচেয়ে নিচে**, ছ-টা টাইল ও চারটে
 * চার্ট পেরিয়ে। অথচ *"এখন কে কাজ করছে?"* — এটাই সবচেয়ে বেশিবার করা
 * প্রশ্ন। মালিকের অনুরোধে (১৭ আগস্ট) সেটা নিজের পাতায় এল, এক ক্লিক দূরে।
 *
 * ⚠️⚠️ **Live Board থেকে সরানো হয়েছে, নকল করা হয়নি।** দুই জায়গায় রাখলে
 * একদিন একটা বদলাত আর অন্যটা নয়। বোর্ডে এখন থাকে সারাংশ — টাইল, চার্ট
 * আর দলের টেবিল; কার্ড এখানে।
 *
 * ⚠️ রিফ্রেশের ছন্দ বোর্ডের মতোই **১৫ সেকেন্ড** (`BOARD_REFRESH_MS`-এর
 * সমান)। দুটো আলাদা হলে একই মুহূর্তে দুই পাতায় দুই সংখ্যা দেখা যেত, আর
 * কোনটা তাজা তা বলার উপায় থাকত না।
 */

/** ⚠️ `LiveBoardPage`-এর `BOARD_REFRESH_MS`-এর সাথে মিলিয়ে রাখা */
const REFRESH_MS = 15_000;

export function WorklogPage() {
  const { user } = useAuth();

  /**
   * ⚠️ owner ও manager — `/live` কন্ট্রোলারের `@Roles`-এর সাথে হুবহু এক।
   *    কর্মীর জন্য পাতাটা খুললে তাঁর ব্রাউজার প্রতি ১৫ সেকেন্ডে একটা করে
   *    ৪০৩ কুড়াত, কোনো লাভ ছাড়াই।
   */
  const canView = user?.role === 'owner' || user?.role === 'manager';

  const board = usePolling(
    (signal) => (canView ? getLiveBoard(signal) : Promise.resolve(null)),
    REFRESH_MS,
    [canView],
  );

  if (!canView) {
    return (
      <Page title="Worklog">
        <ErrorBox error={new ApiError(403, "You don't have access")} />
      </Page>
    );
  }

  const data = board.data;

  return (
    <Page
      title="Worklog"
      subtitle="Who is working right now, and who is not"
    >
      {/*
        ⚠️ রিফ্রেশে পুরো পর্দা লোডিং-এ যায় না — `usePolling` পুরোনো ডেটা
           ধরে রাখে। উল্টোটা হলে প্রতি ১৫ সেকেন্ডে কার্ডগুলো ঝিকমিক করত
           আর কেউ একটাও পড়ে শেষ করতে পারতেন না।
      */}
      {board.loading && !data ? (
        <Loading label="Loading the team…" />
      ) : !data ? (
        <ErrorBox error={board.error} retry={board.reload} />
      ) : (
        <TeamRoster
          cards={data.cards}
          canView={canView}
          withTarget={
            data.cards.filter((c) => c.todayIsWorkday && c.dailyTargetSec > 0)
              .length
          }
        />
      )}
    </Page>
  );
}
