import { useState } from 'react';

import {
  createCategory,
  deleteCategory,
  listCategories,
  recategorize,
  updateCategory,
  type CategoryRuleView,
  type CreateCategoryBody,
  type MatchType,
  type Productivity,
} from '../../api/activity';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Button } from '../../components/Page';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { Table, type Column } from '../../components/Table';
import { formatCount } from '../../lib/format';
import {
  Chip,
  ConfirmDialog,
  FormGrid,
  FullWidth,
  MiniButton,
  Modal,
  Notice,
  RowActions,
  SelectField,
  ServerError,
  TextField,
  useMutation,
} from './ui';

/**
 * D06 — ক্যাটাগরির নিয়ম (owner-only)।
 *
 * ⭐ এই পর্দার দুটো কথা না বললে সবাই ঠকে:
 *
 *   ১· **ছোট priority আগে জেতে।** ২০০ দিলে সেটা "বেশি গুরুত্ব" নয়, বরং
 *      কার্যত সবার শেষে। seed-এ ব্রাউজারের নিয়ম ২০০, বাকিরা ১০০ — অর্থাৎ
 *      ডোমেইনের নিয়ম ব্রাউজারের নিয়মকে হারায়।
 *
 *   ২· **ক্যাটাগরি বসে ingest-এর সময়, পড়ার সময় নয়।** নিয়ম বদলালে পুরোনো
 *      সারিতে পুরোনো সিদ্ধান্তই বসে থাকে — তাই recategorize বোতামটা আছে,
 *      আর সেটা না চালালে রিপোর্ট সপ্তাহের পর সপ্তাহ পুরোনো নিয়মে চলে।
 */

const MATCH_LABEL: Record<MatchType, string> = {
  process: 'প্রসেস',
  domain: 'ডোমেইন',
  title_regex: 'টাইটেল regex',
};

const MATCH_OPTIONS = [
  { value: 'process', label: 'প্রসেস — code.exe' },
  { value: 'domain', label: 'ডোমেইন — youtube.com' },
  { value: 'title_regex', label: 'টাইটেল regex' },
];

/** ⭐ মকআপের ভাষাই রাখা হয়েছে — রিপোর্টের লেজেন্ডেও এই তিনটে শব্দই */
const CATEGORY_OPTIONS = [
  { value: 'productive', label: 'Productive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'unproductive', label: 'Unproductive' },
];

const PATTERN_HINT: Record<MatchType, string> = {
  process:
    'শুধু ফাইলের নাম — পুরো পাথ নয় (যেমন code.exe)। এজেন্ট শুধু নামটাই পাঠায়।',
  domain:
    'শুধু ডোমেইন, কখনো পুরো URL (যেমন youtube.com)। ফুল URL কোথাও জমাই হয় না, তাই "/"-ওয়ালা নিয়ম কোনোদিন মিলত না।',
  title_regex:
    'JavaScript regex, case-insensitive। উইন্ডোর শিরোনামের সাথে মেলানো হয়।',
};

export function CategoriesTab() {
  const rules = useApi((signal) => listCategories(signal), []);

  const [editing, setEditing] = useState<CategoryRuleView | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<CategoryRuleView | null>(null);
  const [rerunning, setRerunning] = useState(false);
  /** শেষ কাজের ফল — মুছে ফেলা বা recategorize-এর পর কী হলো */
  const [outcome, setOutcome] = useState<string | null>(null);

  const rows = rules.data ?? [];

  const columns: Column<CategoryRuleView>[] = [
    {
      key: 'priority',
      header: 'priority',
      align: 'right',
      render: (rule) => <span className="num">{rule.priority}</span>,
    },
    {
      key: 'matchType',
      header: 'ধরন',
      render: (rule) => <Chip>{MATCH_LABEL[rule.matchType]}</Chip>,
    },
    {
      key: 'pattern',
      header: 'প্যাটার্ন',
      render: (rule) => <span className="num">{rule.pattern}</span>,
    },
    {
      key: 'displayName',
      header: 'যে নামে দেখা যাবে',
      render: (rule) => rule.displayName,
    },
    {
      key: 'category',
      header: 'ক্যাটাগরি',
      // ⭐ ব্র্যান্ডের নিয়মটাই এখানে হুবহু খাটে: কালো = গোনা হওয়া কাজ,
      //    ধূসর = গোনা হয়নি। লাল ব্যবহার করা হয়নি — unproductive হওয়া
      //    কোনো ভুল নয়, শুধু একটা শ্রেণি।
      render: (rule) => (
        <Chip tone={rule.category === 'productive' ? 'counted' : 'muted'}>
          {rule.category}
        </Chip>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (rule) => (
        <RowActions>
          <MiniButton onClick={() => setEditing(rule)}>সম্পাদনা</MiniButton>
          <MiniButton tone="danger" onClick={() => setRemoving(rule)}>
            মুছুন
          </MiniButton>
        </RowActions>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <Notice>
        <strong>ছোট priority আগে জেতে</strong> — প্রথম যে নিয়মটা মেলে, সেটাই
        বসে যায়। নিচের তালিকাটা ঠিক সেই ক্রমেই সাজানো, তাই উপরের নিয়ম নিচেরটাকে
        হারায়। ২০০ দিলে সেটা "বেশি গুরুত্ব" নয়, বরং কার্যত সবার শেষে।
      </Notice>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={() => setRerunning(true)}>
          পুরোনো সারিতে নিয়ম বসান
        </Button>
        <Button tone="primary" onClick={() => setCreating(true)}>
          নতুন রুল
        </Button>
      </div>

      {outcome && (
        <div role="status">
          <Notice>{outcome}</Notice>
        </div>
      )}

      {rules.loading && !rules.data && <Loading />}
      {rules.error && <ErrorBox error={rules.error} retry={rules.reload} />}

      {!rules.loading && !rules.error && rows.length === 0 && (
        <Empty
          title="একটাও ক্যাটাগরি রুল নেই"
          hint="রুল ছাড়া প্রতিটা অ্যাপ ও সাইট 'অচেনা' থেকে যাবে, আর productivity স্কোর কখনো তৈরি হবে না। সাধারণত seed-এ ৮০+ রুল বসানো থাকে — একটাও না থাকলে সেটা অস্বাভাবিক।"
          action={
            <Button tone="primary" onClick={() => setCreating(true)}>
              নতুন রুল
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <Card
          padded={false}
          title={`রুল · ${rows.length}টি`}
          hint="যে ক্রমে নিচে দেখানো হচ্ছে, ঠিক সেই ক্রমেই মেলানো হয়"
        >
          <Table
            columns={columns}
            rows={rows}
            rowKey={(rule) => String(rule.id)}
          />
        </Card>
      )}

      {(creating || editing) && (
        <RuleForm
          key={editing?.id ?? 'new'}
          rule={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(message) => {
            setCreating(false);
            setEditing(null);
            setOutcome(message);
            rules.reload();
          }}
        />
      )}

      {removing && (
        <RemoveDialog
          rule={removing}
          onClose={() => setRemoving(null)}
          onDone={(message) => {
            setRemoving(null);
            setOutcome(message);
            rules.reload();
          }}
        />
      )}

      {rerunning && (
        <RecategorizeDialog
          onClose={() => setRerunning(false)}
          onDone={(message) => {
            setRerunning(false);
            setOutcome(message);
          }}
        />
      )}
    </div>
  );
}

// ── রুল যোগ ও সম্পাদনা ──────────────────────────────────────────────────────

function RuleForm({
  rule,
  onClose,
  onSaved,
}: {
  rule: CategoryRuleView | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [matchType, setMatchType] = useState<MatchType>(
    rule?.matchType ?? 'domain',
  );
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [displayName, setDisplayName] = useState(rule?.displayName ?? '');
  const [category, setCategory] = useState<Productivity>(
    rule?.category ?? 'neutral',
  );
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));

  const { busy, error, run } = useMutation();

  const incomplete = pattern.trim() === '' || displayName.trim() === '';

  const submit = (): void => {
    run(async () => {
      const body: CreateCategoryBody = {
        matchType,
        pattern: pattern.trim(),
        displayName: displayName.trim(),
        category,
        priority: Number(priority),
      };

      if (rule) {
        await updateCategory(rule.id, body);
        // ⚠️ রুল **বদলানোর** পর `onlyUnmatched: false` লাগে — পুরোনো
        //    সিদ্ধান্ত বসানো সারিগুলো নইলে পুরোনোই থেকে যেত
        onSaved(
          'রুলটা বদলানো হয়েছে। পুরোনো সারিতে এখনো পুরোনো সিদ্ধান্ত বসে আছে — "পুরোনো সারিতে নিয়ম বসান" চালিয়ে "সব সারি" বাছুন।',
        );
      } else {
        await createCategory(body);
        onSaved(
          'নতুন রুল যোগ হয়েছে। এখন থেকে আসা ডেটায় এটা বসবে; পুরোনো অচেনা সারিতেও বসাতে চাইলে "পুরোনো সারিতে নিয়ম বসান" চালান।',
        );
      }
    });
  };

  return (
    <Modal
      title={rule ? 'রুল সম্পাদনা' : 'নতুন ক্যাটাগরি রুল'}
      hint="একটা অ্যাপ বা সাইট কোন ক্যাটাগরিতে পড়বে"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            বাতিল
          </Button>
          <Button tone="primary" onClick={submit} disabled={busy || incomplete}>
            {busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <SelectField
            label="কী দেখে মেলানো হবে"
            value={matchType}
            onChange={(value) => setMatchType(value as MatchType)}
            options={MATCH_OPTIONS}
          />
          <SelectField
            label="ক্যাটাগরি"
            value={category}
            onChange={(value) => setCategory(value as Productivity)}
            options={CATEGORY_OPTIONS}
          />

          <FullWidth>
            <TextField
              label="প্যাটার্ন"
              value={pattern}
              onChange={setPattern}
              required
              mono
              autoFocus
              maxLength={260}
              hint={PATTERN_HINT[matchType]}
            />
          </FullWidth>

          <TextField
            label="যে নামে দেখা যাবে"
            value={displayName}
            onChange={setDisplayName}
            required
            maxLength={100}
            hint="রিপোর্টে এই নামটাই দেখানো হবে"
          />

          <TextField
            label="priority"
            type="number"
            value={priority}
            onChange={setPriority}
            mono
            min={1}
            max={1000}
            hint="⚠️ ছোট সংখ্যা আগে জেতে। ডিফল্ট 100; ব্রাউজারের সাধারণ রুলগুলো 200, তাই নির্দিষ্ট ডোমেইনের রুল ওদের হারায়।"
          />
        </FormGrid>

        <ServerError error={error} />
      </div>
    </Modal>
  );
}

// ── মোছা ────────────────────────────────────────────────────────────────────

function RemoveDialog({
  rule,
  onClose,
  onDone,
}: {
  rule: CategoryRuleView;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { busy, error, run } = useMutation();

  return (
    <ConfirmDialog
      title={`"${rule.pattern}" রুলটি মুছবেন?`}
      intro={`${MATCH_LABEL[rule.matchType]} · ${rule.displayName} · ${rule.category}`}
      warning="এই রুলে যত সারি বসানো ছিল, সেগুলোর ক্যাটাগরি এখনই 'অচেনা' হয়ে যাবে — অর্থাৎ ওই সময়টা productivity স্কোরের বাইরে চলে যাবে। কতগুলো সারি, সেটা মোছার পর দেখানো হবে।"
      confirmLabel="মুছে ফেলুন"
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        run(async () => {
          const result = await deleteCategory(rule.id);
          // ⭐ সার্ভারের `hint` হুবহু দেখানো হয় — ওখানেই লেখা আছে এরপর কী করতে হবে
          onDone(
            result.orphanedRows === 0
              ? `রুলটা মোছা হয়েছে। ${result.hint}`
              : `রুলটা মোছা হয়েছে — ${formatCount(result.orphanedRows)}টি সারি এখন অচেনা। ${result.hint}`,
          );
        })
      }
    />
  );
}

// ── পুরোনো সারিতে নিয়ম বসানো ────────────────────────────────────────────────

/**
 * ⚠️ কাজটা **সিনক্রোনাস** — এক মাসে লাখখানেক সারিতে কয়েক সেকেন্ড লাগতে
 *    পারে, আর ততক্ষণ ব্রাউজার অপেক্ষা করে। তাই বোতামে "অপেক্ষা করুন…"
 *    লেখা ওঠে; নইলে কেউ ভাবত ক্লিকটা লাগেনি আর বারবার চাপত।
 */
function RecategorizeDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [onlyUnmatched, setOnlyUnmatched] = useState(true);
  const { busy, error, run } = useMutation();

  return (
    <Modal
      title="পুরোনো সারিতে নিয়ম বসান"
      hint="ক্যাটাগরি বসে ডেটা আসার সময়, পড়ার সময় নয়"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            বাতিল
          </Button>
          <Button
            tone="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await recategorize(onlyUnmatched);
                onDone(
                  `${formatCount(result.scanned)}টি সারি দেখা হয়েছে, ${formatCount(result.changed)}টির ক্যাটাগরি বদলেছে।`,
                );
              })
            }
          >
            {busy ? 'অপেক্ষা করুন…' : 'চালান'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Notice>
          নিয়ম বদলালে <strong>পুরোনো সারিতে পুরোনো সিদ্ধান্তই বসে থাকে</strong> —
          কারণ ক্যাটাগরি বসানো হয় ডেটা জমা হওয়ার মুহূর্তে। এটা না চালালে
          রিপোর্টে নতুন নিয়ম দেখা যাবে, অথচ সংখ্যাগুলো পুরোনো নিয়মেরই।
        </Notice>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-[12px] font-medium text-ink-2">
            কোন সারিগুলোয় বসবে
          </legend>

          <Choice
            checked={onlyUnmatched}
            onChange={() => setOnlyUnmatched(true)}
            title="শুধু অচেনা সারি"
            body="দ্রুত। নতুন রুল যোগ করার পর এটুকুই যথেষ্ট।"
          />
          <Choice
            checked={!onlyUnmatched}
            onChange={() => setOnlyUnmatched(false)}
            title="সব সারি"
            body="ধীর, আর কয়েক সেকেন্ড ব্রাউজার অপেক্ষা করবে। রুল বদলানো বা মোছার পর এটাই লাগে — নইলে পুরোনো সিদ্ধান্ত রয়ে যায়।"
          />
        </fieldset>

        <ServerError error={error} />
      </div>
    </Modal>
  );
}

function Choice({
  checked,
  onChange,
  title,
  body,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition ${
        checked ? 'border-brand bg-brand-bg/40' : 'border-line bg-surface'
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 accent-brand"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-3">
          {body}
        </span>
      </span>
    </label>
  );
}
