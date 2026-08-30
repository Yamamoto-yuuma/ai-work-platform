"use client";

/**
 * 先行タスクの期限変更による後続タスクへの影響を提示し、確定させる（仕様 §11-3）。
 * 提案は自動確定しない。ユーザーが選んだものだけを反映する。
 */
import { useState } from "react";
import type { DeadlineProposal } from "@/core/schedule/cascade";
import { Badge, Button, Card } from "./primitives";

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
}

/**
 * 期限の再提案1件分の行。現在値と提案値を並べ、個別に採否を選べる。
 * タスク詳細（B-4）と変更起票（B-6）の双方から使う。
 */
export function DeadlineProposalRow({
  proposal, checked, onToggle,
}: {
  proposal: DeadlineProposal;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
          checked ? "border-signal/50 bg-surface" : "border-line bg-surface-2 opacity-70"
        }`}
      >
        <input
          type="checkbox" checked={checked} onChange={onToggle}
          className="h-4 w-4 accent-[#1d5a78]"
          aria-label={`${proposal.title} の期限を更新する`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{proposal.title}</span>
          {proposal.hop > 1 && (
            <span className="mt-0.5 block text-[11px] text-ink-3">間接的な後続（{proposal.hop}段階先）</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[12.5px] tabular-nums">
          <span className="text-ink-3 line-through">{fmt(proposal.currentDueAt)}</span>
          <span className="text-ink-3">→</span>
          <Badge tone="signal">{fmt(proposal.proposedDueAt)}</Badge>
        </span>
      </label>
    </li>
  );
}

export function DeadlineCascadePanel({
  sourceTitle, direction, proposals, onApply, onDismiss,
}: {
  sourceTitle: string;
  direction: "later" | "earlier";
  proposals: DeadlineProposal[];
  onApply: (accepted: DeadlineProposal[]) => void;
  onDismiss: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposals.map((p) => p.taskId)));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const accepted = proposals.filter((p) => selected.has(p.taskId));

  return (
    <Card className="mb-5 bg-signal-soft p-5">
      <h2 className="text-[14px] font-bold text-signal">
        この変更で {proposals.length} 件の後続タスクに影響があります
      </h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
        「{sourceTitle}」の期限を{direction === "later" ? "後ろ倒し" : "前倒し"}したため、
        これを待っているタスクの期限も同じ日数だけ{direction === "later" ? "後ろへ" : "前へ"}動かすことを提案します。
        <strong className="font-bold">確定するまで後続タスクの期限は変わりません。</strong>
      </p>

      <ul className="mt-4 flex flex-col gap-1.5">
        {proposals.map((p) => (
          <DeadlineProposalRow
            key={p.taskId} proposal={p}
            checked={selected.has(p.taskId)} onToggle={() => toggle(p.taskId)}
          />
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => onApply(accepted)} disabled={accepted.length === 0}>
          選択した {accepted.length} 件の期限を更新
        </Button>
        <Button variant="secondary" onClick={onDismiss}>今は変更しない</Button>
        {accepted.length === 0 && (
          <span className="text-[12px] text-ink-3">1件も選ばれていません</span>
        )}
      </div>
    </Card>
  );
}
