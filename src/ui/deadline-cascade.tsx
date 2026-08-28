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
    <Card className="mb-5 border-signal/40 bg-signal-soft p-5">
      <h2 className="text-[14px] font-bold text-signal">
        この変更で {proposals.length} 件の後続タスクに影響があります
      </h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
        「{sourceTitle}」の期限を{direction === "later" ? "後ろ倒し" : "前倒し"}したため、
        これを待っているタスクの期限も同じ日数だけ{direction === "later" ? "後ろへ" : "前へ"}動かすことを提案します。
        <strong className="font-bold">確定するまで後続タスクの期限は変わりません。</strong>
      </p>

      <ul className="mt-4 flex flex-col gap-1.5">
        {proposals.map((p) => {
          const checked = selected.has(p.taskId);
          return (
            <li key={p.taskId}>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
                  checked ? "border-signal/50 bg-surface" : "border-line bg-surface-2 opacity-70"
                }`}
              >
                <input
                  type="checkbox" checked={checked}
                  onChange={() => toggle(p.taskId)}
                  className="h-4 w-4 accent-[#1d5a78]"
                  aria-label={`${p.title} の期限を更新する`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.title}</span>
                  {p.hop > 1 && (
                    <span className="mt-0.5 block text-[11px] text-ink-3">間接的な後続（{p.hop}段階先）</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[12.5px] tabular-nums">
                  <span className="text-ink-3 line-through">{fmt(p.currentDueAt)}</span>
                  <span className="text-ink-3">→</span>
                  <Badge tone="signal">{fmt(p.proposedDueAt)}</Badge>
                </span>
              </label>
            </li>
          );
        })}
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
