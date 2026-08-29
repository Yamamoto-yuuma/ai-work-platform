"use client";

/**
 * この業務に起きた変更の履歴（仕様 §10-3 / §10-8）。
 *
 * 既存の ChangeEvent をそのまま読むだけで、新しい履歴モデルは作らない。
 * 変更から生まれた派生タスクも既存の originEventId でたどる。
 */
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { Badge, Card } from "./primitives";
import type { ChangeEvent, WorkRun } from "@/core/model/types";

function describeValue(v: unknown): string {
  const s = String(v ?? "");
  if (!s) return "";
  const d = new Date(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(d.getTime())) {
    return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  }
  return s;
}

export function ChangeHistory({ run }: { run: WorkRun }) {
  const { state, users } = useStore();

  const changes = state.changeEvents
    .filter((c) => c.runId === run.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  if (changes.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <header className="border-b border-line bg-surface-2 px-4 py-2.5">
        <h2 className="text-[12px] font-bold">この業務の変更履歴（{changes.length}件）</h2>
        <p className="mt-0.5 text-[11px] text-ink-3">起票された変更と、そこから生まれた対応です</p>
      </header>
      <ul className="flex flex-col">
        {changes.map((c) => (
          <ChangeRow
            key={c.id} change={c}
            actorName={users.find((u) => u.id === c.actor)?.name}
            derived={state.tasks.filter((t) => t.originEventId === c.id)}
          />
        ))}
      </ul>
    </Card>
  );
}

function ChangeRow({
  change, actorName, derived,
}: {
  change: ChangeEvent;
  actorName?: string;
  derived: { id: string; title: string }[];
}) {
  const before = describeValue(change.before);
  const after = describeValue(change.after);

  return (
    <li className="border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[11.5px] tabular-nums text-ink-3">
          {new Date(change.occurredAt).toLocaleString("ja-JP", {
            month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </span>
        {actorName && <span className="text-[11.5px] text-ink-3">{actorName}</span>}
      </div>

      <p className="mt-1 text-[12.5px]">
        <span className="font-medium">{change.entityLabel}</span>
        <span className="mx-1 text-ink-3">の</span>
        <span className="font-medium">{change.fieldLabel}</span>
      </p>
      <p className="mt-0.5 text-[12.5px] tabular-nums">
        <span className="text-ink-3 line-through">{before || "（未登録）"}</span>
        <span className="mx-1.5 text-ink-3">→</span>
        <span className="font-bold">{after}</span>
      </p>

      {change.reason && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">理由：{change.reason}</p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {derived.length > 0 && <Badge tone="signal">この変更から {derived.length}件</Badge>}
        <Link href={`/map/impact/${change.id}`} className="text-[11.5px] text-brand hover:underline">
          影響を見る →
        </Link>
      </div>

      {derived.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {derived.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tasks/${t.id}`}
                className="block truncate rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11.5px] hover:text-brand"
              >
                {t.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
