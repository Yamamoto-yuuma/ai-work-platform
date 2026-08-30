"use client";

/** タスク詳細（仕様 §9）。派生の系譜と依存関係をたどれること */
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { Badge, Button, Card, LinkButton, PageHeader } from "@/ui/primitives";
import { DeleteTaskButton } from "@/ui/delete-task";
import { remainingLabel, urgencyOf } from "@/core/context/resolver";
import { buildRun } from "@/services/start-run";
import { useNow } from "@/ui/use-navigator";
import { TaskForm } from "@/ui/task-form";
import { TASK_PRIORITIES, patchFromDraft } from "@/core/model/task-draft";
import { TASK_STATUS_LABEL, TASK_STATUS_DOT } from "@/core/model/task-labels";
import { blockingPredecessors, effectiveStatus, releasedOnComplete, directDependents } from "@/core/task/dependency";
import { proposeDependentDeadlines, shiftDirection, type DeadlineProposal } from "@/core/schedule/cascade";
import { DeadlineCascadePanel } from "@/ui/deadline-cascade";

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const router = useRouter();
  const { state, dispatch, workflows, customers, users } = useStore();
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  // 期限変更による後続への影響。確定するまで反映しない（仕様 §11-3）
  const [cascade, setCascade] = useState<{
    sourceTitle: string; direction: "later" | "earlier"; proposals: DeadlineProposal[];
  } | null>(null);
  const [cascadeApplied, setCascadeApplied] = useState<number | null>(null);

  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return <div className="p-8 text-[13px]">タスクが見つかりません。</div>;

  const run = task.runId ? state.runs.find((r) => r.id === task.runId) : undefined;
  const def = run ? workflows.find((w) => w.key === run.workflowKey) : undefined;
  const change = task.originEventId ? state.changeEvents.find((c) => c.id === task.originEventId) : undefined;
  const blockedBy = blockingPredecessors(task, state.tasks);
  const shownStatus = effectiveStatus(task, state.tasks);
  const waitingOnThis = directDependents(task, state.tasks).filter(
    (t) => t.status !== "done" && t.status !== "canceled",
  );
  const released = releasedOnComplete(task, state.tasks);
  const startable = task.startableWorkflowKey ? workflows.find((w) => w.key === task.startableWorkflowKey) : undefined;

  function startWorkflow() {
    if (!startable || !task) return;
    const { run, stepRuns } = buildRun({
      def: startable,
      customers,
      assigneeId: state.currentUserId,
      // タスクから開始した業務は、タスクの表題と期限を引き継ぐ
      override: { label: task.title, dueAt: task.dueAt },
      now,
    });
    dispatch({ type: "startRun", run, stepRuns });
    dispatch({ type: "updateTask", taskId: task.id, patch: { runId: run.id, status: "doing" } });
    router.push(`/navigator/${run.id}`);
  }

  return (
    <div className="mx-auto max-w-[860px] px-6 py-6">
      <div className="mb-2 text-[12px] text-ink-3">
        <Link href="/tasks" className="hover:text-brand">タスク</Link> / 詳細
      </div>

      <PageHeader
        title={task.title}
        description={task.description}
        action={
          !editing && (
            <Button variant="secondary" onClick={() => { setEditing(true); setSaved(false); }}>
              編集
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={task.confirmationState === "proposed" ? "signal" : "ok"}>
          {task.confirmationState === "proposed" ? "提案中（未確定）" : "確定済み"}
        </Badge>
        <Badge tone={task.priority === "urgent" ? "danger" : task.priority === "high" ? "signal" : "neutral"}>
          優先度：{TASK_PRIORITIES.find((x) => x.value === task.priority)?.label ?? task.priority}
        </Badge>
        <Badge tone={shownStatus === "blocked" ? "danger" : "neutral"}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${TASK_STATUS_DOT[shownStatus]}`} aria-hidden />
          {TASK_STATUS_LABEL[shownStatus]}
        </Badge>
        <Badge tone={task.assigneeId === state.currentUserId ? "brand" : "neutral"}>
          担当：{users.find((u) => u.id === task.assigneeId)?.name ?? "未割当"}
        </Badge>
        {task.source === "derived" && <Badge tone="ai">派生タスク</Badge>}
        {task.source === "manual" && <Badge>手動作成</Badge>}
        {task.source === "flow" && <Badge tone="brand">業務フロー由来</Badge>}
        {task.dueAt ? (
          <Badge tone={urgencyOf(task.dueAt, now) === "overdue" ? "danger" : "brand"}>
            期限 {new Date(task.dueAt).toLocaleDateString("ja-JP")}（{remainingLabel(new Date(task.dueAt), now)}）
          </Badge>
        ) : (
          <Badge>期限なし</Badge>
        )}
      </div>

      {saved && !editing && (
        <div className="mb-5 rounded-lg border border-ok/40 bg-ok-soft px-4 py-2.5 text-[12.5px] font-medium text-ok">
          変更を保存しました
        </div>
      )}

      {cascade && !editing && (
        <DeadlineCascadePanel
          sourceTitle={cascade.sourceTitle}
          direction={cascade.direction}
          proposals={cascade.proposals}
          onApply={(accepted) => {
            for (const p of accepted) {
              dispatch({ type: "updateTask", taskId: p.taskId, patch: { dueAt: p.proposedDueAt } });
            }
            setCascadeApplied(accepted.length);
            setCascade(null);
          }}
          onDismiss={() => setCascade(null)}
        />
      )}

      {cascadeApplied !== null && (
        <div className="mb-5 rounded-lg border border-ok/40 bg-ok-soft px-4 py-2.5 text-[12.5px] font-medium text-ok">
          {cascadeApplied} 件の後続タスクの期限を更新しました
        </div>
      )}

      {editing && (
        <TaskForm
          mode={{ kind: "edit", task }}
          users={users}
          onSubmit={(draft) => {
            const patch = patchFromDraft(draft, task);
            const previousDueAt = task.dueAt;
            dispatch({ type: "updateTask", taskId: task.id, patch });
            setEditing(false);
            setSaved(true);
            setCascadeApplied(null);

            // 期限が動いた場合だけ、後続への影響を提案として出す
            const updated = { ...task, ...patch };
            const proposals = proposeDependentDeadlines({
              changedTask: updated, previousDueAt, allTasks: state.tasks,
            });
            const direction = previousDueAt && updated.dueAt
              ? shiftDirection(previousDueAt, updated.dueAt)
              : "none";
            setCascade(
              proposals.length > 0 && direction !== "none"
                ? { sourceTitle: updated.title, direction, proposals }
                : null,
            );
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {task.confirmationState === "proposed" && (
        <Card className="mb-5 border-signal/40 bg-signal-soft p-4">
          <p className="text-[13px] font-bold text-signal">このタスクは提案中です</p>
          <p className="mt-1 text-[12.5px] text-ink-2">
            変更によって自動生成されたタスクです。内容を確認して確定してください。
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => dispatch({ type: "confirmTasks", taskIds: [task.id] })}>確定する</Button>
            <Button variant="danger" onClick={() => dispatch({ type: "rejectTasks", taskIds: [task.id] })}>却下する</Button>
          </div>
        </Card>
      )}

      {blockedBy.length > 0 && (
        <Card className="mb-5 border-danger/40 bg-danger-soft p-4">
          <p className="text-[13px] font-bold text-danger">
            このタスクはブロック中です — {blockedBy.length}件の先行タスクの完了を待っています
          </p>
          <ul className="mt-2.5 flex flex-col gap-1">
            {blockedBy.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/tasks/${d.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 hover:bg-brand-soft"
                >
                  <span className="text-[12.5px] font-medium">{d.title}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-3">
                    {TASK_STATUS_LABEL[effectiveStatus(d, state.tasks)]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {waitingOnThis.length > 0 && (
        <Card className="mb-5 p-4">
          <p className="text-[12.5px] font-bold text-ink-3">
            このタスクの完了を待っているタスク（{waitingOnThis.length}）
          </p>
          <ul className="mt-2.5 flex flex-col gap-1">
            {waitingOnThis.map((d) => {
              const willBeReleased = released.some((r) => r.id === d.id);
              return (
                <li key={d.id}>
                  <Link
                    href={`/tasks/${d.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 hover:bg-brand-soft"
                  >
                    <span className="min-w-0 text-[12.5px] font-medium">{d.title}</span>
                    <span className="shrink-0">
                      {willBeReleased ? (
                        <Badge tone="ok">完了すると着手可能</Badge>
                      ) : (
                        <Badge tone="neutral">他の先行タスクも待機中</Badge>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {task.status !== "done" && released.length > 0 && (
            <p className="mt-2.5 text-[11.5px] text-ink-3">
              このタスクを完了すると {released.length} 件が着手可能になります
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* 派生の系譜 */}
        {change && (
          <Card className="p-4 sm:col-span-2">
            <p className="mb-2 text-[12px] font-bold text-ink-3">このタスクが発生した理由</p>
            <Link href={`/map/impact/${change.id}`} className="block rounded-lg bg-surface-2 px-3.5 py-3 hover:bg-brand-soft">
              <p className="text-[13px] font-medium">{change.entityLabel}</p>
              <p className="mt-1 text-[12.5px] text-ink-2">
                {change.fieldLabel}：{new Date(String(change.before)).toLocaleDateString("ja-JP")} → {new Date(String(change.after)).toLocaleDateString("ja-JP")}
              </p>
              {change.reason && <p className="mt-1 text-[11.5px] text-ink-3">{change.reason}</p>}
              <p className="mt-2 text-[11.5px] text-brand">インパクトマップで影響範囲を見る →</p>
            </Link>
          </Card>
        )}

        <Card className="p-4">
          <p className="mb-2 text-[12px] font-bold text-ink-3">担当者</p>
          {(() => {
            const assignee = users.find((u) => u.id === task.assigneeId);
            const isMine = task.assigneeId === state.currentUserId;
            if (!assignee) {
              return <p className="text-[12px] text-ink-3">担当者が見つかりません（{task.assigneeId}）</p>;
            }
            return (
              <div className={`rounded-lg px-3 py-2.5 ${isMine ? "bg-brand-soft" : "bg-surface-2"}`}>
                <p className={`text-[13px] font-medium ${isMine ? "text-brand-ink" : ""}`}>
                  {assignee.name}
                  {isMine && <span className="ml-1.5 text-[11.5px] font-normal text-brand">自分が担当</span>}
                </p>
                <p className="mt-0.5 text-[11.5px] text-ink-3">{assignee.team}</p>
              </div>
            );
          })()}
          <p className="mt-2 text-[11.5px] text-ink-3">担当者は「編集」から変更できます</p>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-[12px] font-bold text-ink-3">紐付く業務</p>
          {run && def ? (
            <Link href={`/navigator/${run.id}`} className="block rounded-lg bg-surface-2 px-3 py-2.5 hover:bg-brand-soft">
              <span className="block text-[12.5px] font-medium">{run.subject.label}</span>
              <span className="text-[11.5px] text-ink-3">{def.name}{task.stepKey && ` ／ ${def.steps.find((s) => s.key === task.stepKey)?.title}`}</span>
            </Link>
          ) : (
            <p className="text-[12px] text-ink-3">紐付く業務はありません</p>
          )}
        </Card>

        {/* 開始できる業務が無いときは見出しごと出さない（仕様 §15-4） */}
        {startable && (
          <Card className="p-4">
            <p className="mb-2 text-[12px] font-bold text-ink-3">この場から業務を開始</p>
            <p className="mb-2 text-[12.5px] text-ink-2">「{startable.name}」を開始できます。</p>
            <Button onClick={startWorkflow} disabled={blockedBy.length > 0}>この業務を開始する</Button>
          </Card>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {task.confirmationState === "confirmed" && task.status !== "done" && (
          <Button onClick={() => dispatch({ type: "updateTask", taskId: task.id, patch: { status: "done" } })}>
            このタスクを完了にする
            {released.length > 0 && `（${released.length}件が着手可能になります）`}
          </Button>
        )}
        <LinkButton href="/tasks" variant="secondary">一覧へ戻る</LinkButton>
        {/*
          完了の隣だが役割は別。完了は済んだ記録として残り、削除は記録ごと消える。
          並びの端に置いて、間違えて押しにくくする。
        */}
        <span className="ml-auto">
          <DeleteTaskButton task={task} size="md" onDeleted={() => router.push("/tasks")} />
        </span>
      </div>
    </div>
  );
}
