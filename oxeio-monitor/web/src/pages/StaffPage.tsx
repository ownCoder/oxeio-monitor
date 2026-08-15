import { useNavigate } from 'react-router';

import { getLiveBoard, type LiveCard } from '../api/dashboard';
import { usePolling } from '../api/useApi';
import { Page } from '../components/Page';
import { ErrorBox, Empty, Loading } from '../components/States';
import { StatusChip } from '../components/StatusDot';
import { PersonCell, Table, type Column } from '../components/Table';
import { formatDuration, formatTime } from '../lib/format';

/** বোর্ডের মতোই ৩০ সেকেন্ড — দুটো পর্দা একই সংখ্যা দেখায়, একই তালে */
const REFRESH_MS = 30_000;

/**
 * ⭐⭐ **Staff — সবাইকে এক তালিকায়** *(মালিকের চাওয়া, ১৫ আগস্ট)*।
 *
 * ⚠️⚠️ **এটা Settings → Staff-এর নকল নয়, আর সেই পার্থক্যটাই এই পাতার
 * অস্তিত্বের কারণ।** ওখানে কর্মী **সম্পাদনা** করা হয় — বেতন, পলিসি,
 * portal অ্যাকাউন্ট, এজেন্ট চালু করা। এখানে কেবল **দেখা** হয়: কে এখন
 * কী করছে, আজ কত হলো, এজেন্ট কথা বলছে কি না।
 *
 * ⚠️ আগে সাইডবারে `/staff` বলে একটা ট্যাব ছিল, আর সেটা **তুলে দেওয়া
 * হয়েছিল** — কারণ পাতাটা ছিলই না, ট্যাবটা "পাওয়া যায়নি"-তে গিয়ে ঠেকত।
 * মকআপ ক-এ ওটা আছে, আর মালিক বলেছেন নকল না বানিয়ে **আসল পাতা** বানাতে।
 *
 * ⭐ ডেটা `/live` থেকেই — নতুন কোনো endpoint নয়। ⚠️ তাই বোর্ড আর এই
 * পাতা কখনো দুই সংখ্যা বলতে পারে না (G88); একটা নতুন কোয়েরি লিখলে
 * ঠিক সেই দরজাটাই আবার খুলত।
 */
export function StaffPage() {
  const navigate = useNavigate();
  const board = usePolling((signal) => getLiveBoard(signal), REFRESH_MS, []);

  const cards = board.data?.cards ?? [];

  const columns: Column<LiveCard>[] = [
    {
      key: 'person',
      header: 'Staff',
      className: 'min-w-44',
      render: (c) => (
        <PersonCell
          fullName={c.fullName}
          empCode={c.empCode}
          note={c.designation}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <StatusChip status={c.status} />,
    },
    {
      key: 'today',
      header: 'Today',
      align: 'right',
      render: (c) => (
        <span className="num font-semibold">
          {formatDuration(c.todayWorkedSec)}
        </span>
      ),
    },
    {
      key: 'month',
      header: 'This month',
      align: 'right',
      render: (c) => (
        <span className="num text-ink-2">
          {formatDuration(c.monthWorkedSec)}
          <small className="ml-1 text-[11px] text-ink-3">
            /{Math.round(c.monthTargetSec / 3600)}h
          </small>
        </span>
      ),
    },
    {
      key: 'seen',
      header: 'Agent last spoke',
      align: 'right',
      /*
        ⭐ এই কলামটাই এই পাতার একমাত্র জিনিস যা বোর্ডে নেই — বোর্ডে
           অবস্থাটা রঙে বোঝা যায়, কিন্তু "কতক্ষণ আগে" সংখ্যাটা নয়।

        ⚠️ `—` মানে **একবারও সাড়া দেয়নি**, "এইমাত্র" নয়। এজেন্ট বসানো
           আছে অথচ কোনোদিন কথা বলেনি — ওটা আলাদা ঘটনা, আর ফাঁকা ঘর
           দিয়ে সেটা বোঝা যেত না।
      */
      render: (c) =>
        c.lastHeartbeatAt ? (
          <span className="num text-ink-2">
            {formatTime(c.lastHeartbeatAt)}
          </span>
        ) : (
          <span className="text-ink-3" title="This agent has never checked in">
            —
          </span>
        ),
    },
  ];

  return (
    <Page
      title="Staff"
      subtitle={
        board.data
          ? `${cards.length} active · updated every 30 seconds`
          : 'Everyone on the board'
      }
    >
      {board.loading && !board.data ? (
        <Loading label="Loading staff…" />
      ) : !board.data ? (
        <ErrorBox error={board.error} retry={board.reload} />
      ) : cards.length === 0 ? (
        <Empty
          title="No active staff yet"
          hint="Add people in Settings → Staff, then install the agent on their PC."
        />
      ) : (
        <Table
          columns={columns}
          rows={cards}
          rowKey={(c) => String(c.employeeId)}
          /*
            ⭐ সারিতে ক্লিক করলে তাঁর নিজের পাতা — মকআপে তালিকাটার
               একমাত্র কাজই ছিল ওখানে পৌঁছে দেওয়া।
          */
          onRowClick={(c) => navigate(`/staff/${c.employeeId}`)}
        />
      )}
    </Page>
  );
}
