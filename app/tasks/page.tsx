"use client";

/** タスク一覧（仕様 §9-5）。提案中のタスクは確定済みと明確に区別する */
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { useNow } from "@/ui/use-navigator";
import { Badge, Button, Card, Empty, PageHeader } from "@/ui/primitives";
import { remainingLabel, urgencyOf } from "@/core/context/resolver";
import type { Task } from "@/core/model/types";

const VIEWS = [
  { key: "today", label: "今日" },
  { key: "week", label: "今週" },
  { key: "overdue", label: "期限超過" },
  { key: "byRun", label: "業務別" },
  { key: "derived", label: "派生別" },
  { key: "proposed", label: "提案中" },
  { key: "all", label: "すべて" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function TasksInner() {
  const search = useSearchParams();
  const { state, dispatch, workflows } = useStore();
  const [view, setView] = useState<ViewKey>((search.get("view") as ViewKey) ?? "today");
  const now = useNow();

  const open = state.tasks.filter((t) => t.confirmationState !== "rejected");
  const proposed = open.filter((t) => t.confirmationState === "proposed");

  const filtered = open.filter((t) => {
    if (view === "proposed") return t.confirmationState === "proposed";
    if (t.confirmationState === "proposed") return false;
    const u = urgencyOf(t.dueAt, now);
    switch (view) {
      case "today": return u === "today" || u === "overdue";
      case "week": return t.dueAt ? new Date(t.dueAt).getTime() - now.getTime() < 7 * 864e5 : false;
      case "overdue": return u === "overdue";
      case "derived": return t.source === "derived";
      case "byRun": return Boolean(t.runId);
      case "all": return true;
    }
  });

  const grouped = view === "byRun"
    ? Object.entries(filtered.reduce<Record<string, Task[]>>((acc, t) => {
        const k = t.runId ?? "その他";
        (acc[k] ??= []).push(t);
        return acc;
      }, {}))
    : [["", filtered] as [string, Task[]]];

  function TaskRow({ t }: { t: Task }) {
    const u = urgencyOf(t.dueAt, now);
    const blocked = t.dependsOn.some((id) => state.tasks.find((x) => x.id === id)?.status !== "done");
    return (
      <li>
        <Link
          href={`/tasks/${t.id}`}
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:border-brand ${
            t.confirmationState === "proposed" ? "border-signal/40 bg-signal-soft" : "border-line bg-surface"
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[13px] ${t.status === "done" ? "text-ink-3 line-through" : "font-medium"}`}>{t.title}</span>
              {t.confirmationState === "proposed" && <Badge tone="signal">提案中</Badge>}
              {t.source === "derived" && <Badge tone="ai">派生</Badge>}
              {blocked && <Badge tone="neutral">依存待ち</Badge>}
              {t.impactLayer === "check" && <Badge tone="brand">確認事項</Badge>}
            </span>
            {t.description && <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{t.description}</span>}
          </span>
          {t.dueAt && (
            <Badge tone={u === "overdue" ? "danger" : u === "today" ? "signal" : "neutral"}>
              {remainingLabel(new Date(t.dueAt), now)}
            </Badge>
          )}
        </Link>
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-6">
      <PageHeader title="タスク" description="業務フローと紐付いたタスクです。一般的なTodoではなく、タスクから業務を開始できます。" />

      {proposed.length > 0 && view !== "proposed" && (
        <Card className="mb-5 border-signal/40 bg-signal-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-signal">{proposed.length}件の派生タスクが未確認です</p>
              <p className="mt-0.5 text-[12px] text-ink-2">変更によって提案されたタスクです。確認して確定してください。</p>
            </div>
            <Button variant="secondary" onClick={() => setView("proposed")}>内容を確認する</Button>
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.key} onClick={() => setView(v.key)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              view === v.key ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-2 hover:bg-surface-2"
            }`}
          >
            {v.label}
            {v.key === "proposed" && proposed.length > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${view === v.key ? "bg-white/25" : "bg-signal text-white"}`}>{proposed.length}</span>
            )}
          </button>
        ))}
      </div>

      {view === "proposed" && proposed.length > 0 && (
        <div className="mb-4 flex gap-2">
          <Button onClick={() => dispatch({ type: "confirmTasks", taskIds: proposed.map((t) => t.id) })}>
            すべて確定する（{proposed.length}件）
          </Button>
          <Button variant="danger" onClick={() => dispatch({ type: "rejectTasks", taskIds: proposed.map((t) => t.id) })}>
            すべて却下
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty>該当するタスクはありません</Empty>
      ) : (
        grouped.map(([groupKey, list]) => (
          <section key={groupKey} className="mb-6">
            {groupKey && (
              <h2 className="mb-2 text-[12.5px] font-bold text-ink-3">
                {state.runs.find((r) => r.id === groupKey)?.subject.label ?? groupKey}
                <span className="ml-2 font-normal">
                  {workflows.find((w) => w.key === state.runs.find((r) => r.id === groupKey)?.workflowKey)?.name}
                </span>
              </h2>
            )}
            <ul className="flex flex-col gap-1.5">
              {list.map((t) => <TaskRow key={t.id} t={t} />)}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[13px] text-ink-3">読み込み中…</div>}>
      <TasksInner />
    </Suspense>
  );
}
