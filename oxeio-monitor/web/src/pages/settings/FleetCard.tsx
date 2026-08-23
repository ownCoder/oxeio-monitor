import type { AgentVersionView } from '../../api/admin';
import { listDevices } from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { PersonCell, Table } from '../../components/Table';
import { formatAgo } from '../../lib/format';
import {
  fleetGroups,
  fleetTally,
  newestOffered,
  type FleetGroup,
  type FleetRow,
} from './fleet';
import { Chip } from './ui';

/**
 * **কোন PC কোন বিল্ডে** *(১৮ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ **এটা "Devices" পর্দার প্রত্যাবর্তন নয়** — সেটা মালিক নিজেই তুলে
 * দিতে বলেছিলেন (G89: *"ami Devices ei option tai chai na, eta full
 * system take complex banacche"*), আর কারণটা এখনো ঠিক: একই প্রশ্নের উত্তর
 * দুই পর্দায় খুঁজতে হতো।
 *
 * ⭐ তাই তালিকাটা **এই ট্যাবেই**, যার নিজের বর্ণনাই লেখা *"Which build
 * each PC is offered"* — প্রশ্নটা যেখানে ওঠে, উত্তরটাও সেখানে। আর
 * ইচ্ছাকৃতভাবে **শুধু দেখার**: কোনো revoke/restore বোতাম নেই, কারণ এজেন্ট
 * বন্ধ-চালু হয় Staff সারিতে ("Turn agent on")। বোতাম বসালে ঠিক সেই
 * দুই-পর্দার দ্বিধাই ফিরে আসত।
 */
export function FleetCard({ versions }: { versions: AgentVersionView[] }) {
  const { data, loading, error, reload } = useApi(
    (signal) => listDevices(signal),
    [],
  );

  const newest = newestOffered(versions);
  /**
   * ⚠️ `new Date()` রেন্ডারের সময়েই নেওয়া হয় — "চুপ" হিসাবটা ২৪ ঘণ্টার
   * মাপে, তাই এক-দু সেকেন্ডের হেরফের এখানে অর্থহীন। মাসের হিসাবে এটা
   * করা যেত না, কিন্তু এখানে আলাদা ঘড়ি টানার দরকার নেই।
   */
  const groups = fleetGroups(data ?? [], newest, new Date());
  const tally = fleetTally(groups);

  return (
    <Card
      title="Where the Fleet Stands"
      hint="Which PC is running which build right now"
      padded={false}
    >
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} retry={reload} />}
      {!loading && !error && tally.total === 0 && (
        <Empty
          title="No active PCs"
          hint="Nothing is enrolled yet, so there is nothing to update."
        />
      )}

      {tally.total > 0 && (
        <>
          {/*
            ⚠️ কিছুই প্রকাশ করা না থাকলে (বা সব halted) অগ্রগতির বারটা
               দেখানো হয় না — "১৩/১৩ নতুন বিল্ডে" লেখাটা তখন **মিথ্যা**
               হতো; লক্ষ্যই নেই বলে কেউ হালনাগাদও নয়।
          */}
          {newest !== null && <RolloutBar tally={tally} newest={newest} />}
          <FleetTable groups={groups} />
        </>
      )}
    </Card>
  );
}

/**
 * ⭐⭐ **রোলআউট কতদূর — না গুনেই।**
 *
 * ⚠️ তিনটে ভাগ, দুটো নয়: `behind` PC-গুলো **নিজে থেকেই** আপডেট নেবে
 * (অপেক্ষাই যথেষ্ট), কিন্তু `stranded`-গুলোয় কাউকে গিয়ে MSI বসাতে হবে।
 * একসাথে "পুরোনো" বললে ওই করণীয়ের তফাতটাই হারিয়ে যেত — আর ঠিক সেই
 * তফাতটা না জানার কারণেই ১৮ আগস্ট ধরে নেওয়া হয়েছিল যে `partial` করলেই
 * সবাই আপডেট পাবে ([09 § ৩ভ৯](../../../../docs/09-Build-Log.md))।
 */
function RolloutBar({
  tally,
  newest,
}: {
  tally: ReturnType<typeof fleetTally>;
  newest: string;
}) {
  const pct = (n: number) => `${(n / tally.total) * 100}%`;

  return (
    <div className="border-b border-line px-4 pt-3 pb-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink-2">
          <span className="num font-semibold text-ink">{tally.newest}</span> of{' '}
          <span className="num">{tally.total}</span> PCs are on{' '}
          <span className="num font-semibold">{newest}</span>
        </span>
      </div>

      {/* ⚠️ `flex` + শতাংশ প্রস্থ — একটা `<div>`-এ gradient দিলে ভাগগুলোর
          সীমানা ঝাপসা হতো, আর এখানে সীমানাটাই তথ্য */}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
        <div style={{ width: pct(tally.newest) }} className="bg-ok" />
        <div style={{ width: pct(tally.behind) }} className="bg-idle" />
        <div style={{ width: pct(tally.stranded) }} className="bg-brand" />
        <div style={{ width: pct(tally.unknown) }} className="bg-ink-3" />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        <Key tone="bg-ok" n={tally.newest} label="on the newest build" />
        <Key tone="bg-idle" n={tally.behind} label="behind — they update themselves" />
        <Key tone="bg-brand" n={tally.stranded} label="too old to update themselves" />
        <Key tone="bg-ink-3" n={tally.unknown} label="never reported a version" />
      </div>
    </div>
  );
}

/** ⚠️ শূন্য হলে দেখানোই হয় না — "০ টা পুরোনো" পড়তে সময় লাগে, বুঝতে লাগে না */
function Key({ tone, n, label }: { tone: string; n: number; label: string }) {
  if (n === 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-[2px] ${tone}`} />
      <span className="num font-semibold text-ink">{n}</span>
      <span>{label}</span>
    </span>
  );
}

/** টেবিলের সারি — সাথে কোন দলে আছে আর দলের প্রথম কিনা */
interface Flat extends FleetRow {
  group: FleetGroup;
  first: boolean;
}

function FleetTable({ groups }: { groups: FleetGroup[] }) {
  const rows: Flat[] = groups.flatMap((group) =>
    group.rows.map((row, i) => ({ ...row, group, first: i === 0 })),
  );

  return (
    <Table
      rows={rows}
      rowKey={(r) => String(r.deviceId)}
      groupBefore={(r) => (r.first ? <VersionBand group={r.group} /> : null)}
      columns={[
        {
          key: 'staff',
          header: 'Staff',
          render: (r) =>
            r.employee ? (
              <PersonCell
                fullName={r.employee.fullName}
                empCode={r.employee.empCode}
              />
            ) : (
              // ⚠️ কর্মীর সাথে যুক্ত নয় এমন ডিভাইসও দেখানো হয় — লুকিয়ে
              //    ফেললে ফ্লিটের গোনাটা পাশের কলামের সাথে মিলত না
              <span className="text-ink-3">Not linked to anyone</span>
            ),
        },
        {
          key: 'pc',
          header: 'PC',
          render: (r) => <span className="num">{r.hostname}</span>,
        },
        {
          key: 'user',
          header: 'Windows user',
          render: (r) => (
            <span className="num text-ink-3">{r.windowsUsername}</span>
          ),
        },
        {
          key: 'seen',
          header: 'Last seen',
          align: 'right',
          render: (r) => (
            <span className={`num ${r.quiet ? 'text-brand-ink' : 'text-ink-3'}`}>
              {formatAgo(r.lastSeenAt)}
            </span>
          ),
        },
        {
          key: 'flag',
          header: '',
          /*
            ⭐ সারিতে চিহ্ন কেবল তখনই, যখন **এই সারিটার নিজের** কিছু বলার
               আছে। ভার্সন কতটা পিছিয়ে সেটা উপরের ব্যান্ডেই লেখা, তাই
               প্রতি সারিতে একই কথা আবার বসালে সেটা তথ্য নয়, গোলমাল।
          */
          render: (r) =>
            r.quiet ? <Chip tone="attention">Quiet</Chip> : null,
        },
      ]}
    />
  );
}

/**
 * ⭐ দলের মাথায় এক লাইন — ভার্সন, কতগুলো, আর **করণীয়**।
 *
 * ⚠️ করণীয়টা লেখা থাকা জরুরি: "০.৩.৭ · ৫টা PC" পড়ে বোঝা যায় না যে ওই
 * পাঁচটায় গিয়ে হাতে বসাতে হবে, অথচ সেটাই একমাত্র উপায়।
 */
function VersionBand({ group }: { group: FleetGroup }) {
  const n = group.rows.length;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="num text-[14px] font-semibold text-ink">
        {group.version ?? 'Version unknown'}
      </span>
      <span className="text-[12.5px] text-ink-3">
        {n} {n === 1 ? 'PC' : 'PCs'}
      </span>

      {group.lag === 'newest' && (
        <span className="text-[12.5px] text-ok-ink">· newest build</span>
      )}
      {group.lag === 'behind' && (
        <span className="text-[12.5px] text-idle-ink">
          · behind — the tray offers the update by itself
        </span>
      )}
      {group.lag === 'stranded' && (
        <span className="text-[12.5px] text-brand-ink">
          · too old to update itself — install the MSI by hand
        </span>
      )}
      {group.lag === 'unknown' && (
        <span className="text-[12.5px] text-ink-3">
          · the agent never said which build it runs
        </span>
      )}
    </div>
  );
}
