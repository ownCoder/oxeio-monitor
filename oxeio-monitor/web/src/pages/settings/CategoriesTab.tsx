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
  process: 'Process',
  domain: 'Domain',
  title_regex: 'Title regex',
};

const MATCH_OPTIONS = [
  { value: 'process', label: 'Process — code.exe' },
  { value: 'domain', label: 'Domain — youtube.com' },
  { value: 'title_regex', label: 'Title regex' },
];

/** ⭐ মকআপের ভাষাই রাখা হয়েছে — রিপোর্টের লেজেন্ডেও এই তিনটে শব্দই */
const CATEGORY_OPTIONS = [
  { value: 'productive', label: 'Productive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'unproductive', label: 'Unproductive' },
];

const PATTERN_HINT: Record<MatchType, string> = {
  process:
    'The file name only — never a full path (for example code.exe). The agent sends nothing but the name.',
  domain:
    'The domain only, never a full URL (for example youtube.com). Full URLs are never stored, so a rule with a "/" in it would never match anything.',
  title_regex:
    'A JavaScript regex, case-insensitive. Matched against the window title.',
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
      header: 'Priority',
      align: 'right',
      render: (rule) => <span className="num">{rule.priority}</span>,
    },
    {
      key: 'matchType',
      header: 'Type',
      render: (rule) => <Chip>{MATCH_LABEL[rule.matchType]}</Chip>,
    },
    {
      key: 'pattern',
      header: 'Pattern',
      render: (rule) => <span className="num">{rule.pattern}</span>,
    },
    {
      key: 'displayName',
      header: 'Shown as',
      render: (rule) => rule.displayName,
    },
    {
      key: 'category',
      header: 'Category',
      // ⭐ ব্র্যান্ডের নিয়মটাই এখানে হুবহু খাটে: নিরেট `ink` = গোনা হওয়া
      //    কাজ, ধূসর = গোনা হয়নি। লাল ব্যবহার করা হয়নি — unproductive
      //    হওয়া কোনো ভুল নয়, শুধু একটা শ্রেণি।
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
          <MiniButton onClick={() => setEditing(rule)}>Edit</MiniButton>
          <MiniButton tone="danger" onClick={() => setRemoving(rule)}>
            Delete
          </MiniButton>
        </RowActions>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <Notice>
        <strong>Lower number wins</strong> — the first rule that matches is the
        one that sticks, and the list below is in exactly that order, so a rule
        higher up beats one lower down. Setting 200 does not mean "more
        important"; it puts the rule practically last.
      </Notice>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={() => setRerunning(true)}>
          Apply rules to past rows
        </Button>
        <Button tone="primary" onClick={() => setCreating(true)}>
          New rule
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
          title="No category rules at all"
          hint="Without rules every app and site stays 'unknown' and no productivity score is ever produced. The seed normally installs 80+ rules — having none is not normal."
          action={
            <Button tone="primary" onClick={() => setCreating(true)}>
              New rule
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <Card
          padded={false}
          title={`Rules · ${rows.length}`}
          hint="Matched in exactly the order shown below"
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
          'Rule changed. Rows already stored still carry the old decision — run "Apply rules to past rows" and choose "All rows".',
        );
      } else {
        await createCategory(body);
        onSaved(
          'New rule added. It applies to data arriving from now on; to apply it to old unknown rows as well, run "Apply rules to past rows".',
        );
      }
    });
  };

  return (
    <Modal
      title={rule ? 'Edit rule' : 'New category rule'}
      hint="Which category an app or site falls into"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone="primary" onClick={submit} disabled={busy || incomplete}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <SelectField
            label="Match on"
            value={matchType}
            onChange={(value) => setMatchType(value as MatchType)}
            options={MATCH_OPTIONS}
          />
          <SelectField
            label="Category"
            value={category}
            onChange={(value) => setCategory(value as Productivity)}
            options={CATEGORY_OPTIONS}
          />

          <FullWidth>
            <TextField
              label="Pattern"
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
            label="Shown as"
            value={displayName}
            onChange={setDisplayName}
            required
            maxLength={100}
            hint="This is the name reports will use"
          />

          <TextField
            label="Priority"
            type="number"
            value={priority}
            onChange={setPriority}
            mono
            min={1}
            max={1000}
            hint="Lower number wins. Default is 100; the general browser rules sit at 200, so a rule for a specific domain beats them."
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
      title={`Delete the rule "${rule.pattern}"?`}
      intro={`${MATCH_LABEL[rule.matchType]} · ${rule.displayName} · ${rule.category}`}
      warning="Every row this rule had categorised turns 'unknown' right away — that time drops out of the productivity score. You will be told how many rows once it is done."
      confirmLabel="Delete"
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        run(async () => {
          const result = await deleteCategory(rule.id);
          // ⭐ সার্ভারের `hint` হুবহু দেখানো হয় — ওখানেই লেখা আছে এরপর কী করতে হবে
          onDone(
            result.orphanedRows === 0
              ? `Rule deleted. ${result.hint}`
              : `Rule deleted — ${formatCount(result.orphanedRows)} rows are now unknown. ${result.hint}`,
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
      title="Apply rules to past rows"
      hint="Categories are decided when data arrives, not when it is read"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await recategorize(onlyUnmatched);
                onDone(
                  `${formatCount(result.scanned)} rows examined, ${formatCount(result.changed)} changed category.`,
                );
              })
            }
          >
            {busy ? 'Please wait…' : 'Run'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Notice>
          When a rule changes, <strong>old rows keep the old decision</strong> —
          the category is stamped on at the moment the data is stored. Skip this
          and reports will show the new rules while the numbers still follow the
          old ones.
        </Notice>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-[12px] font-medium text-ink-2">
            Which rows to apply to
          </legend>

          <Choice
            checked={onlyUnmatched}
            onChange={() => setOnlyUnmatched(true)}
            title="Unknown rows only"
            body="Fast. This is enough after adding a new rule."
          />
          <Choice
            checked={!onlyUnmatched}
            onChange={() => setOnlyUnmatched(false)}
            title="All rows"
            body="Slower, and the browser waits a few seconds. This is what you need after changing or deleting a rule — otherwise the old decisions stay."
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
