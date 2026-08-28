"use client";

/** タスク詳細（仕様 §9）。派生の系譜と依存関係をたどれること */
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { Badge, Button, Card, LinkButton, PageHeader } from "@/ui/primitives";
import { remainingLabel, urgencyOf } from "@/core/context/resolver";
import { buildRun } from "@/services/start-run";
import { useNow } from "@/ui/use-navigator";
import { TaskForm } from "@/ui/task-form";
import { TASK_PRIORITIES, patchFromDraft } from "@/core/model/task-draft";

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const router = useRouter();
  const { state, dispatch, workflows, customers, users } = useStore();
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return <div className="p-8 text-[13px]">タスクが見つかりません。</div>;

  const run = task.runId ? state.runs.find((r) => r.id === task.runId) : undefined;
  const def = run ? workflows.find((w) => w.key === run.workflowKey) : undefined;
  const change = task.originEventId ? state.changeEvents.find((c) => c.id === task.originEventId) : undefined;
  const deps = task.dependsOn.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  const blockedBy = deps.filter((d) => d && d.status !== "done");
  const startable = task.startableWorkflowKey ? workflows.find((w) => w.key === task.startableWorkflowKey) : undefined;

  function startWorkflow() {
    if (!startable || !task) return;
    const { run, stepRuns } = buildRun({
      def: startable,
      customers,
      assigneeId: state.currentUserId,
      // タスクから開始した業務は、タスクの表題と期限を引き継ぐ
      override: { label: task.title, dueAt: task.dueAt },
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
        <Badge>担当：{users.find((u) => u.id === task.assigneeId)?.name ?? "未割当"}</Badge>
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

      {editing && (
        <TaskForm
          mode={{ kind: "edit", task }}
          users={users}
          onSubmit={(draft) => {
            dispatch({ type: "updateTask", taskId: task.id, patch: patchFromDraft(draft, task) });
            setEditing(false);
            setSaved(true);
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
        <Card className="mb-5 p-4">
          <p className="text-[12.5px] font-bold text-ink-3">先行タスクの完了待ちです</p>
          <ul className="mt-2 flex flex-col gap-1">
            {blockedBy.map((d) => d && (
              <li key={d.id}>
                <Link href={`/tasks/${d.id}`} className="block rounded bg-surface-2 px-3 py-2 text-[12.5px] hover:bg-brand-soft">
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
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

        <Card className="p-4">
          <p className="mb-2 text-[12px] font-bold text-ink-3">この場から業務を開始</p>
          {startable ? (
            <>
              <p className="mb-2 text-[12.5px] text-ink-2">「{startable.name}」を開始できます。</p>
              <Button onClick={startWorkflow} disabled={blockedBy.length > 0}>この業務を開始する</Button>
            </>
          ) : (
            <p className="text-[12px] text-ink-3">開始できる業務フローの指定はありません</p>
          )}
        </Card>
      </div>

      {task.confirmationState === "confirmed" && task.status !== "done" && (
        <div className="mt-5 flex gap-2">
          <Button onClick={() => dispatch({ type: "updateTask", taskId: task.id, patch: { status: "done" } })}>
            このタスクを完了にする
          </Button>
          <LinkButton href="/tasks" variant="secondary">一覧へ戻る</LinkButton>
        </div>
      )}
    </div>
  );
}
