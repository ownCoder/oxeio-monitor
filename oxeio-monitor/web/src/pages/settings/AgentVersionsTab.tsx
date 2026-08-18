import { useState } from 'react';

import {
  listAgentVersions,
  publishAgentVersion,
  setAgentRollout,
  STAGE_LABEL,
  type AgentVersionView,
  type RolloutStage,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Button } from '../../components/Page';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { Table } from '../../components/Table';
import { formatBytes, formatDateTime } from '../../lib/format';
import {
  Chip,
  FormGrid,
  FullWidth,
  Modal,
  Notice,
  SelectField,
  ServerError,
  TextAreaField,
  TextField,
  useMutation,
} from './ui';

/**
 * **H04 · G59** — এজেন্টের নতুন ভার্সন বিলি করা।
 *
 * ⚠️⚠️ `agent_versions` টেবিলটা এতদিন **শুধু পড়া হতো**। ধাপে ধাপে
 * রোলআউট, canary, sha256 যাচাই, `halted` দিয়ে থামানো — সবকিছু তৈরি ছিল,
 * কিন্তু ওই টেবিলে সারি বসানোর কোনো পথ কোথাও ছিল না। ফলে নতুন MSI
 * ১৫টা PC-তে পৌঁছানোর একমাত্র উপায় ছিল প্রতিটা মেশিনে হাতে গিয়ে বসানো।
 *
 * ⭐ এই পাতাটাই সেই ফাঁকটা বন্ধ করে — কিন্তু ইচ্ছাকৃতভাবে **ছোট**:
 * তালিকা, একটা "Publish", আর ধাপ বদলানোর একটা ড্রপডাউন। এর বেশি কিছু
 * (আপলোড, বিল্ড ট্রিগার) এখানে নেই; MSI সার্ভারে কপি করাটা আলাদা কাজ।
 */
export function AgentVersionsTab() {
  const { data, loading, error, reload } = useApi(
    (signal) => listAgentVersions(signal),
    [],
  );

  const [publishing, setPublishing] = useState(false);
  const rows = data ?? [];

  return (
    <div className="space-y-4">
      {/*
        ⚠️ এই সতর্কতাটা সবার উপরে, আর সবসময় — কারণ ভুল বিল্ড বেরিয়ে
        গেলে ফেরার স্বয়ংক্রিয় পথ **নেই** (G69, ইচ্ছাকৃত)। যিনি
        "Everyone" বাছবেন, তিনি যেন আগেই জানেন।
      */}
      <Notice tone="attention">
        There is no automatic rollback. If a build turns out to be bad, you
        can stop it here — but the PCs that already took it have to be fixed by
        hand. Start with <strong>a few PCs first</strong> and wait a day.
      </Notice>

      <Card
        title="Agent versions"
        hint="Which build each PC is offered, and how widely"
        padded={false}
        actions={<Button onClick={() => setPublishing(true)}>Publish</Button>}
      >
        {loading && <Loading />}
        {error && <ErrorBox error={error} retry={reload} />}
        {!loading && !error && rows.length === 0 && (
          <Empty
            title="Nothing published yet"
            hint="Agents keep running on whatever was installed by hand — they just never get offered an update."
          />
        )}
        {rows.length > 0 && <VersionTable rows={rows} onChanged={reload} />}
      </Card>

      {publishing && (
        <PublishDialog
          onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function VersionTable({
  rows,
  onChanged,
}: {
  rows: AgentVersionView[];
  onChanged: () => void;
}) {
  const { busy, error, run } = useMutation();

  return (
    <>
      <ServerError error={error} />
      <Table
        rows={rows}
        rowKey={(r) => r.version}
        columns={[
          {
            key: 'version',
            header: 'Version',
            render: (r) => (
              <span className="num font-semibold">{r.version}</span>
            ),
          },
          {
            key: 'stage',
            header: 'Given to',
            render: (r) => (
              <select
                value={r.rolloutStage}
                disabled={busy}
                onChange={(e) =>
                  run(async () => {
                    await setAgentRollout(
                      r.version,
                      e.target.value as RolloutStage,
                    );
                    onChanged();
                  })
                }
                className="rounded-md border border-line bg-surface px-2 py-1 text-[12.5px]"
              >
                {(
                  ['canary', 'partial', 'all', 'halted'] as const
                ).map((stage) => (
                  <option key={stage} value={stage}>
                    {STAGE_LABEL[stage]}
                  </option>
                ))}
              </select>
            ),
          },
          {
            key: 'devices',
            header: 'PCs on it',
            align: 'right',
            render: (r) => <span className="num">{r.devicesOn}</span>,
          },
          {
            key: 'size',
            header: 'Size',
            align: 'right',
            render: (r) =>
              /*
                ⚠️ সারি আছে কিন্তু ফাইলটা ডিস্কে নেই — এজেন্ট নামাতে গিয়ে
                   ৪০৪ পেত আর owner জানতেনই না। তাই এটা লাল করে বলা।
              */
              r.fileMissing ? (
                <Chip tone="attention">MSI missing</Chip>
              ) : (
                <span className="num text-ink-3">
                  {formatBytes(r.sizeBytes)}
                </span>
              ),
          },
          {
            key: 'download',
            header: '',
            /*
              ⭐⭐ **হাতে বসানোর জন্য MSI নামানো** *(১৮ আগস্ট)*।

              ⚠️⚠️ ০.৪.১-এর **আগের** এজেন্টে tray-তে "Install update"
                 মেনুটাই নেই, তাই ধাপে ধাপে রোলআউট ওই PC-গুলোয় পৌঁছায় না —
                 ফাইলটা নেমে পড়ে থাকে, কেউ জানে না। ওখানে একবার হাতে
                 বসাতে হয়, আর তার জন্য MSI-টা হাতে পাওয়ার কোনো পথই ছিল না।

              ⚠️ সাধারণ `<a download>` — কোনো JS নয়। ফাইলটা ৬২ MB, আর
                 fetch দিয়ে মেমরিতে তুলে blob বানালে বড় ফাইলে ব্রাউজার
                 অকারণে ভুগত; ব্রাউজারের নিজের ডাউনলোডই এখানে সঠিক যন্ত্র।
            */
            render: (r) =>
              r.fileMissing ? null : (
                <a
                  href={`/api/v1/agent-versions/${encodeURIComponent(r.version)}/download`}
                  download
                  className="rounded-md border border-line px-2 py-1 text-[12px] text-ink-2 transition hover:border-brand hover:text-ink"
                >
                  Download MSI
                </a>
              ),
          },
          {
            key: 'released',
            header: 'Published',
            render: (r) => (
              <span className="num text-ink-3">
                {formatDateTime(r.releasedAt)}
              </span>
            ),
          },
          {
            key: 'notes',
            header: '',
            render: (r) =>
              r.isMandatory ? <Chip tone="pending">Mandatory</Chip> : null,
          },
        ]}
      />
    </>
  );
}

/**
 * ⚠️ এখানে **sha256 চাওয়া হয় না** — সার্ভার নিজে ফাইলটা পড়ে হিসাব করে।
 * হাতে বসানো হ্যাশে একটা অক্ষর ভুল হলে ১৫টা PC ফাইলটা নামাত, হ্যাশ না
 * মেলায় বাতিল করত, আবার নামাত — চিরকাল।
 */
function PublishDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();

  const [version, setVersion] = useState('');
  const [msiPath, setMsiPath] = useState('updates/oXeioAgent.msi');
  const [notes, setNotes] = useState('');
  const [stage, setStage] = useState<RolloutStage>('canary');

  const ready = /^\d+\.\d+\.\d+/.test(version) && msiPath.trim().length > 0;

  return (
    <Modal
      title="Publish an agent version"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || !ready}
            onClick={() =>
              run(async () => {
                await publishAgentVersion({
                  version: version.trim(),
                  msiPath: msiPath.trim(),
                  releaseNotes: notes.trim() || undefined,
                  rolloutStage: stage,
                });
                onDone();
              })
            }
          >
            Publish
          </Button>
        </div>
      }
    >
      <ServerError error={error} />

      <Notice>
        Copy the built <code>oXeioAgent.msi</code> into the server&apos;s
        storage folder first — this only records where it is. The checksum is
        read from the file itself.
      </Notice>

      <FormGrid>
        <TextField
          label="Version"
          value={version}
          onChange={setVersion}
          placeholder="0.2.0"
          hint="Must be newer than the last one, or no agent would be offered it"
          mono
          required
          autoFocus
        />

        <SelectField
          label="Give it to"
          value={stage}
          onChange={(v) => setStage(v as RolloutStage)}
          options={[
            { value: 'canary', label: STAGE_LABEL.canary },
            { value: 'partial', label: STAGE_LABEL.partial },
            { value: 'all', label: STAGE_LABEL.all },
          ]}
          hint="Start small — a bad build cannot be rolled back automatically"
        />

        <FullWidth>
          <TextField
            label="Path on the server"
            value={msiPath}
            onChange={setMsiPath}
            hint="Inside the storage folder, e.g. updates/oXeioAgent-0.2.0.msi"
            mono
            required
          />
        </FullWidth>

        <FullWidth>
          <TextAreaField
            label="What changed"
            value={notes}
            onChange={setNotes}
            hint="Optional — but a month later this is the only record of why"
          />
        </FullWidth>
      </FormGrid>
    </Modal>
  );
}
