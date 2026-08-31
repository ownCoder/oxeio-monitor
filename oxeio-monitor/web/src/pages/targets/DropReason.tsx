import {
  DROP_REASONS,
  DROP_REASON_LABEL,
  type DropReason,
} from '../../api/targets';
import { Chip, MiniButton } from '../settings/ui';

/**
 * ⭐⭐ **"কেন বাদ দিলেন?" — আর বোতামটাই উত্তর** *(মালিকের চাওয়া, ৩১ আগস্ট
 * ২০২৬: "eta keno delete korlam seta select kora option pelam na")*।
 *
 * ⚠️⚠️ **আলাদা কোনো নিশ্চিত-বোতাম নেই, আর সেটাই এখানকার নকশা।** আগে
 * Delete চাপলে "Really delete / Cancel" উঠত — একটা প্রশ্ন যার উত্তরে কোনো
 * তথ্য নেই। ⭐ এখন ওই জায়গাটাতেই তিনটে কারণ বসে: যেটা চাপা হবে সেটাই
 * একসাথে **নিশ্চিত করা** আর **কারণ বলা**। চাপ একটাই, কিন্তু ডেটা দ্বিগুণ।
 *
 * ⚠️ কারণ না দিয়ে বেরোনোর পথ নেই — Cancel আছে, কিন্তু "কারণ ছাড়া মুছুন"
 * নেই। ঐচ্ছিক রাখলে সবাই খালি রেখে দিতেন, ঠিক যেমন পুরোনো
 * `skipped_reason` ঘরটা ৯৩টা সারিতে NULL হয়ে পড়ে ছিল।
 *
 * ⚠️ একই কম্পোনেন্ট **দুই জায়গায়** — Design Pool-এর Delete আর ডিজাইনারের
 * Skip। দুই জায়গায় দুই তালিকা লিখলে একদিন একটায় নতুন কারণ যোগ হতো আর
 * অন্যটায় নয়, আর তখন গোনাই অসম্ভব হতো।
 */
export function DropReasonPicker({
  busy,
  onPick,
  onCancel,
}: {
  busy: boolean;
  onPick: (reason: DropReason) => void;
  onCancel: () => void;
}) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {/* ⚠️ প্রশ্নটা লেখা থাকে — নইলে তিনটে লাল বোতাম হঠাৎ কেন উঠল বোঝা যেত না */}
      <span className="text-[11.5px] whitespace-nowrap text-ink-3">Why?</span>
      {DROP_REASONS.map((reason) => (
        <MiniButton
          key={reason}
          tone="danger"
          disabled={busy}
          onClick={() => onPick(reason)}
        >
          {DROP_REASON_LABEL[reason]}
        </MiniButton>
      ))}
      <MiniButton disabled={busy} onClick={onCancel}>
        Cancel
      </MiniButton>
    </span>
  );
}

/**
 * ⭐ তালিকায় কারণটা দেখানো — চিপের পাশে ছোট করে।
 *
 * ⚠️ পুরোনো সারিতে `null` (তখন কারণ চাওয়াই হতো না), আর তখন কিছুই বসে না —
 * "—" বসালে মনে হতো কেউ ইচ্ছে করে খালি রেখেছে।
 */
export function DropReasonTag({ reason }: { reason: DropReason | null }) {
  if (reason === null) return null;

  return <Chip tone="muted">{DROP_REASON_LABEL[reason]}</Chip>;
}
