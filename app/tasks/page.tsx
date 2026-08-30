"use client";

/** タスク一覧（仕様 §9-5）。提案中のタスクは確定済みと明確に区別する */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { useNow } from "@/ui/use-navigator";
import Link from "next/link";
import { Badge, Button, Card, Empty, PageHeader } from "@/ui/primitives";
import { TaskForm } from "@/ui/task-form";
import { DeleteTaskButton } from "@/ui/delete-task";
import { newTaskFromDraft } from "@/core/model/task-draft";
import { newTaskId } from "@/lib/id";
import { TASK_STATUS_LABEL, TASK_STATUS_DOT, TASK_SOURCE_LABEL } from "@/core/model/task-labels";
import { TASK_PRIORITIES } from "@/core/model/task-draft";
import { blockingPredecessors, effectiveStatus } from "@/core/task/dependency";
import { remainingLabel, urgencyOf } from "@/core/context/resolver";
import { escalatedPriority } from "@/core/priority/escalate";
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
  const { state, dispatch, workflows, users } = useStore();
  const [view, setView] = useState<ViewKey>((search.get("view") as ViewKey) ?? "today");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
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

  // 担当者フィルタはビューの上に重ねて効かせる
  const visible = assigneeFilter === "all"
    ? filtered
    : filtered.filter((t) => t.assigneeId === assigneeFilter);

  const mineCount = open.filter(
    (t) => t.assigneeId === state.currentUserId && t.status !== "done" && t.status !== "canceled",
  ).length;

  const grouped = view === "byRun"
    ? Object.entries(visible.reduce<Record<string, Task[]>>((acc, t) => {
        const k = t.runId ?? "その他";
        (acc[k] ??= []).push(t);
        return acc;
      }, {}))
    : [["", visible] as [string, Task[]]];

  function TaskRow({ t }: { t: Task }) {
    const u = urgencyOf(t.dueAt, now);
    const blockedBy = blockingPredecessors(t, state.tasks);
    const shownStatus = effectiveStatus(t, state.tasks);
    const assignee = users.find((x) => x.id === t.assigneeId);
    const isMine = t.assigneeId === state.currentUserId;
    // 優先度は登録時のまま固定しない。期限が近づけば上がる
    const nowPriority = escalatedPriority(t.priority, t.dueAt, now);
    const priorityLabel = TASK_PRIORITIES.find((x) => x.value === nowPriority)?.label ?? nowPriority;
    const raised = nowPriority !== t.priority;

    return (
      <li
        className={`group relative rounded-xl border transition-shadow hover:shadow-card ${
          t.id === createdId
            ? "border-ok/50 bg-ok-soft"
            : t.confirmationState === "proposed"
              ? "border-signal/40 bg-signal-soft"
              : "border-line-soft bg-surface"
        }`}
      >
        <Link href={`/tasks/${t.id}`} className="block px-4 py-3">
          <span className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={`text-[13px] ${t.status === "done" ? "text-ink-3 line-through" : "font-medium"}`}>{t.title}</span>
                {t.confirmationState === "proposed" && <Badge tone="signal">提案中</Badge>}
                {t.source === "derived" && <Badge tone="ai">{TASK_SOURCE_LABEL.derived}</Badge>}
                {t.source === "manual" && <Badge>{TASK_SOURCE_LABEL.manual}</Badge>}
                {t.source === "flow" && <Badge tone="brand">{TASK_SOURCE_LABEL.flow}</Badge>}

                {t.impactLayer === "check" && <Badge tone="brand">確認事項</Badge>}
              </span>
              {t.description && <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{t.description}</span>}

              {/* ステータス・優先度・担当者。主役はタスク名なので視覚的に弱める */}
              <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                <span className={`flex items-center gap-1.5 ${shownStatus === "blocked" ? "font-medium text-danger" : ""}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${TASK_STATUS_DOT[shownStatus]}`} aria-hidden />
                  {TASK_STATUS_LABEL[shownStatus]}
                </span>
                <span className={raised ? "font-medium text-danger" : undefined}>
                  優先度 {priorityLabel}{raised && "（期限が近いため引き上げ）"}
                </span>
                <span className={isMine ? "font-medium text-brand" : undefined}>
                  担当 {assignee?.name ?? "未割当"}{isMine && "（自分）"}
                </span>
              </span>

              {blockedBy.length > 0 && (
                <span className="mt-1 block text-[11.5px] text-danger">
                  待機中：{blockedBy.map((x) => x.title).join(" / ")}
                </span>
              )}
            </span>

            {t.dueAt && (
              <Badge tone={u === "overdue" ? "danger" : u === "today" ? "signal" : "neutral"}>
                {remainingLabel(new Date(t.dueAt), now)}
              </Badge>
            )}
          </span>
        </Link>
        {/*
          間違えて作ったタスクを片付ける入口。リンクの内側には置けないので、
          行の右下に重ねる。ふだんは薄く、行に触れたときだけはっきりさせる。
        */}
        <span className="absolute bottom-1.5 right-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <DeleteTaskButton task={t} />
        </span>
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-6">
      <PageHeader
        title="タスク"
        description="業務フローと紐付いたタスクです。一般的なTodoではなく、タスクから業務を開始できます。"
        action={
          !creating && (
            <Button onClick={() => { setCreating(true); setCreatedId(null); }}>＋ タスクを追加</Button>
          )
        }
      />

      {creating && (
        <TaskForm
          mode={{ kind: "create", defaultAssigneeId: state.currentUserId }}
          users={users}
          onSubmit={(draft) => {
            const task = newTaskFromDraft(draft, newTaskId());
            dispatch({ type: "addTasks", tasks: [task] });
            setCreating(false);
            setCreatedId(task.id);
            // 作成したタスクが今のビューの条件から外れて見失わないようにする
            setView("all");
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {createdId && !creating && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-ok/40 bg-ok-soft px-4 py-2.5">
          <span className="text-[12.5px] font-medium text-ok">タスクを作成しました</span>
          <Link href={`/tasks/${createdId}`} className="text-[12.5px] text-brand hover:underline">
            作成したタスクを開く →
          </Link>
        </div>
      )}

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

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.key} onClick={() => setView(v.key)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-[background-color,border-color,box-shadow] duration-150 ${
              view === v.key
                ? "border-brand bg-brand text-white shadow-card"
                : "border-line-soft bg-surface text-ink-2 shadow-card hover:border-brand/40 hover:bg-surface-2 hover:shadow-lift"
            }`}
          >
            {v.label}
            {v.key === "proposed" && proposed.length > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${view === v.key ? "bg-white/25" : "bg-signal text-white"}`}>{proposed.length}</span>
            )}
          </button>
        ))}

        <label className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-[12px] text-ink-3">
          担当者
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            aria-label="担当者で絞り込む"
            className="field field-sm w-auto"
          >
            <option value="all">すべての担当者</option>
            <option value={state.currentUserId}>自分（{mineCount}件）</option>
            {users
              .filter((u) => u.id !== state.currentUserId)
              .map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
          </select>
        </label>
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

      {visible.length === 0 ? (
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
